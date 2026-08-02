"""KPI computation engine.

Turns a raw table into a scorecard: current value, comparison-period value,
period-over-period delta, a time series at the natural grain, a statistical
verdict on whether the movement is real, and the segment breakdown that the
root-cause engine and the narrator consume.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from ..statistics.timeseries import TrendResult, detect_seasonality, mann_kendall
from ..types import Domain, to_jsonable
from .registry import KPIDefinition, kpis_for_domain
from .roles import RoleMap

__all__ = ["KPIValue", "KPIScorecard", "compute_kpis", "period_grain", "build_periods"]


@dataclass
class KPIValue:
    id: str
    label: str
    description: str
    unit: str
    value: float | None
    previous_value: float | None
    delta: float | None
    delta_pct: float | None
    direction: str                     # up | down | flat
    is_favourable: bool | None
    higher_is_better: bool
    additive: bool
    formula: str
    series: list[dict[str, Any]] = field(default_factory=list)
    trend: dict[str, Any] | None = None
    sparkline: list[float] = field(default_factory=list)
    period_label: str = ""
    comparison_label: str = ""
    contribution_ready: bool = False
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


@dataclass
class KPIScorecard:
    domain: Domain
    grain: str
    date_column: str | None
    period_label: str
    comparison_label: str
    kpis: list[KPIValue]
    roles: list[dict[str, Any]]
    seasonality: dict[str, Any] | None = None

    def primary(self) -> KPIValue | None:
        """The KPI an executive would look at first."""
        if not self.kpis:
            return None
        starred = [k for k in self.kpis if "north-star" in k.tags and k.value is not None]
        if starred:
            return starred[0]
        with_value = [k for k in self.kpis if k.value is not None]
        return with_value[0] if with_value else self.kpis[0]

    def to_dict(self) -> dict[str, Any]:
        d = to_jsonable(asdict(self))
        primary = self.primary()
        d["primary_kpi_id"] = primary.id if primary else None
        return d


_GRAIN_FREQ = {"daily": "D", "weekly": "W-MON", "monthly": "MS", "quarterly": "QS",
               "yearly": "YS", "hourly": "h"}
_GRAIN_ORDER = ["hourly", "daily", "weekly", "monthly", "quarterly", "yearly"]


def period_grain(dates: pd.Series, target_points: int = 26) -> str:
    """Choose the reporting grain that yields a readable number of points.

    A two-year daily extract is summarised monthly; a three-week extract stays
    daily.  The same grain is then used everywhere, so the KPI cards, the charts
    and the root-cause windows always agree.
    """
    valid = pd.to_datetime(dates, errors="coerce").dropna()
    if valid.empty:
        return "daily"
    span_days = max((valid.max() - valid.min()).days, 1)
    for grain, days in (("hourly", 1 / 24), ("daily", 1), ("weekly", 7),
                        ("monthly", 30.4), ("quarterly", 91), ("yearly", 365)):
        if span_days / days <= target_points * 1.6:
            return grain
    return "yearly"


def build_periods(df: pd.DataFrame, date_col: str, grain: str) -> pd.Series:
    """Bucket every row into its reporting period (returns a period-start series)."""
    dt = pd.to_datetime(df[date_col], errors="coerce")
    freq = _GRAIN_FREQ.get(grain, "D")
    return dt.dt.to_period(_pandas_period(freq)).dt.start_time


def _pandas_period(freq: str) -> str:
    return {"h": "h", "D": "D", "W-MON": "W", "MS": "M", "QS": "Q", "YS": "Y"}.get(freq, "D")


def _fmt_period(ts: pd.Timestamp, grain: str) -> str:
    if grain == "hourly":
        return ts.strftime("%Y-%m-%d %H:00")
    if grain == "daily":
        return ts.strftime("%Y-%m-%d")
    if grain == "weekly":
        return f"W{ts.isocalendar().week:02d} {ts.year}"
    if grain == "monthly":
        return ts.strftime("%b %Y")
    if grain == "quarterly":
        return f"Q{((ts.month - 1) // 3) + 1} {ts.year}"
    return str(ts.year)


def compute_kpis(
    df: pd.DataFrame,
    roles: RoleMap,
    domain: Domain,
    date_col: str | None = None,
    grain: str | None = None,
    max_kpis: int = 10,
) -> KPIScorecard:
    """Compute the KPI scorecard for a dataset."""
    date_col = date_col or roles.get("date")
    definitions = kpis_for_domain(domain, roles)[:max_kpis]

    if date_col is None or date_col not in df.columns:
        kpis = [
            KPIValue(d.id, d.label, d.description, d.unit, _safe(d, df, roles), None, None,
                     None, "flat", None, d.higher_is_better, d.additive, d.formula,
                     tags=list(d.tags))
            for d in definitions
        ]
        return KPIScorecard(domain, "none", None, "All data", "-", kpis, roles.explain())

    grain = grain or period_grain(df[date_col])
    periods = build_periods(df, date_col, grain)
    frame = df.assign(__period=periods).dropna(subset=["__period"])
    ordered_periods = sorted(frame["__period"].unique())
    if not ordered_periods:
        return KPIScorecard(domain, grain, date_col, "-", "-", [], roles.explain())

    current_period = ordered_periods[-1]
    previous_period = ordered_periods[-2] if len(ordered_periods) > 1 else None
    current_mask = frame["__period"] == current_period
    previous_mask = frame["__period"] == previous_period if previous_period is not None else None

    period_label = _fmt_period(pd.Timestamp(current_period), grain)
    comparison_label = (_fmt_period(pd.Timestamp(previous_period), grain)
                        if previous_period is not None else "-")

    kpis: list[KPIValue] = []
    for d in definitions:
        current = _safe(d, frame[current_mask], roles)
        previous = (_safe(d, frame[previous_mask], roles)
                    if previous_mask is not None else None)
        series: list[dict[str, Any]] = []
        for p in ordered_periods:
            v = _safe(d, frame[frame["__period"] == p], roles)
            series.append({"period": pd.Timestamp(p).isoformat(),
                           "label": _fmt_period(pd.Timestamp(p), grain),
                           "value": v})
        values = [s["value"] for s in series if s["value"] is not None]
        trend: TrendResult | None = mann_kendall(values) if len(values) >= 4 else None

        delta = (current - previous) if (current is not None and previous is not None) else None
        delta_pct = (delta / abs(previous) * 100.0) if (delta is not None and previous) else None
        direction = "flat" if delta is None or abs(delta_pct or 0) < 0.5 else (
            "up" if delta > 0 else "down")
        favourable = None
        if direction != "flat":
            favourable = (direction == "up") == d.higher_is_better

        kpis.append(KPIValue(
            id=d.id, label=d.label, description=d.description, unit=d.unit,
            value=current, previous_value=previous, delta=delta,
            delta_pct=delta_pct, direction=direction, is_favourable=favourable,
            higher_is_better=d.higher_is_better, additive=d.additive, formula=d.formula,
            series=series, trend=trend.to_dict() if trend else None,
            sparkline=values[-24:],
            period_label=period_label, comparison_label=comparison_label,
            contribution_ready=d.additive, tags=list(d.tags),
        ))

    seasonality = None
    primary_series = next((k.series for k in kpis if k.value is not None), None)
    if primary_series:
        vals = [s["value"] for s in primary_series if s["value"] is not None]
        labels = [s["label"] for s in primary_series if s["value"] is not None]
        candidates = {"daily": (7, 30), "weekly": (4, 13, 52), "monthly": (12, 4),
                      "hourly": (24, 168)}.get(grain, (7, 12))
        seasonality = detect_seasonality(vals, candidates, labels).to_dict()

    return KPIScorecard(domain, grain, date_col, period_label, comparison_label,
                        kpis, roles.explain(), seasonality)


def _safe(definition: KPIDefinition, frame: pd.DataFrame, roles: RoleMap) -> float | None:
    """Run an aggregator defensively - a broken KPI must never break the report."""
    if frame is None or frame.empty:
        return None
    try:
        value = definition.aggregate(frame, roles)
    except Exception:  # pragma: no cover - defensive
        return None
    if value is None:
        return None
    value = float(value)
    return None if (np.isnan(value) or np.isinf(value)) else value
