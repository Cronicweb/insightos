"""Data governance: can this dataset be used to make a decision, and how big a one?

Most analytics tools answer "what does the data say?". A governed platform must
first answer "how much should we believe it?". This module attaches a **data
charter** to every dataset - source, ownership, freshness, quality and lineage -
and converts that into a single, blunt verdict:

``blocked`` -> ``exploratory`` -> ``operational`` -> ``executive_ready``

The verdict is not decorative. It caps how confident any downstream
recommendation is allowed to be, and it decides whether an action can be taken
directly or must be routed for approval. A dataset that is three months stale can
still produce a chart; it may not produce an executive instruction.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

import pandas as pd

from ..types import to_jsonable

__all__ = [
    "TrustLevel",
    "DecisionReadiness",
    "GovernanceCheck",
    "Freshness",
    "GovernanceReport",
    "assess_governance",
    "readiness_confidence_cap",
]


class TrustLevel:
    VERIFIED = "verified"
    MONITORED = "monitored"
    PROVISIONAL = "provisional"
    UNTRUSTED = "untrusted"


class DecisionReadiness:
    EXECUTIVE_READY = "executive_ready"
    OPERATIONAL = "operational"
    EXPLORATORY = "exploratory"
    BLOCKED = "blocked"

    ORDER = (BLOCKED, EXPLORATORY, OPERATIONAL, EXECUTIVE_READY)

    @staticmethod
    def rank(value: str) -> int:
        return DecisionReadiness.ORDER.index(value) if value in DecisionReadiness.ORDER else 0


#: How much confidence a recommendation may claim at each readiness level.
_CONFIDENCE_CAP = {
    DecisionReadiness.EXECUTIVE_READY: 1.0,
    DecisionReadiness.OPERATIONAL: 0.8,
    DecisionReadiness.EXPLORATORY: 0.55,
    DecisionReadiness.BLOCKED: 0.3,
}


def readiness_confidence_cap(readiness: str) -> float:
    """The ceiling a recommendation's confidence may not exceed."""
    return _CONFIDENCE_CAP.get(readiness, 0.55)


@dataclass
class GovernanceCheck:
    """One auditable gate. ``status`` is pass / warn / fail, never a bare bool."""

    id: str
    label: str
    status: str
    detail: str
    weight: float = 1.0

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


@dataclass
class Freshness:
    as_of: str | None = None
    lag_days: float | None = None
    grain: str | None = None
    status: str = "unknown"              # fresh | aging | stale | unknown
    detail: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "asOf": self.as_of,
            "lagDays": self.lag_days,
            "grain": self.grain,
            "status": self.status,
            "detail": self.detail,
        }


@dataclass
class GovernanceReport:
    dataset: str
    source: str = "unknown"
    source_type: str = "unknown"         # demo_generator | uploaded_file | api | warehouse
    owner: str = "Unassigned"
    steward: str = "Unassigned"
    classification: str = "internal"     # public | internal | confidential | restricted
    retention: str = "session only"
    freshness: Freshness = field(default_factory=Freshness)
    quality_score: float | None = None
    quality_grade: str | None = None
    trust_level: str = TrustLevel.PROVISIONAL
    decision_readiness: str = DecisionReadiness.EXPLORATORY
    confidence_cap: float = 0.55
    readiness_reasons: list[str] = field(default_factory=list)
    blocking_issues: list[str] = field(default_factory=list)
    checks: list[GovernanceCheck] = field(default_factory=list)
    lineage: list[str] = field(default_factory=list)
    sensitive_columns: int = 0
    evaluated_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "dataset": self.dataset,
            "source": self.source,
            "sourceType": self.source_type,
            "owner": self.owner,
            "steward": self.steward,
            "classification": self.classification,
            "retention": self.retention,
            "freshness": self.freshness.to_dict(),
            "qualityScore": self.quality_score,
            "qualityGrade": self.quality_grade,
            "trustLevel": self.trust_level,
            "decisionReadiness": self.decision_readiness,
            "confidenceCap": self.confidence_cap,
            "readinessReasons": list(self.readiness_reasons),
            "blockingIssues": list(self.blocking_issues),
            "checks": [c.to_dict() for c in self.checks],
            "lineage": list(self.lineage),
            "sensitiveColumns": self.sensitive_columns,
            "evaluatedAt": self.evaluated_at,
        }


