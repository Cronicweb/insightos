"""The InsightOS pipeline - one call from a DataFrame to a decision-ready analysis.

This is the facade over the engine packages. It exists so that the framework has a
single, stable entry point (`analyse(df)`) while each underlying module stays
independently usable and independently testable.

Order matters and is deliberate:

``profile -> quality -> roles -> domain -> KPIs -> anomalies -> root cause ->
forecast -> narratives -> recommendations -> executive report``

Quality runs *before* anything is interpreted, because a conclusion drawn from a
broken column is worse than no conclusion. Roles and domain run before KPIs so the
KPI set is chosen for the business, not for the column names. Root cause runs after
KPIs because it needs to know which metric matters. Recommendations run last
because every rule reads the evidence the earlier stages produced.

Every stage is individually guarded: a failure in one stage degrades the report
rather than destroying it, and the failure is recorded in ``AnalysisResult.warnings``
so it is visible instead of silent.
"""

from __future__ import annotations

import time
import traceback
from dataclasses import dataclass, field
from typing import Any

import pandas as pd

from . import plugins as _plugins          # noqa: F401  (import registers domain packs)
from .anomaly import AnomalyReport, detect_anomalies, detect_segment_anomalies
from .forecast import Forecast, forecast_series
from .governance import assess_governance
from .kpi import compute_kpis, detect_domain, get_kpi, resolve_roles
from .narrative import (
    ChartNarrative,
    NarrativePolisher,
    describe_breakdown,
    describe_comparison,
    describe_distribution,
    describe_series,
)
from .plugins import get_plugin
from .privacy import detect_sensitive_fields
from .profiling import infer_schema
from .quality import assess_quality
from .recommendation import RuleContext, apply_governance, generate_recommendations
from .reporting import ExecutiveReport, build_executive_report
from .root_cause import analyse_root_cause
from .types import to_jsonable
from .visualization import build_all_charts

__all__ = ["AnalysisResult", "AnalysisOptions", "analyse"]


@dataclass
class AnalysisOptions:
    max_kpis: int = 8
    forecast_horizon: int = 3
    max_recommendations: int = 8
    max_root_causes: int = 2
    max_dimensions: int = 8
    dataset_name: str = "dataset"
    polisher: NarrativePolisher | None = None
    run_forecast: bool = True
    run_anomalies: bool = True
    run_root_cause: bool = True
    # ---- governance metadata: what this dataset is, and how far it may be trusted ---- #
    source: str = "uploaded file"
    source_type: str = "file"
    owner: str = "Unassigned"
    allow_drill_down: bool = False       # aggregate-only until explicitly granted
    run_privacy: bool = True
    run_governance: bool = True
    use_plugins: bool = True


@dataclass
class AnalysisResult:
    dataset: str
    rows: int
    columns: int
    schema: Any = None
    quality: Any = None
    roles: dict[str, str] = field(default_factory=dict)
    role_audit: list[dict[str, Any]] = field(default_factory=list)
    domain: Any = None
    scorecard: Any = None
    anomalies: AnomalyReport | None = None
    root_causes: list[Any] = field(default_factory=list)
    forecasts: list[Forecast] = field(default_factory=list)
    narratives: list[ChartNarrative] = field(default_factory=list)
    charts: list[Any] = field(default_factory=list)
    recommendations: Any = None
    report: ExecutiveReport | None = None
    privacy: Any = None
    governance: Any = None
    plugin: Any = None
    timings_ms: dict[str, float] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "dataset": self.dataset,
            "rows": self.rows,
            "columns": self.columns,
            "schema": self.schema.to_dict() if self.schema else None,
            "quality": self.quality.to_dict() if self.quality else None,
            "roles": self.roles,
            "role_audit": to_jsonable(self.role_audit),
            "domain": self.domain.to_dict() if self.domain else None,
            "scorecard": self.scorecard.to_dict() if self.scorecard else None,
            "anomalies": self.anomalies.to_dict() if self.anomalies else None,
            "root_causes": [t.to_dict() for t in self.root_causes],
            "forecasts": [f.to_dict() for f in self.forecasts],
            "narratives": [n.to_dict() for n in self.narratives],
            "charts": [c.to_dict() for c in self.charts],
            "recommendations": (self.recommendations.to_dict()
                                if self.recommendations else None),
            "report": self.report.to_dict() if self.report else None,
            "privacy": self.privacy.to_dict() if self.privacy else None,
            "governance": self.governance.to_dict() if self.governance else None,
            "plugin": self.plugin.to_dict() if self.plugin else None,
            "timings_ms": self.timings_ms,
            "warnings": self.warnings,
        }


