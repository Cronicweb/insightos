"""Data quality assessment.

Analytics built on unvalidated data is worse than no analytics, so InsightOS
scores every dataset before it computes a single KPI.  The score follows the
six classic DAMA dimensions - completeness, uniqueness, validity, consistency,
timeliness and accuracy - each computed from explicit, inspectable checks, and
each issue carries the exact rows that triggered it.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from ..profiling.schema import TableSchema
from ..types import SemanticType, Severity, to_jsonable

__all__ = ["QualityIssue", "QualityDimension", "QualityReport", "assess_quality"]


@dataclass
class QualityIssue:
    id: str
    dimension: str
    column: str | None
    severity: Severity
    title: str
    detail: str
    affected_rows: int
    affected_pct: float
    examples: list[Any] = field(default_factory=list)
    remediation: str = ""

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


@dataclass
class QualityDimension:
    name: str
    score: float           # 0..100
    weight: float
    detail: str

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


@dataclass
class QualityReport:
    score: float
    grade: str
    dimensions: list[QualityDimension]
    issues: list[QualityIssue]
    missing_by_column: list[dict[str, Any]]
    duplicates: dict[str, Any]
    outliers: list[dict[str, Any]]
    cardinality: list[dict[str, Any]]
    invalid_values: list[dict[str, Any]]
    rows: int
    columns: int
    usable_for_analysis: bool

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


_GRADES = [(95, "A+"), (90, "A"), (85, "B+"), (78, "B"), (70, "C+"),
           (60, "C"), (50, "D"), (0, "F")]


def _grade(score: float) -> str:
    return next(g for threshold, g in _GRADES if score >= threshold)


def _sev(pct: float) -> Severity:
    if pct >= 30:
        return Severity.CRITICAL
    if pct >= 15:
        return Severity.HIGH
    if pct >= 5:
        return Severity.MEDIUM
    return Severity.LOW


def assess_quality(df: pd.DataFrame, schema: TableSchema) -> QualityReport:
    """Run every quality check and combine them into a single weighted score."""
    issues: list[QualityIssue] = []
    rows = len(df)
    cols = len(df.columns)

    # ---------------- completeness ---------------- #
    missing_by_column = []
    for col in schema.columns:
        missing_by_column.append(
            {"column": col.name, "missing": col.missing, "missing_pct": col.missing_pct,
             "dtype": col.dtype, "semantic_type": col.semantic_type}
        )
        if col.missing_pct > 0:
            sev = _sev(col.missing_pct)
            if col.missing_pct >= 1.0:
                issues.append(QualityIssue(
                    id=f"missing::{col.name}",
                    dimension="completeness",
                    column=col.name,
                    severity=sev,
                    title=f"{col.name} is {col.missing_pct:.1f}% incomplete",
                    detail=(f"{col.missing:,} of {rows:,} rows have no value for "
                            f"'{col.name}'."),
                    affected_rows=col.missing,
                    affected_pct=col.missing_pct,
                    remediation=(
                        "Exclude from KPI denominators or impute with a documented rule; "
                        "trace the upstream pipeline if the gap is recent."
                    ),
                ))
    missing_cells = int(df.isna().sum().sum())
    completeness = 100.0 - (missing_cells / (rows * cols) * 100.0 if rows and cols else 0)

    # ---------------- uniqueness ---------------- #
    dup_rows = int(df.duplicated().sum())
    dup_pct = dup_rows / rows * 100.0 if rows else 0.0
    duplicates: dict[str, Any] = {
        "exact_duplicate_rows": dup_rows,
        "exact_duplicate_pct": round(dup_pct, 4),
        "key_columns": schema.primary_key,
        "key_duplicate_rows": 0,
        "example_keys": [],
    }
    if dup_rows:
        issues.append(QualityIssue(
            id="duplicates::exact",
            dimension="uniqueness",
            column=None,
            severity=_sev(dup_pct),
            title=f"{dup_rows:,} exact duplicate rows ({dup_pct:.2f}%)",
            detail="Identical rows inflate every additive KPI (revenue, volume, counts).",
            affected_rows=dup_rows,
            affected_pct=round(dup_pct, 4),
            remediation="De-duplicate on the natural key before aggregation.",
        ))
    if schema.primary_key:
        key_dups = int(df.duplicated(subset=schema.primary_key).sum())
        duplicates["key_duplicate_rows"] = key_dups
        if key_dups:
            dup_keys = df.loc[df.duplicated(subset=schema.primary_key, keep=False),
                              schema.primary_key].head(5)
            duplicates["example_keys"] = to_jsonable(dup_keys.to_dict(orient="records"))
            issues.append(QualityIssue(
                id="duplicates::key",
                dimension="uniqueness",
                column=",".join(schema.primary_key),
                severity=Severity.HIGH,
                title=f"Primary key {schema.primary_key} is not unique",
                detail=f"{key_dups:,} rows repeat an existing key value.",
                affected_rows=key_dups,
                affected_pct=round(key_dups / rows * 100.0, 4) if rows else 0.0,
                remediation="Confirm grain with the data owner; the table is not at the "
                            "grain its key implies.",
            ))
    uniqueness = 100.0 - min(dup_pct * 2.0, 100.0)

    # ---------------- validity ---------------- #
    invalid_values: list[dict[str, Any]] = []
    now = pd.Timestamp.utcnow().tz_localize(None)
    for col in schema.columns:
        s = df[col.name]
        checks: list[tuple[str, pd.Series, str]] = []
        if col.semantic_type in {SemanticType.CURRENCY, SemanticType.COUNT}:
            numeric = pd.to_numeric(s, errors="coerce")
            if col.semantic_type == SemanticType.COUNT:
                checks.append(("negative_count", numeric < 0,
                               "counts cannot be negative"))
            else:
                checks.append(("negative_amount", numeric < 0,
                               "negative monetary value (refund or sign error)"))
        if col.semantic_type == SemanticType.PERCENTAGE:
            numeric = pd.to_numeric(s, errors="coerce")
            scale = 100.0 if (numeric.dropna().abs().max() or 0) > 1.5 else 1.0
            checks.append(("out_of_range_pct", (numeric < 0) | (numeric > scale),
                           f"outside the valid 0-{scale:g} range"))
        if col.semantic_type in {SemanticType.DATE, SemanticType.DATETIME}:
            parsed = pd.to_datetime(s, errors="coerce")
            checks.append(("future_date", parsed > now + pd.Timedelta(days=1),
                           "timestamp is in the future"))
            checks.append(("implausible_date", parsed < pd.Timestamp("1970-01-01"),
                           "timestamp predates 1970"))
        if col.semantic_type == SemanticType.EMAIL:
            checks.append(("malformed_email",
                           ~s.dropna().astype(str).str.contains(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$",
                                                                case=False, regex=True),
                           "does not parse as an email address"))
        if col.semantic_type in {SemanticType.CATEGORICAL, SemanticType.GEO}:
            as_str = s.dropna().astype(str)
            trimmed = as_str.str.strip()
            inconsistent = (as_str != trimmed) | (
                trimmed.str.lower().map(trimmed.str.lower().value_counts()) !=
                trimmed.map(trimmed.value_counts())
            )
            checks.append(("inconsistent_casing", inconsistent,
                           "same category written with different casing/whitespace"))
        for check_id, mask, why in checks:
            mask = mask.fillna(False)
            count = int(mask.sum())
            if count == 0:
                continue
            pct = count / rows * 100.0 if rows else 0.0
            examples = to_jsonable(s[mask].dropna().head(3).tolist())
            invalid_values.append({"column": col.name, "check": check_id, "count": count,
                                   "pct": round(pct, 4), "examples": examples,
                                   "reason": why})
            issues.append(QualityIssue(
                id=f"validity::{col.name}::{check_id}",
                dimension="validity",
                column=col.name,
                severity=_sev(pct) if check_id != "negative_amount" else Severity.LOW,
                title=f"{count:,} invalid values in {col.name} ({check_id.replace('_', ' ')})",
                detail=f"Values where {why}.",
                affected_rows=count,
                affected_pct=round(pct, 4),
                examples=examples,
                remediation="Add an upstream constraint or a documented cleaning rule.",
            ))
    invalid_cells = sum(v["count"] for v in invalid_values)
    validity = 100.0 - min((invalid_cells / (rows * cols) * 100.0 if rows and cols else 0) * 4, 100)

    # ---------------- accuracy (outliers) ---------------- #
    outliers: list[dict[str, Any]] = []
    for col in schema.columns:
        if col.semantic_type not in {SemanticType.NUMERIC, SemanticType.CURRENCY,
                                     SemanticType.COUNT, SemanticType.PERCENTAGE}:
            continue
        x = pd.to_numeric(df[col.name], errors="coerce").dropna().astype("float64")
        if x.size < 20:
            continue
        q1, q3 = float(x.quantile(0.25)), float(x.quantile(0.75))
        iqr = q3 - q1
        lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        iqr_mask = (x < lo) | (x > hi)
        med = float(x.median())
        mad = float((x - med).abs().median())
        scale = 1.4826 * mad if mad > 0 else float(x.std(ddof=1) or 0)
        robust_z = ((x - med) / scale).abs() if scale else pd.Series(np.zeros(x.size), index=x.index)
        z_mask = robust_z > 3.5
        n_out = int((iqr_mask & z_mask).sum())
        if n_out == 0:
            continue
        pct = n_out / x.size * 100.0
        extreme = x[iqr_mask & z_mask]
        share_of_total = float(extreme.sum() / x.sum() * 100.0) if x.sum() else 0.0
        outliers.append({
            "column": col.name, "count": n_out, "pct": round(pct, 4),
            "lower_fence": lo, "upper_fence": hi,
            "min_outlier": float(extreme.min()), "max_outlier": float(extreme.max()),
            "share_of_column_total_pct": round(share_of_total, 3),
            "method": "IQR(1.5) AND robust-z(MAD) > 3.5",
        })
        if pct >= 1.0 or share_of_total >= 15.0:
            issues.append(QualityIssue(
                id=f"outliers::{col.name}",
                dimension="accuracy",
                column=col.name,
                severity=Severity.MEDIUM if share_of_total < 25 else Severity.HIGH,
                title=f"{n_out:,} extreme values in {col.name} ({pct:.2f}% of rows)",
                detail=(f"They account for {share_of_total:.1f}% of the column total, so "
                        f"means and growth rates are sensitive to them."),
                affected_rows=n_out,
                affected_pct=round(pct, 4),
                examples=[float(extreme.max()), float(extreme.min())],
                remediation="Report medians alongside means, or winsorise at the 99th "
                            "percentile for trend analysis.",
            ))
    outlier_rows = sum(o["count"] for o in outliers)
    accuracy = 100.0 - min((outlier_rows / rows * 100.0 if rows else 0) * 1.5, 100.0)

    # ---------------- consistency (cardinality) ---------------- #
    cardinality: list[dict[str, Any]] = []
    for col in schema.columns:
        entry = {"column": col.name, "unique": col.unique, "unique_pct": col.unique_pct,
                 "semantic_type": col.semantic_type, "hhi": col.concentration_hhi}
        cardinality.append(entry)
        if col.semantic_type == SemanticType.CATEGORICAL and col.unique > max(50, 0.5 * rows):
            issues.append(QualityIssue(
                id=f"cardinality::{col.name}",
                dimension="consistency",
                column=col.name,
                severity=Severity.LOW,
                title=f"{col.name} has very high cardinality ({col.unique:,} values)",
                detail="Too granular to group by directly; needs a hierarchy or bucketing.",
                affected_rows=col.unique,
                affected_pct=col.unique_pct,
                remediation="Roll up into a parent category before using as a dimension.",
            ))
        if col.is_constant:
            issues.append(QualityIssue(
                id=f"constant::{col.name}",
                dimension="consistency",
                column=col.name,
                severity=Severity.LOW,
                title=f"{col.name} is constant",
                detail="A single repeated value carries no analytical signal.",
                affected_rows=rows,
                affected_pct=100.0,
                remediation="Drop the column or confirm the extract is not filtered.",
            ))
    constant_cols = sum(1 for c in schema.columns if c.is_constant)
    consistency = 100.0 - min(constant_cols / cols * 100.0 if cols else 0, 40.0)

    # ---------------- timeliness ---------------- #
    timeliness = 100.0
    timeliness_detail = "No date column detected; timeliness not assessed."
    if schema.time_columns:
        tcol = schema.time_columns[0]
        parsed = pd.to_datetime(df[tcol], errors="coerce").dropna()
        if not parsed.empty:
            latest = parsed.max()
            if latest.tzinfo is not None:
                latest = latest.tz_localize(None)
            age_days = (now - latest).days
            prof = schema.column(tcol)
            gran = prof.inferred_granularity if prof else "daily"
            tolerance = {"hourly": 2, "daily": 7, "weekly": 21, "monthly": 75,
                         "quarterly": 200, "yearly": 500}.get(gran or "daily", 30)
            timeliness = float(np.clip(100.0 - max(0, age_days - tolerance) * 1.5, 0, 100))
            timeliness_detail = (f"Latest '{tcol}' is {latest.date().isoformat()} "
                                 f"({age_days} days old, {gran} grain).")
            gaps = prof.gaps if prof else 0
            if gaps:
                issues.append(QualityIssue(
                    id=f"timeliness::gaps::{tcol}",
                    dimension="timeliness",
                    column=tcol,
                    severity=Severity.MEDIUM,
                    title=f"{gaps} gaps in the {tcol} series",
                    detail=f"Periods are missing at the {gran} grain, which distorts "
                           f"period-over-period comparisons.",
                    affected_rows=gaps,
                    affected_pct=0.0,
                    remediation="Backfill missing periods with explicit zero rows.",
                ))
            if timeliness < 70:
                issues.append(QualityIssue(
                    id="timeliness::stale",
                    dimension="timeliness",
                    column=tcol,
                    severity=Severity.MEDIUM,
                    title=f"Data is {age_days} days old",
                    detail=timeliness_detail,
                    affected_rows=0,
                    affected_pct=0.0,
                    remediation="Check the ingestion schedule before acting on trends.",
                ))

    dimensions = [
        QualityDimension("completeness", round(completeness, 2), 0.30,
                         f"{missing_cells:,} missing cells across {cols} columns."),
        QualityDimension("uniqueness", round(uniqueness, 2), 0.15,
                         f"{dup_rows:,} exact duplicate rows."),
        QualityDimension("validity", round(validity, 2), 0.20,
                         f"{invalid_cells:,} values failed a type or range rule."),
        QualityDimension("consistency", round(consistency, 2), 0.10,
                         f"{constant_cols} constant column(s)."),
        QualityDimension("accuracy", round(accuracy, 2), 0.15,
                         f"{outlier_rows:,} statistical outliers flagged."),
        QualityDimension("timeliness", round(timeliness, 2), 0.10, timeliness_detail),
    ]
    score = float(sum(d.score * d.weight for d in dimensions))
    issues.sort(key=lambda i: (-i.severity.rank, -i.affected_pct))
    blocking = any(i.severity == Severity.CRITICAL for i in issues)

    return QualityReport(
        score=round(score, 2),
        grade=_grade(score),
        dimensions=dimensions,
        issues=issues,
        missing_by_column=sorted(missing_by_column, key=lambda m: -m["missing_pct"]),
        duplicates=duplicates,
        outliers=outliers,
        cardinality=cardinality,
        invalid_values=invalid_values,
        rows=rows,
        columns=cols,
        usable_for_analysis=not blocking and score >= 50,
    )