# --------------------------------------------------------------------------- #
_GRAIN_TOLERANCE_DAYS = {
    "hourly": 2.0,
    "daily": 3.0,
    "weekly": 14.0,
    "monthly": 45.0,
    "quarterly": 130.0,
    "yearly": 500.0,
}


def _assess_freshness(df: pd.DataFrame, date_column: str | None, grain: str | None,
                      *, now: datetime | None = None) -> Freshness:
    """Freshness is measured against the dataset's own grain, not the calendar.

    A monthly dataset that ends five weeks ago is normal; a daily one is stale.
    Comparing every dataset to "yesterday" would flag healthy monthly reporting as
    broken, so the tolerance scales with the reporting grain.
    """
    if not date_column or date_column not in df.columns:
        return Freshness(status="unknown", grain=grain,
                         detail="no date column was detected, so recency cannot be verified")
    series = pd.to_datetime(df[date_column], errors="coerce").dropna()
    if series.empty:
        return Freshness(status="unknown", grain=grain,
                         detail=f"'{date_column}' contains no parseable dates")

    last = series.max()
    reference = now or datetime.now(timezone.utc)
    if last.tzinfo is not None:
        last_naive = last.tz_convert(None) if hasattr(last, "tz_convert") else last.replace(tzinfo=None)
    else:
        last_naive = last
    lag = (pd.Timestamp(reference.replace(tzinfo=None)) - pd.Timestamp(last_naive)).days
    tolerance = _GRAIN_TOLERANCE_DAYS.get(grain or "", 30.0)

    if lag <= tolerance:
        status, detail = "fresh", f"the latest record is {lag} days old, within the {grain or 'expected'} reporting window"
    elif lag <= tolerance * 3:
        status, detail = "aging", f"the latest record is {lag} days old, beyond one {grain or 'period'} of lag"
    else:
        status, detail = "stale", f"the latest record is {lag} days old, more than three reporting periods behind"

    return Freshness(as_of=str(pd.Timestamp(last_naive).date()), lag_days=float(lag),
                     grain=grain, status=status, detail=detail)


def _grade_trust(quality: float | None, freshness: str, has_key: bool) -> str:
    if quality is None:
        return TrustLevel.UNTRUSTED
    if quality >= 90 and freshness == "fresh" and has_key:
        return TrustLevel.VERIFIED
    if quality >= 78 and freshness in ("fresh", "aging"):
        return TrustLevel.MONITORED
    if quality >= 60:
        return TrustLevel.PROVISIONAL
    return TrustLevel.UNTRUSTED