class _Stage:
    """Times a stage and converts an exception into a recorded warning."""

    def __init__(self, result: AnalysisResult, name: str):
        self.result, self.name = result, name

    def __enter__(self):
        self._t = time.perf_counter()
        return self

    def __exit__(self, exc_type, exc, tb):
        self.result.timings_ms[self.name] = round(
            (time.perf_counter() - self._t) * 1000, 2)
        if exc is not None:
            self.result.warnings.append(
                f"stage '{self.name}' failed: {exc.__class__.__name__}: {exc}")
            traceback.clear_frames(tb)
            return True                      # swallow: degrade, never crash
        return False


_GRAIN_OFFSET = {
    "hourly": "h",
    "daily": "D",
    "weekly": "W",
    "monthly": "MS",
    "quarterly": "QS",
    "yearly": "YS",
}


def _future_labels(scorecard: Any, horizon: int) -> list[str] | None:
    """Project human-readable period names past the end of the observed series."""
    from .kpi.engine import _fmt_period

    grain = getattr(scorecard, "grain", None)
    freq = _GRAIN_OFFSET.get(grain or "")
    if not freq:
        return None
    series = next((k.series for k in scorecard.kpis if k.series), None)
    if not series:
        return None
    try:
        last = pd.Timestamp(series[-1].get("period"))
        future = pd.date_range(start=last, periods=horizon + 1, freq=freq)[1:]
    except Exception:
        return None
    return [_fmt_period(ts, grain) for ts in future]


