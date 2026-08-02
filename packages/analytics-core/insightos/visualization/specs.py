"""Chart specifications - the contract between the analytics engine and any UI.

A :class:`ChartSpec` is a *renderer-agnostic* description of a chart: what kind it
is, what data it holds, how each field should be formatted, and - critically - the
:class:`~insightos.narrative.writer.ChartNarrative` that explains it.

The narrative is not optional. ``ChartSpec`` cannot be constructed without one,
which is how the project's "charts never exist without explanations" rule is
enforced structurally rather than by convention.

The React frontend consumes these specs directly; a Power BI or Tableau exporter
would consume the same objects. That is the point of keeping them free of any
library-specific vocabulary (no "series", no "traces", no "marks").
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from ..narrative.writer import (
    ChartNarrative,
    describe_breakdown,
    describe_series,
    format_value,
)
from ..types import to_jsonable

__all__ = [
    "ChartSpec",
    "build_hero_series_chart",
    "build_composition_chart",
    "build_segment_donut",
    "build_segment_table",
    "build_root_cause_waterfall",
    "build_forecast_chart",
    "build_quality_chart",
    "build_all_charts",
]


@dataclass
class ChartSpec:
    """A chart plus the reason it is worth looking at."""

    id: str
    kind: str                     # line | area | marimekko | donut | table | waterfall | bar
    title: str
    subtitle: str = ""
    data: list[dict[str, Any]] = field(default_factory=list)
    encoding: dict[str, Any] = field(default_factory=dict)
    unit: str = "number"
    narrative: ChartNarrative | None = None
    footnote: str = ""

    def __post_init__(self) -> None:
        if self.narrative is None:
            raise ValueError(
                f"ChartSpec '{self.id}' has no narrative. Every chart in InsightOS "
                "must explain itself; construct the narrative before the spec."
            )

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["narrative"] = self.narrative.to_dict() if self.narrative else None
        return to_jsonable(d)


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def _num(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce")


def _top_segments(frame: pd.DataFrame, dimension: str, value_col: str,
                  limit: int = 8) -> pd.DataFrame:
    grouped = (frame.groupby(dimension, dropna=True)[value_col]
               .sum().sort_values(ascending=False))
    if len(grouped) > limit:
        head = grouped.iloc[: limit - 1]
        rest = float(grouped.iloc[limit - 1:].sum())
        label = f"Other ({len(grouped) - limit + 1})"
        grouped = pd.concat([head, pd.Series({label: rest}, dtype="float64")])
    out = grouped.rename("value").rename_axis("name").reset_index()
    out["name"] = out["name"].astype(str)
    return out


# --------------------------------------------------------------------------- #
# 1. hero series - the big number and its history
# --------------------------------------------------------------------------- #

def build_hero_series_chart(kpi: Any) -> ChartSpec | None:
    """The headline metric over time, as shown in the dashboard hero panel."""
    points = [p for p in (kpi.series or []) if p.get("value") is not None]
    if len(points) < 3:
        return None

    values = [float(p["value"]) for p in points]
    labels = [str(p.get("label") or p.get("period")) for p in points]
    narrative = describe_series(kpi.id, kpi.label, values, labels, unit=kpi.unit)

    data = [
        {
            "period": p.get("period"),
            "label": labels[i],
            "value": values[i],
            "display": format_value(values[i], kpi.unit),
        }
        for i, p in enumerate(points)
    ]
    return ChartSpec(
        id=f"hero.{kpi.id}",
        kind="area",
        title=kpi.label,
        subtitle=f"{format_value(kpi.value, kpi.unit)} in {kpi.period_label or 'latest period'}",
        data=data,
        encoding={"x": "label", "y": "value", "valueFormat": kpi.unit},
        unit=kpi.unit,
        narrative=narrative,
    )


# --------------------------------------------------------------------------- #
# 2. composition (marimekko) - width = share, height = internal split
# --------------------------------------------------------------------------- #

def build_composition_chart(df: pd.DataFrame, dimension: str, sub_dimension: str | None,
                            value_col: str, label: str, unit: str = "currency",
                            max_groups: int = 7, max_children: int = 6) -> ChartSpec | None:
    """A marimekko: every group's width is its share of the total.

    This is the chart in the reference design. It answers "what is this business
    made of?" in one glance, which a pie chart cannot do once a second dimension
    matters.
    """
    if dimension not in df.columns or value_col not in df.columns:
        return None

    frame = df[[c for c in {dimension, sub_dimension, value_col} if c and c in df.columns]].copy()
    frame[value_col] = _num(frame[value_col])
    frame = frame.dropna(subset=[value_col, dimension])
    if frame.empty:
        return None

    totals = _top_segments(frame, dimension, value_col, limit=max_groups)
    grand = float(totals["value"].sum()) or 1.0

    groups: list[dict[str, Any]] = []
    for _, row in totals.iterrows():
        name = str(row["name"])
        value = float(row["value"])
        children: list[dict[str, Any]] = []
        if sub_dimension and sub_dimension in frame.columns and not name.startswith("Other ("):
            sub = frame[frame[dimension] == name]
            child_totals = _top_segments(sub, sub_dimension, value_col, limit=max_children)
            for _, c in child_totals.iterrows():
                cv = float(c["value"])
                children.append({
                    "name": str(c["name"]),
                    "value": cv,
                    "display": format_value(cv, unit),
                    "shareOfGroup": round(cv / value * 100.0, 2) if value else 0.0,
                })
        groups.append({
            "name": name,
            "value": value,
            "display": format_value(value, unit),
            "share": round(value / grand * 100.0, 2),
            "children": children,
        })

    narrative = describe_breakdown(
        f"composition.{dimension}",
        f"{label} by {dimension.replace('_', ' ')}",
        [g["name"] for g in groups],
        [g["value"] for g in groups],
        unit=unit,
    )
    return ChartSpec(
        id=f"composition.{dimension}",
        kind="marimekko",
        title=f"{label} composition",
        subtitle=f"by {dimension.replace('_', ' ')}"
                 + (f", split by {sub_dimension.replace('_', ' ')}" if sub_dimension else ""),
        data=groups,
        encoding={"group": "name", "width": "share", "child": "children", "unit": unit},
        unit=unit,
        narrative=narrative,
        footnote=f"Total {format_value(grand, unit)} across {len(groups)} groups.",
    )


# --------------------------------------------------------------------------- #
# 3. donut + 4. sortable table - the paired breakdown panel
# --------------------------------------------------------------------------- #

def _breakdown_frame(df: pd.DataFrame, dimension: str, value_col: str,
                     date_col: str | None, periods: pd.Series | None,
                     limit: int) -> pd.DataFrame | None:
    if dimension not in df.columns or value_col not in df.columns:
        return None
    frame = df[[dimension, value_col]].copy()
    frame[value_col] = _num(frame[value_col])
    frame = frame.dropna(subset=[value_col, dimension])
    if frame.empty:
        return None

    current = _top_segments(frame, dimension, value_col, limit=limit)
    current["share"] = current["value"] / (current["value"].sum() or 1.0) * 100.0

    # period-over-period delta per segment, when a usable date column exists
    deltas: dict[str, float | None] = {}
    if periods is not None and len(periods) == len(df):
        ordered = sorted(pd.Series(periods).dropna().unique())
        if len(ordered) >= 2:
            cur_mask, base_mask = periods == ordered[-1], periods == ordered[-2]
            cur = df[cur_mask].groupby(dimension)[value_col].apply(lambda s: _num(s).sum())
            base = df[base_mask].groupby(dimension)[value_col].apply(lambda s: _num(s).sum())
            for name in current["name"]:
                b, c = float(base.get(name, np.nan)), float(cur.get(name, np.nan))
                deltas[name] = ((c - b) / abs(b) * 100.0) if b and np.isfinite(b) and b != 0 else None
    current["deltaPct"] = [deltas.get(n) for n in current["name"]]
    return current


def build_segment_donut(df: pd.DataFrame, dimension: str, value_col: str, label: str,
                        unit: str = "currency", limit: int = 8) -> ChartSpec | None:
    table = _breakdown_frame(df, dimension, value_col, None, None, limit)
    if table is None:
        return None
    data = [
        {
            "name": str(r["name"]),
            "value": float(r["value"]),
            "display": format_value(float(r["value"]), unit),
            "share": round(float(r["share"]), 2),
        }
        for _, r in table.iterrows()
    ]
    narrative = describe_breakdown(
        f"donut.{dimension}", f"{label} share by {dimension.replace('_', ' ')}",
        [d["name"] for d in data], [d["value"] for d in data], unit=unit,
    )
    return ChartSpec(
        id=f"donut.{dimension}",
        kind="donut",
        title=f"{label} share",
        subtitle=f"by {dimension.replace('_', ' ')}",
        data=data,
        encoding={"name": "name", "value": "value", "unit": unit},
        unit=unit,
        narrative=narrative,
    )


def build_segment_table(df: pd.DataFrame, dimension: str, value_col: str, label: str,
                        periods: pd.Series | None = None, unit: str = "currency",
                        limit: int = 12) -> ChartSpec | None:
    table = _breakdown_frame(df, dimension, value_col, None, periods, limit)
    if table is None:
        return None

    rows = []
    for _, r in table.iterrows():
        delta = r["deltaPct"]
        rows.append({
            "name": str(r["name"]),
            "value": float(r["value"]),
            "display": format_value(float(r["value"]), unit),
            "share": round(float(r["share"]), 2),
            "deltaPct": None if delta is None or not np.isfinite(delta) else round(float(delta), 1),
        })

    movers = [r for r in rows if r["deltaPct"] is not None]
    narrative = describe_breakdown(
        f"table.{dimension}", f"{label} by {dimension.replace('_', ' ')}",
        [r["name"] for r in rows], [r["value"] for r in rows], unit=unit,
    )
    if movers:
        best = max(movers, key=lambda r: r["deltaPct"])
        worst = min(movers, key=lambda r: r["deltaPct"])
        if best["name"] != worst["name"]:
            narrative.bullets.append(
                f"{best['name']} grew fastest at {best['deltaPct']:+.1f}% period-over-period, "
                f"while {worst['name']} moved {worst['deltaPct']:+.1f}%."
            )
    return ChartSpec(
        id=f"table.{dimension}",
        kind="table",
        title=f"{label} by {dimension.replace('_', ' ')}",
        subtitle="Sortable - share of total shown as a bar, period-over-period move as a pill",
        data=rows,
        encoding={
            "columns": [
                {"key": "name", "label": dimension.replace("_", " ").title(), "type": "text"},
                {"key": "share", "label": "% of total", "type": "bar"},
                {"key": "display", "label": label, "type": "value", "align": "right"},
                {"key": "deltaPct", "label": "Change", "type": "delta"},
            ]
        },
        unit=unit,
        narrative=narrative,
    )


# --------------------------------------------------------------------------- #
# 5. root cause waterfall
# --------------------------------------------------------------------------- #

def _primary_dimension(tree: Any) -> str:
    scores = getattr(tree, "dimension_scores", None) or []
    return str(getattr(scores[0], "dimension", "")) if scores else ""


def build_root_cause_waterfall(tree: Any) -> ChartSpec | None:
    """Contribution waterfall: baseline -> each driver -> current."""
    if not tree or not getattr(tree, "nodes", None):
        return None

    unit = getattr(tree, "unit", "number") or "number"
    data: list[dict[str, Any]] = [{
        "name": tree.baseline_period or "Baseline",
        "kind": "total",
        "value": tree.baseline_value,
        "display": format_value(tree.baseline_value, unit),
    }]
    for node in tree.nodes[:8]:
        if node.delta is None:
            continue
        data.append({
            "name": f"{node.segment}",
            "kind": node.role,
            "value": float(node.delta),
            "display": format_value(float(node.delta), unit),
            "contributionPct": node.contribution_pct,
            "significant": bool(node.p_value_adjusted_significant),
            "pValue": node.p_value,
        })
    data.append({
        "name": tree.current_period or "Current",
        "kind": "total",
        "value": tree.current_value,
        "display": format_value(tree.current_value, unit),
    })

    narrative = ChartNarrative(
        chart_id=f"rootcause.{tree.metric}",
        title=f"What moved {tree.metric_label}",
        headline=tree.headline,
        bullets=list(getattr(tree, "narrative", []) or [])[:6],
        method_notes=[
            "Bars show each segment's contribution to the total movement, not its own "
            "growth rate. Segments that moved against the total are shown as offsets.",
            "Significance is tested against the movement of the business as a whole and "
            "corrected with Benjamini-Hochberg at a 10% false discovery rate.",
        ],
    )
    return ChartSpec(
        id=f"rootcause.{tree.metric}",
        kind="waterfall",
        title=f"Why {tree.metric_label} moved",
        subtitle=f"{tree.baseline_period} to {tree.current_period}, decomposed by "
                 f"{_primary_dimension(tree).replace('_', ' ')}",
        data=data,
        encoding={"x": "name", "y": "value", "kind": "kind", "unit": unit},
        unit=unit,
        narrative=narrative,
    )


# --------------------------------------------------------------------------- #
# 6. forecast
# --------------------------------------------------------------------------- #

def build_forecast_chart(forecast: Any, kpi: Any | None = None) -> ChartSpec | None:
    if not forecast or not getattr(forecast, "points", None):
        return None
    unit = getattr(kpi, "unit", "number") if kpi else "number"

    data: list[dict[str, Any]] = []
    if kpi is not None:
        for p in (kpi.series or [])[-18:]:
            if p.get("value") is None:
                continue
            data.append({
                "label": str(p.get("label") or p.get("period")),
                "actual": float(p["value"]),
                "forecast": None, "lower": None, "upper": None,
            })
    if data:
        data[-1]["forecast"] = data[-1]["actual"]
        data[-1]["lower"] = data[-1]["actual"]
        data[-1]["upper"] = data[-1]["actual"]

    for p in forecast.points:
        data.append({
            "label": p.period,
            "actual": None,
            "forecast": p.value,
            "lower": p.lower,
            "upper": p.upper,
        })

    # Every chart must carry an explanation, and an explanation is more than a
    # headline: derive the substantive points from the forecast itself so the
    # panel is never empty just because the model raised no caveats.
    bullets: list[str] = []
    last_actual = next((row["actual"] for row in reversed(data)
                        if row.get("actual") is not None), None)
    final = forecast.points[-1]
    if last_actual not in (None, 0):
        move = (final.value - last_actual) / abs(last_actual) * 100.0
        direction = "rise" if move > 0 else "fall" if move < 0 else "hold flat"
        bullets.append(
            f"Central path: {forecast.metric_label} is projected to {direction} "
            f"{abs(move):.1f}% to {final.value:,.2f} by {final.period}."
        )
    if final.lower is not None and final.upper is not None and final.value:
        width = (final.upper - final.lower) / abs(final.value) * 100.0
        bullets.append(
            f"Uncertainty: the 80% interval at the horizon spans "
            f"{final.lower:,.2f} to {final.upper:,.2f}, or \u00b1{width / 2:.1f}% of the "
            "central path. Plan against the interval, not the line."
        )
    bullets.append(
        f"Benchmark: {'beats' if forecast.beats_naive else 'does not beat'} a naive "
        f"seasonal forecast (MASE {forecast.mase}), so the projection "
        f"{'carries information' if forecast.beats_naive else 'is shown for reference only'}."
    )
    bullets.extend(list(forecast.caveats or [])[:3])

    narrative = ChartNarrative(
        chart_id=f"forecast.{forecast.metric}",
        title=f"{forecast.metric_label} outlook",
        headline=forecast.narrative or f"{forecast.metric_label} outlook",
        bullets=bullets[:6],
        method_notes=[
            f"Model: {forecast.model}. {forecast.model_rationale}",
            f"Accuracy is measured by MASE ({forecast.mase}) on rolling backtests, "
            "so the interval reflects errors the model actually made rather than errors "
            "it assumes it would make.",
        ],
    )
    return ChartSpec(
        id=f"forecast.{forecast.metric}",
        kind="forecast",
        title=f"{forecast.metric_label} - next {len(forecast.points)} periods",
        subtitle=("Beats the naive benchmark" if forecast.beats_naive
                  else "Does not beat a naive benchmark - shown for reference only"),
        data=data,
        encoding={"x": "label", "actual": "actual", "forecast": "forecast",
                  "band": ["lower", "upper"], "unit": unit},
        unit=unit,
        narrative=narrative,
    )


# --------------------------------------------------------------------------- #
# 7. data quality
# --------------------------------------------------------------------------- #

def build_quality_chart(report: Any) -> ChartSpec | None:
    if not report or not getattr(report, "dimensions", None):
        return None
    data = [
        {"name": d.name.replace("_", " ").title(), "score": round(float(d.score), 1),
         "weight": d.weight, "detail": d.detail}
        for d in report.dimensions
    ]
    weakest = min(data, key=lambda d: d["score"]) if data else None
    narrative = ChartNarrative(
        chart_id="quality.dimensions",
        title="Data quality by dimension",
        headline=(f"The dataset scores {report.score:.1f}/100 (grade {report.grade}) "
                  f"across {len(data)} quality dimensions."),
        bullets=([f"{weakest['name']} is the weakest dimension at {weakest['score']:.1f}/100."]
                 if weakest else []) +
                [f"{i.title}: {i.detail}" for i in (report.issues or [])[:4]],
        method_notes=[
            "Each dimension is scored independently and combined with fixed weights, so "
            "a single bad column cannot silently drag the headline score.",
        ],
    )
    return ChartSpec(
        id="quality.dimensions",
        kind="bar",
        title="Data quality",
        subtitle=f"Overall {report.score:.1f}/100 - grade {report.grade}",
        data=data,
        encoding={"x": "name", "y": "score", "domain": [0, 100]},
        unit="score",
        narrative=narrative,
    )


# --------------------------------------------------------------------------- #
# orchestration
# --------------------------------------------------------------------------- #

#: A breakdown is only readable when the dimension has few enough levels that a
#: human can hold them in mind. Identifiers (customer_id, order_id) technically
#: qualify as categorical but produce a chart that is 99% "Other".
MAX_DIMENSION_CARDINALITY = 30
MAX_DIMENSION_SHARE = 0.5          # a column with >50% unique values is a key


def _chartable_dimensions(df: pd.DataFrame, result: Any, limit: int = 6) -> list[str]:
    """Dimensions that produce a chart worth showing an executive."""
    schema = result.schema
    keys = set()
    if schema is not None:
        keys |= set(getattr(schema, "primary_key", None) or [])
        for fk in (getattr(schema, "foreign_keys", None) or []):
            col = fk.get("column") if isinstance(fk, dict) else getattr(fk, "column", None)
            if col:
                keys.add(col)

    out: list[str] = []
    rows = max(len(df), 1)
    for dim in (getattr(schema, "dimensions", None) or []):
        if dim not in df.columns or dim in keys:
            continue
        n = int(df[dim].nunique(dropna=True))
        if n < 2 or n > MAX_DIMENSION_CARDINALITY or (n / rows) > MAX_DIMENSION_SHARE:
            continue
        out.append(dim)
        if len(out) >= limit:
            break
    return out


def _value_column_identity(value_col: str, roles: Any, scorecard: Any) -> tuple[str, str]:
    """Human label and unit for the column a breakdown is summing."""
    for kpi in (scorecard.kpis or []):
        if getattr(kpi, "source_column", None) == value_col:
            return kpi.label, kpi.unit
    role = next((r for r in ("revenue", "profit", "marketing_spend", "quantity")
                 if roles.get(r) == value_col), None)
    unit = {"revenue": "currency", "profit": "currency", "marketing_spend": "currency",
            "quantity": "number"}.get(role or "", "currency")
    return value_col.replace("_", " ").title(), unit


def build_all_charts(df: pd.DataFrame, result: Any, roles: Any) -> list[ChartSpec]:
    """Build the full chart set for an analysis, skipping anything unsupported."""
    charts: list[ChartSpec] = []
    sc = result.scorecard
    if sc is None:
        return charts

    value_col = roles.get("revenue") or roles.get("profit") or roles.get("quantity")
    dimensions = _chartable_dimensions(df, result)

    periods = None
    if sc.date_column and sc.date_column in df.columns and sc.grain:
        try:
            from ..kpi.engine import build_periods
            periods = build_periods(df, sc.date_column, sc.grain)
        except Exception:
            periods = None

    def _add(spec: ChartSpec | None) -> None:
        if spec is not None:
            charts.append(spec)

    for kpi in sc.kpis[:4]:
        _add(build_hero_series_chart(kpi))

    if value_col and dimensions:
        # The breakdown is of the *value column*, so it must be labelled in that
        # column's unit - not the primary KPI's. A ROAS-led marketing dataset still
        # breaks revenue down in currency, never in "x".
        label, unit = _value_column_identity(value_col, roles, sc)
        _add(build_composition_chart(df, dimensions[0],
                                     dimensions[1] if len(dimensions) > 1 else None,
                                     value_col, label, unit=unit))
        for dim in dimensions[:3]:
            _add(build_segment_donut(df, dim, value_col, label, unit=unit))
            _add(build_segment_table(df, dim, value_col, label, periods=periods, unit=unit))

    for tree in result.root_causes[:2]:
        _add(build_root_cause_waterfall(tree))

    by_id = {k.id: k for k in sc.kpis}
    for fc in result.forecasts:
        _add(build_forecast_chart(fc, by_id.get(fc.metric)))

    _add(build_quality_chart(result.quality))
    return charts