def assess_governance(result: Any, *, source: str = "unknown",
                      source_type: str = "unknown", owner: str = "Unassigned",
                      steward: str | None = None, privacy: Any = None,
                      df: pd.DataFrame | None = None,
                      now: datetime | None = None) -> GovernanceReport:
    """Build the data charter for a completed :class:`AnalysisResult`."""
    report = GovernanceReport(
        dataset=getattr(result, "dataset", "dataset"),
        source=source, source_type=source_type, owner=owner,
        steward=steward or owner,
        evaluated_at=(now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )

    quality = getattr(result, "quality", None)
    schema = getattr(result, "schema", None)
    scorecard = getattr(result, "scorecard", None)
    frame = df if df is not None else None

    report.quality_score = getattr(quality, "score", None)
    report.quality_grade = getattr(quality, "grade", None)

    grain = getattr(scorecard, "grain", None)
    date_column = getattr(scorecard, "date_column", None) or next(
        iter(getattr(schema, "time_columns", None) or []), None)
    if frame is not None:
        report.freshness = _assess_freshness(frame, date_column, grain, now=now)
    else:
        report.freshness = Freshness(grain=grain, status="unknown",
                                     detail="the source frame was not supplied for a recency check")

    primary_key = list(getattr(schema, "primary_key", None) or [])
    has_key = bool(primary_key)

    sensitive = list(getattr(privacy, "fields", None) or [])
    report.sensitive_columns = len(sensitive)
    if sensitive:
        report.classification = "restricted" if any(
            f.category in ("payment_card", "national_id", "health") for f in sensitive
        ) else "confidential"

    # ---- checks ---- #
    score = report.quality_score
    report.checks.append(GovernanceCheck(
        id="quality-threshold", label="Data quality score",
        status=("pass" if (score or 0) >= 85 else "warn" if (score or 0) >= 65 else "fail"),
        detail=(f"quality scored {score:.1f}/100 (grade {report.quality_grade})"
                if score is not None else "quality could not be assessed"),
        weight=2.0,
    ))
    report.checks.append(GovernanceCheck(
        id="identity", label="Row identity",
        status="pass" if has_key else "warn",
        detail=(f"primary key resolved as {', '.join(primary_key)}" if has_key
                else "no primary key was detected, so duplicate rows cannot be ruled out"),
    ))
    report.checks.append(GovernanceCheck(
        id="recency", label="Freshness",
        status={"fresh": "pass", "aging": "warn"}.get(report.freshness.status, "fail"),
        detail=report.freshness.detail, weight=1.5,
    ))
    has_time = bool(date_column)
    report.checks.append(GovernanceCheck(
        id="time-series", label="Period comparability",
        status="pass" if has_time else "fail",
        detail=(f"'{date_column}' provides a {grain or 'time'} grain for period-over-period "
                "comparison" if has_time else
                "no usable date column, so nothing can be compared across periods"),
        weight=1.5,
    ))
    kpi_count = len(getattr(scorecard, "kpis", None) or [])
    report.checks.append(GovernanceCheck(
        id="metric-coverage", label="Metric coverage",
        status="pass" if kpi_count >= 4 else "warn" if kpi_count >= 1 else "fail",
        detail=f"{kpi_count} KPI(s) could be computed from the resolved roles",
    ))
    report.checks.append(GovernanceCheck(
        id="privacy", label="Personal data handling",
        status="pass",
        detail=(f"{len(sensitive)} sensitive column(s) detected and masked automatically"
                if sensitive else "no personal data patterns were detected"),
    ))
    critical_issues = [i for i in (getattr(quality, "issues", None) or [])
                       if getattr(getattr(i, "severity", None), "value", "") == "critical"]
    report.checks.append(GovernanceCheck(
        id="critical-defects", label="Critical defects",
        status="pass" if not critical_issues else "fail",
        detail=(f"{len(critical_issues)} critical quality issue(s) open"
                if critical_issues else "no critical quality issues"),
        weight=2.0,
    ))

    # ---- verdict ---- #
    failures = [c for c in report.checks if c.status == "fail"]
    warnings = [c for c in report.checks if c.status == "warn"]
    report.blocking_issues = [f"{c.label}: {c.detail}" for c in failures]

    if score is None or score < 50 or any(c.weight >= 1.5 for c in failures):
        readiness = DecisionReadiness.BLOCKED
    elif failures or score < 70 or report.freshness.status == "stale":
        readiness = DecisionReadiness.EXPLORATORY
    elif warnings or score < 85:
        readiness = DecisionReadiness.OPERATIONAL
    else:
        readiness = DecisionReadiness.EXECUTIVE_READY

    report.decision_readiness = readiness
    report.confidence_cap = readiness_confidence_cap(readiness)
    report.trust_level = _grade_trust(score, report.freshness.status, has_key)

    reasons: list[str] = []
    if score is not None:
        reasons.append(f"quality {score:.0f}/100")
    reasons.append(f"freshness {report.freshness.status}")
    reasons.append(f"{len(failures)} failed and {len(warnings)} warned governance check(s)")
    if readiness == DecisionReadiness.EXECUTIVE_READY:
        reasons.append("every gate passed, so findings may be quoted to an executive audience")
    elif readiness == DecisionReadiness.OPERATIONAL:
        reasons.append("suitable for team-level operating decisions; escalate with caution")
    elif readiness == DecisionReadiness.EXPLORATORY:
        reasons.append("findings are directional only and must be confirmed before acting")
    else:
        reasons.append("the dataset cannot support a decision until the blocking issues are fixed")
    report.readiness_reasons = reasons

    report.lineage = [
        f"source: {source} ({source_type})",
        "profiling: schema, keys and semantic types inferred",
        "quality: completeness, validity, uniqueness, consistency and timeliness scored",
        "privacy: sensitive columns detected and masked",
        "roles: semantic roles resolved, business domain inferred",
        "metrics: KPIs computed with period-over-period comparison",
        "analysis: anomalies, root cause, forecast",
        "governance: this charter evaluated",
    ]
    return report