def analyse(df: pd.DataFrame, options: AnalysisOptions | None = None) -> AnalysisResult:
    """Run the full InsightOS analysis over a DataFrame."""
    opt = options or AnalysisOptions()
    res = AnalysisResult(dataset=opt.dataset_name, rows=int(len(df)),
                         columns=int(df.shape[1]))

    with _Stage(res, "profiling"):
        res.schema = infer_schema(df, name=opt.dataset_name)

    if res.schema is None:
        res.warnings.append("profiling failed; no further analysis is possible")
        return res

    with _Stage(res, "quality"):
        res.quality = assess_quality(df, res.schema)

    if opt.run_privacy:
        with _Stage(res, "privacy"):
            res.privacy = detect_sensitive_fields(
                df, res.schema, drill_down_granted=opt.allow_drill_down)

    with _Stage(res, "roles"):
        roles = resolve_roles(df, res.schema)
        res.roles = dict(roles)
        res.role_audit = roles.explain() if hasattr(roles, "explain") else []

    roles = resolve_roles(df, res.schema)

    with _Stage(res, "domain"):
        res.domain = detect_domain(df, res.schema, roles)

    domain = res.domain.domain if res.domain else None

    if opt.use_plugins:
        with _Stage(res, "plugin"):
            res.plugin = get_plugin(domain)

    with _Stage(res, "kpis"):
        res.scorecard = compute_kpis(df, roles, domain, max_kpis=opt.max_kpis)

    if res.scorecard is None:
        res.warnings.append("no KPIs could be computed; check role resolution")
        return res

    seasonal = None
    if res.scorecard.seasonality and res.scorecard.seasonality.get("detected"):
        seasonal = res.scorecard.seasonality.get("period")

    # ---- anomalies ---- #
    if opt.run_anomalies:
        with _Stage(res, "anomalies"):
            report = AnomalyReport()
            for kpi in res.scorecard.kpis:
                values = [p.get("value") for p in kpi.series]
                labels = [p.get("label") or p.get("period") for p in kpi.series]
                if len(values) < 6:
                    continue
                report.scanned_metrics += 1
                report.scanned_points += len(values)
                report.anomalies.extend(detect_anomalies(
                    kpi.id, kpi.label, values, labels, seasonal_period=seasonal))
            primary = res.scorecard.primary()
            revenue_col = roles.get("revenue") if hasattr(roles, "get") else None
            if primary and revenue_col:
                for dim in (res.schema.dimensions or [])[:4]:
                    report.segment_anomalies.extend(
                        detect_segment_anomalies(df, dim, revenue_col, primary.id))
            report.segment_anomalies = report.segment_anomalies[:8]
            report.method_notes = [
                "Point anomalies use a robust median/MAD z-score on the seasonally "
                "adjusted residual, so an outlier cannot inflate its own threshold.",
                "Level shifts are detected by binary segmentation and validated with a "
                "Welch t-test; periods after a shift are attributed to it rather than "
                "reported as repeated point anomalies.",
            ]
            report.anomalies.sort(key=lambda a: (-a.severity.rank, a.metric))
            res.anomalies = report

    # ---- root cause on the metrics that actually moved ---- #
    if opt.run_root_cause:
        with _Stage(res, "root_cause"):
            # The headline metric is always investigated first, whatever its rank by
            # size of move. A 6% revenue drop matters more to the business than a 118%
            # swing in a small ratio, and the report's headline must match its "why".
            others = [k for k in res.scorecard.kpis
                      if k.delta_pct is not None and k.is_favourable is False]
            others.sort(key=lambda k: -abs(k.delta_pct))
            primary = res.scorecard.primary()
            candidates = ([primary] if primary and primary.delta_pct is not None else [])
            seen = {k.id for k in candidates}
            candidates += [k for k in others if k.id not in seen]
            for kpi in candidates[:opt.max_root_causes]:
                definition = get_kpi(kpi.id)
                if definition is None:
                    continue
                tree = analyse_root_cause(
                    df, roles, definition, res.scorecard.date_column,
                    res.scorecard.grain,
                    _ordered_dimensions(res, kpi.id, opt.max_dimensions),
                )
                if tree:
                    res.root_causes.append(tree)

    # ---- forecasts ---- #
    if opt.run_forecast:
        with _Stage(res, "forecast"):
            horizon = opt.forecast_horizon
            if res.plugin is not None:
                # The plugin knows the planning cycle; forecasting further than the
                # business plans is precision the data cannot support.
                horizon = min(horizon, res.plugin.forecast.horizon) or horizon
                seasonal = seasonal or res.plugin.forecast.seasonal_period
            future_labels = _future_labels(res.scorecard, horizon)
            for kpi in res.scorecard.kpis[:4]:
                values = [p.get("value") for p in kpi.series]
                labels = [p.get("label") or p.get("period") for p in kpi.series]
                fc = forecast_series(kpi.id, kpi.label, values, labels,
                                     horizon=horizon,
                                     seasonal_period=seasonal,
                                     future_labels=future_labels)
                if fc:
                    res.forecasts.append(fc)

    # ---- chart narratives ---- #
    with _Stage(res, "narratives"):
        res.narratives = _build_narratives(df, res, roles)

    # ---- chart specs (each one carries its own narrative) ---- #
    with _Stage(res, "charts"):
        res.charts = build_all_charts(df, res, roles)

    # ---- recommendations ---- #
    with _Stage(res, "recommendations"):
        ctx = RuleContext(
            scorecard=res.scorecard,
            root_cause=res.root_causes[0] if res.root_causes else None,
            quality=res.quality, anomalies=res.anomalies,
            forecasts=res.forecasts, domain=domain,
        )
        res.recommendations = generate_recommendations(ctx, limit=opt.max_recommendations)

    # ---- data governance: how far may this analysis be trusted? ---- #
    if opt.run_governance:
        with _Stage(res, "governance"):
            res.governance = assess_governance(
                res, source=opt.source, source_type=opt.source_type,
                owner=opt.owner, privacy=res.privacy, df=df)

    # ---- recommendation governance: ownership, approval, audit, degraded confidence ---- #
    with _Stage(res, "recommendation_governance"):
        apply_governance(res.recommendations, plugin=res.plugin,
                         governance=res.governance)

    # ---- executive report ---- #
    with _Stage(res, "report"):
        res.report = build_executive_report(res, polisher=opt.polisher)

    return res


def _ordered_dimensions(res: AnalysisResult, metric: str, limit: int) -> list[str]:
    """Rank dimensions the way the domain manages the business.

    The engine can decompose by any dimension. The plugin knows which ones a
    business in this domain actually holds someone accountable for, so those are
    investigated first and declared confounders are pushed to the back rather
    than silently dropped - a rejected branch is still evidence.
    """
    available = list(res.schema.dimensions or []) if res.schema else []
    plugin = res.plugin
    if plugin is None:
        return available[:limit]
    hint = plugin.hint_for(metric)
    preferred = list(hint.decompose_by) if hint else list(plugin.priority_dimensions)
    confounders = set(hint.known_confounders) if hint else set()
    head = [d for d in preferred if d in available]
    tail = [d for d in available if d not in head and d not in confounders]
    deferred = [d for d in available if d in confounders]
    return (head + tail + deferred)[:limit]


def _build_narratives(df: pd.DataFrame, res: AnalysisResult, roles: Any
                      ) -> list[ChartNarrative]:
    """One insight panel per chart the demo app renders. No chart without one."""
    out: list[ChartNarrative] = []
    sc = res.scorecard
    if sc is None:
        return out

    for kpi in sc.kpis[:6]:
        values = [p.get("value") for p in kpi.series]
        labels = [p.get("label") or p.get("period") for p in kpi.series]
        if len([v for v in values if v is not None]) >= 3:
            out.append(describe_series(
                f"trend-{kpi.id}", f"{kpi.label} over time", values, labels,
                unit=kpi.unit, metric_label=kpi.label,
                higher_is_better=kpi.higher_is_better,
                seasonal_period=(sc.seasonality or {}).get("period"),
            ))

    primary = sc.primary()
    revenue_col = roles.get("revenue") if hasattr(roles, "get") else None
    date_col = sc.date_column
    if primary and revenue_col and revenue_col in df.columns:
        for dim in (res.schema.dimensions or [])[:3]:
            if dim not in df.columns:
                continue
            grouped = df.groupby(df[dim].astype(str))[revenue_col].sum()
            grouped = grouped.sort_values(ascending=False).head(12)
            if grouped.size >= 2:
                out.append(describe_breakdown(
                    f"breakdown-{dim}", f"{primary.label} by {dim.replace('_', ' ')}",
                    [str(s) for s in grouped.index], [float(v) for v in grouped.to_numpy()],
                    unit=primary.unit, dimension=dim.replace("_", " "),
                    metric_label=primary.label,
                ))

        if date_col and date_col in df.columns and res.root_causes:
            tree = res.root_causes[0]
            nodes = tree.nodes[:8]
            if nodes:
                out.append(describe_comparison(
                    f"comparison-{tree.metric}",
                    f"{tree.metric_label}: {tree.current_period} vs {tree.baseline_period}",
                    [n.segment for n in nodes],
                    [n.current or 0.0 for n in nodes],
                    [n.baseline or 0.0 for n in nodes],
                    unit=tree.unit, dimension=nodes[0].dimension.replace("_", " "),
                    metric_label=tree.metric_label,
                    current_label=tree.current_period, baseline_label=tree.baseline_period,
                ))

        series = pd.to_numeric(df[revenue_col], errors="coerce").dropna()
        if series.size >= 20:
            sample = series.sample(min(20000, series.size), random_state=7)
            out.append(describe_distribution(
                f"distribution-{revenue_col}",
                f"Distribution of {revenue_col.replace('_', ' ')}",
                [float(v) for v in sample.to_numpy()],
                unit="currency", metric_label=revenue_col.replace("_", " ").title(),
            ))
    return out
