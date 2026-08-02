"""Root-cause analysis engine - the signature capability of InsightOS.

A dashboard tells you revenue fell 18%.  This engine tells you *which* slices of
the business moved, how much of the 18% each one accounts for, whether the move
is statistically distinguishable from noise, which plausible causes are ruled
*out*, and it repeats the decomposition recursively until the explanation stops
improving.

Method
------
1.  **Windowing** - the current period is compared against the previous period,
    or against the same period one seasonal cycle ago when seasonality is
    detected, so a December drop is not blamed on November.
2.  **Additive decomposition** - for additive metrics (revenue, orders, spend)
    the total delta is exactly the sum of the segment deltas, so every segment's
    contribution share is exact rather than indicative.
3.  **Mix / rate decomposition** - for ratio metrics (AOV, margin %, CTR) the
    delta is split into a *rate* effect (segments changed) and a *mix* effect
    (the weight of segments changed), which is the difference between "customers
    are spending less" and "we sold to cheaper customers".
4.  **Significance** - each candidate driver is tested (Welch t on row values,
    Poisson on volumes, two-proportion z on rates) and the whole family of
    segment p-values within a dimension is corrected with Benjamini-Hochberg.
5.  **Recursion** - significant drivers are drilled into on the next dimension,
    producing a tree; a branch stops when it adds no explanatory power.
6.  **Exoneration** - dimensions and companion KPIs that did *not* move are
    reported explicitly, because ruling causes out is half of a root-cause
    investigation.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from ..kpi.registry import KPIDefinition
from ..kpi.roles import RoleMap
from ..statistics.tests import (
    benjamini_hochberg,
    poisson_rate_test,
    two_proportion_z_test,
    welch_t_test,
)
from ..types import Severity, to_jsonable

__all__ = ["RootCauseNode", "DimensionScore", "RootCauseTree", "analyse_root_cause"]


@dataclass
class RootCauseNode:
    """One explanatory branch: a segment of a dimension and how it moved."""

    dimension: str
    segment: str
    path: list[str]
    current: float | None
    baseline: float | None
    delta: float | None
    delta_pct: float | None
    contribution_pct: float | None      # share of the parent's total delta
    share_current_pct: float | None     # weight of this segment now
    share_baseline_pct: float | None
    share_change_pp: float | None
    expected_delta: float | None = None  # if the segment had moved with the whole
    excess_delta: float | None = None    # delta - expected_delta ("unexpectedness")
    excess_pct: float | None = None      # excess as % of the total movement
    growth_gap_pp: float | None = None   # segment growth - overall growth, in points
    rate_effect: float | None = None
    mix_effect: float | None = None
    rows_current: int = 0
    rows_baseline: int = 0
    p_value: float | None = None
    p_value_adjusted_significant: bool | None = None
    test_name: str | None = None
    effect_size: float | None = None
    effect_magnitude: str | None = None
    role: str = "driver"                # driver | offset | stable
    severity: Severity = Severity.INFO
    narrative: str = ""
    children: list[RootCauseNode] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


@dataclass
class DimensionScore:
    dimension: str
    explanatory_power: float            # 0..1
    concentration: float                # concentration of *excess*, not of size
    dispersion: float                   # how unevenly segments grew
    net_coverage: float
    significant_segments: int
    segments_tested: int
    verdict: str

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


@dataclass
class RootCauseTree:
    metric: str
    metric_label: str
    unit: str
    current_period: str
    baseline_period: str
    comparison_type: str                # period_over_period | year_over_year
    current_value: float | None
    baseline_value: float | None
    delta: float | None
    delta_pct: float | None
    direction: str
    is_favourable: bool | None
    severity: Severity
    dimension_scores: list[DimensionScore]
    nodes: list[RootCauseNode]
    ruled_out: list[dict[str, Any]]
    headline: str
    narrative: list[str]
    confidence: float
    method_notes: list[str] = field(default_factory=list)
    excluded_dimensions: list[dict[str, str]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


# --------------------------------------------------------------------------- #
def _value(definition: KPIDefinition, frame: pd.DataFrame, roles: RoleMap) -> float | None:
    if frame is None or frame.empty:
        return None
    try:
        v = definition.aggregate(frame, roles)
    except Exception:  # pragma: no cover
        return None
    if v is None:
        return None
    v = float(v)
    return None if (math.isnan(v) or math.isinf(v)) else v


def _weight_column(definition: KPIDefinition, roles: RoleMap) -> str | None:
    """The natural denominator used to weight a ratio metric's mix effect."""
    for role in ("impressions", "clicks", "quantity", "revenue"):
        if role in roles:
            return roles[role]
    return None


def _segment_weight(definition: KPIDefinition, frame: pd.DataFrame, roles: RoleMap,
                    weight_col: str | None) -> float:
    if frame is None or frame.empty:
        return 0.0
    if weight_col and weight_col in frame:
        w = pd.to_numeric(frame[weight_col], errors="coerce").sum()
        if pd.notna(w) and w != 0:
            return float(abs(w))
    return float(len(frame))


def _truthy_count(frame: pd.DataFrame, col: str) -> int:
    s = frame[col]
    if s.dtype == bool:
        return int(s.fillna(False).sum())
    if pd.api.types.is_numeric_dtype(s):
        return int((pd.to_numeric(s, errors="coerce").fillna(0) > 0).sum())
    return int(s.astype(str).str.lower()
               .isin({"1", "true", "yes", "y", "fraud", "churned"}).sum())


def _test_segment(
    definition: KPIDefinition,
    roles: RoleMap,
    current: pd.DataFrame,
    baseline: pd.DataFrame,
    overall_volume_growth: float = 1.0,
    overall_mean_shift: dict[str, float] | None = None,
) -> tuple[float | None, str | None, float | None, str | None]:
    """Test whether this segment moved *differently from the business as a whole*.

    Testing a segment against its own past is the wrong null hypothesis: when the
    whole company falls 20%, every segment falls 20% and every segment looks
    "significant", which is how naive drill-down tools produce a wall of
    meaningless red.  The null used here is instead "this segment moved exactly in
    line with the total", implemented as

    * a Poisson test of the segment's volume against ``n_baseline x overall growth``;
    * a difference-in-differences Welch test of the segment's mean shift against
      the overall mean shift (both windows are centred on their overall means, so
      what is compared is the *change in the change*).

    The smaller of the two p-values is reported with the name of the test that
    produced it, and the caller applies Benjamini-Hochberg across the family.
    """
    candidates: list[tuple[float, str, float | None, str | None]] = []

    # --- volume: did this segment shrink faster than the business? --- #
    n1, n0 = len(current), len(baseline)
    if n0 > 0 and n1 + n0 >= 10:
        expected = max(n0 * max(overall_volume_growth, 1e-9), 1e-9)
        res = poisson_rate_test(n1, 1.0, expected, 1.0)
        if res.p_value is not None:
            candidates.append((res.p_value, "volume vs expected (Poisson)",
                               res.effect_size, res.effect_magnitude))

    # --- value: did the average ticket move differently? --- #
    value_role = next((r for r in ("revenue", "profit", "marketing_spend", "quantity",
                                   "salary", "transaction_amount")
                       if r in roles), None)
    if value_role and overall_mean_shift and value_role in overall_mean_shift:
        col = roles[value_role]
        if col in current.columns and col in baseline.columns:
            a = pd.to_numeric(current[col], errors="coerce").dropna().to_numpy()
            b = pd.to_numeric(baseline[col], errors="coerce").dropna().to_numpy()
            if a.size >= 12 and b.size >= 12:
                shift = overall_mean_shift[value_role]
                res = welch_t_test(a - shift, b)   # DiD: remove the global shift
                if res.p_value is not None:
                    candidates.append((res.p_value, "mean shift vs overall (Welch DiD)",
                                       res.effect_size, res.effect_magnitude))

    if definition.unit == "percent" and definition.required_roles:
        flag_role = next((r for r in definition.required_roles if r.endswith("_flag")), None)
        if flag_role and flag_role in roles:
            col = roles[flag_role]
            res = two_proportion_z_test(_truthy_count(current, col), len(current),
                                        _truthy_count(baseline, col), len(baseline))
            if res.p_value is not None:
                candidates.append((res.p_value, res.name, res.effect_size,
                                   res.effect_magnitude))

    if not candidates:
        res = poisson_rate_test(max(n1, 0), 1.0, max(n0, 1e-9), 1.0)
        return res.p_value, res.name, res.effect_size, res.effect_magnitude

    p, name, effect, magnitude = min(candidates, key=lambda c: c[0])
    return p, name, effect, magnitude


def _severity(contribution_pct: float | None, delta_pct: float | None,
              significant: bool) -> Severity:
    c = abs(contribution_pct or 0)
    d = abs(delta_pct or 0)
    if significant and (c >= 40 or d >= 30):
        return Severity.CRITICAL
    if significant and (c >= 20 or d >= 15):
        return Severity.HIGH
    if c >= 10 or d >= 10:
        return Severity.MEDIUM
    if c >= 3:
        return Severity.LOW
    return Severity.INFO


def _fmt(value: float | None, unit: str) -> str:
    if value is None:
        return "n/a"
    if unit == "currency":
        a = abs(value)
        if a >= 1_000_000_000:
            return f"{value / 1_000_000_000:.2f}B"
        if a >= 1_000_000:
            return f"{value / 1_000_000:.2f}M"
        if a >= 1_000:
            return f"{value / 1_000:.1f}K"
        return f"{value:,.2f}"
    if unit == "percent":
        return f"{value:.2f}%"
    if unit == "ratio":
        return f"{value:.2f}x"
    a = abs(value)
    if a >= 1_000_000:
        return f"{value / 1_000_000:.2f}M"
    if a >= 1_000:
        return f"{value:,.0f}"
    return f"{value:,.2f}"


def _pct(value: float | None, signed: bool = True, decimals: int = 1) -> str:
    """Percentages are frequently undefined here - a segment can have a zero baseline,
    or appear for the first time in the current period. Rendering that as 'n/a' is
    honest; rendering it as 0.0% or crashing is not."""
    if value is None or not np.isfinite(value):
        return "n/a"
    return f"{value:+.{decimals}f}%" if signed else f"{value:.{decimals}f}%"


# --------------------------------------------------------------------------- #
def _decompose(
    definition: KPIDefinition,
    roles: RoleMap,
    current: pd.DataFrame,
    baseline: pd.DataFrame,
    dimension: str,
    parent_delta: float,
    parent_baseline: float | None,
    path: list[str],
    min_support: int,
    max_segments: int,
    fdr: float,
) -> tuple[list[RootCauseNode], DimensionScore]:
    """Decompose one dimension into ranked, tested segment nodes."""
    weight_col = _weight_column(definition, roles) if not definition.additive else None
    segments = sorted(
        set(current[dimension].dropna().astype(str).unique())
        | set(baseline[dimension].dropna().astype(str).unique())
    )
    cur_key = current[dimension].astype(str)
    base_key = baseline[dimension].astype(str)

    total_weight_cur = _segment_weight(definition, current, roles, weight_col)
    total_weight_base = _segment_weight(definition, baseline, roles, weight_col)
    overall_base = _value(definition, baseline, roles)

    raw: list[dict[str, Any]] = []
    for seg in segments:
        c_frame = current[cur_key == seg]
        b_frame = baseline[base_key == seg]
        if len(c_frame) + len(b_frame) < min_support:
            continue
        c_val = _value(definition, c_frame, roles)
        b_val = _value(definition, b_frame, roles)
        w_cur = _segment_weight(definition, c_frame, roles, weight_col)
        w_base = _segment_weight(definition, b_frame, roles, weight_col)
        share_cur = (w_cur / total_weight_cur * 100.0) if total_weight_cur else None
        share_base = (w_base / total_weight_base * 100.0) if total_weight_base else None

        if definition.additive:
            delta = (c_val or 0.0) - (b_val or 0.0)
            rate_effect = mix_effect = None
        else:
            # classic mix / rate decomposition of a weighted average
            w1 = (w_cur / total_weight_cur) if total_weight_cur else 0.0
            w0 = (w_base / total_weight_base) if total_weight_base else 0.0
            m1, m0 = c_val, b_val
            if m1 is None or m0 is None or overall_base is None:
                delta = (m1 or 0.0) - (m0 or 0.0)
                rate_effect = mix_effect = None
            else:
                rate_effect = w1 * (m1 - m0)
                mix_effect = (w1 - w0) * (m0 - overall_base)
                delta = rate_effect + mix_effect
        raw.append({
            "segment": seg, "c_frame": c_frame, "b_frame": b_frame,
            "c_val": c_val, "b_val": b_val, "delta": delta,
            # `delta` is this segment's *contribution* to the total movement; for a
            # ratio metric that is not the same as how the segment itself moved,
            # which is what `own_delta` records and what the % change reports.
            "own_delta": (c_val - b_val) if (c_val is not None and b_val is not None) else None,
            "weight_base": ((w_base / total_weight_base) if total_weight_base else 0.0),
            "share_cur": share_cur, "share_base": share_base,
            "rate_effect": rate_effect, "mix_effect": mix_effect,
        })

    if not raw:
        return [], DimensionScore(dimension, 0.0, 0.0, 0.0, 0.0, 0, 0,
                                  "no segments with support")

    # ---- counterfactual: what if every segment had moved with the total? ---- #
    total_delta = sum(r["delta"] for r in raw)
    base_mass = sum(abs(r["b_val"] or 0.0) for r in raw) or 1e-12
    overall_growth = ((sum(r["c_val"] or 0.0 for r in raw) / sum(r["b_val"] or 0.0 for r in raw))
                      if sum(r["b_val"] or 0.0 for r in raw) else 1.0)
    for r in raw:
        weight = ((abs(r["b_val"] or 0.0) / base_mass) if definition.additive
                  else float(r["weight_base"]))
        r["expected"] = weight * total_delta
        r["excess"] = r["delta"] - r["expected"]
        r["excess_pct"] = (r["excess"] / abs(total_delta) * 100.0) if total_delta else None
        # A segment that exists in the baseline but not in the current period has
        # ``c_val is None`` - it did not grow by 0%, it stopped reporting - so the
        # growth gap is undefined rather than -100%.
        seg_growth = ((r["c_val"] / r["b_val"])
                      if (r["b_val"] and r["c_val"] is not None) else None)
        r["growth_gap_pp"] = ((seg_growth - overall_growth) * 100.0
                              if seg_growth is not None else None)

    abs_delta = sum(abs(r["delta"]) for r in raw) or 1e-12
    abs_excess = sum(abs(r["excess"]) for r in raw)
    # dispersion: how much of the movement is *not* explained by "everything moved
    # together" - a dimension where all segments fell 6% has dispersion ~0 and is
    # therefore not an explanation at all, however large its biggest segment is.
    dispersion = float(np.clip(abs_excess / abs_delta, 0.0, 1.0))
    concentration = (max(abs(r["excess"]) for r in raw) / abs_excess) if abs_excess else 0.0
    net_coverage = abs(total_delta) / abs_delta

    # volume growth of the whole comparison, for the counterfactual significance test
    overall_volume_growth = (len(current) / len(baseline)) if len(baseline) else 1.0
    overall_mean_shift: dict[str, float] = {}
    for role in ("revenue", "profit", "marketing_spend", "quantity", "salary"):
        if role in roles and roles[role] in current.columns:
            col = roles[role]
            m1 = pd.to_numeric(current[col], errors="coerce").mean()
            m0 = pd.to_numeric(baseline[col], errors="coerce").mean()
            if pd.notna(m1) and pd.notna(m0):
                overall_mean_shift[role] = float(m1 - m0)

    # Excess is near-symmetric when a dimension has only two segments, so ties are
    # broken in favour of the segment that moved *with* the total: an offsetting
    # segment is never the driver of a decline.
    def _rank(r: dict) -> tuple:
        aligned = 1 if (r["delta"] or 0.0) * total_delta > 0 else 0
        return (-round(abs(r["excess"]), 6), -aligned, -abs(r["delta"] or 0.0))

    raw.sort(key=_rank)
    considered = raw[: max_segments * 2]

    p_values: list[float] = []
    for r in considered:
        p, name, effect, magnitude = _test_segment(
            definition, roles, r["c_frame"], r["b_frame"],
            overall_volume_growth, overall_mean_shift)
        r.update({"p": p, "test": name, "effect": effect, "magnitude": magnitude})
        p_values.append(p if p is not None else 1.0)
    flags = benjamini_hochberg(p_values, fdr=fdr)

    nodes: list[RootCauseNode] = []
    for r, keep in zip(considered, flags):
        delta = float(r["delta"])
        contribution = (delta / parent_delta * 100.0) if parent_delta else None
        own_delta = r["own_delta"] if r["own_delta"] is not None else delta
        delta_pct = (own_delta / abs(r["b_val"]) * 100.0) if r["b_val"] else None
        share_change = ((r["share_cur"] or 0) - (r["share_base"] or 0)
                        if r["share_cur"] is not None and r["share_base"] is not None else None)
        same_direction = (delta * parent_delta) > 0 if parent_delta else delta != 0
        role = "driver" if same_direction else ("offset" if delta != 0 else "stable")
        severity = _severity(contribution, delta_pct, bool(keep))
        node = RootCauseNode(
            dimension=dimension,
            segment=str(r["segment"]),
            path=path + [f"{dimension}={r['segment']}"],
            current=r["c_val"], baseline=r["b_val"], delta=delta,
            delta_pct=delta_pct, contribution_pct=contribution,
            share_current_pct=r["share_cur"], share_baseline_pct=r["share_base"],
            share_change_pp=share_change,
            expected_delta=r.get("expected"), excess_delta=r.get("excess"),
            excess_pct=r.get("excess_pct"), growth_gap_pp=r.get("growth_gap_pp"),
            rate_effect=r["rate_effect"], mix_effect=r["mix_effect"],
            rows_current=int(len(r["c_frame"])), rows_baseline=int(len(r["b_frame"])),
            p_value=r["p"], p_value_adjusted_significant=bool(keep),
            test_name=r["test"], effect_size=r["effect"], effect_magnitude=r["magnitude"],
            role=role, severity=severity,
        )
        node.narrative = _node_narrative(node, definition)
        nodes.append(node)

    # Drivers rank above offsets: a segment that moved against the total may be
    # statistically striking, but it is never the answer to "why did this fall?".
    _ROLE_RANK = {"driver": 0, "stable": 1, "offset": 2}
    nodes.sort(key=lambda n: (
        _ROLE_RANK.get(n.role, 3),
        -round(abs(n.excess_delta or n.contribution_pct or 0), 6),
        -abs(n.contribution_pct or 0),
    ))
    significant = sum(1 for n in nodes if n.p_value_adjusted_significant)
    sig_frac = significant / len(nodes) if nodes else 0.0
    power = round(float(np.clip(
        0.45 * dispersion + 0.35 * concentration + 0.20 * sig_frac, 0, 1)), 4)
    verdict = (
        "explains most of the movement" if power >= 0.55 and significant
        else "partially explains the movement" if power >= 0.3
        else "every segment moved together - this dimension is not the cause"
    )
    score = DimensionScore(dimension, power, round(float(concentration), 4),
                           round(float(dispersion), 4), round(float(net_coverage), 4),
                           significant, len(nodes), verdict)
    return nodes[:max_segments], score


def _node_narrative(node: RootCauseNode, definition: KPIDefinition) -> str:
    unit = definition.unit
    parts = [
        f"{node.dimension} = {node.segment}: {definition.label} moved from "
        f"{_fmt(node.baseline, unit)} to {_fmt(node.current, unit)}"
    ]
    if node.delta_pct is not None:
        parts[0] += f" ({node.delta_pct:+.1f}%)"
    if node.contribution_pct is not None:
        parts.append(f"accounting for {node.contribution_pct:+.1f}% of the total change")
    if node.growth_gap_pp is not None and abs(node.growth_gap_pp) >= 1.0:
        parts.append(f"it grew {node.growth_gap_pp:+.1f}pp differently from the business "
                     f"as a whole, an excess of {_fmt(node.excess_delta, unit)}")
    if node.share_change_pp is not None and abs(node.share_change_pp) >= 0.5:
        parts.append(f"its share of the business moved {node.share_change_pp:+.1f}pp")
    if node.mix_effect is not None and node.rate_effect is not None:
        dominant = "rate" if abs(node.rate_effect) >= abs(node.mix_effect) else "mix"
        parts.append(f"driven mainly by {dominant} "
                     f"(rate {node.rate_effect:+.3f}, mix {node.mix_effect:+.3f})")
    if node.p_value is not None:
        verdict = ("statistically significant after FDR correction"
                   if node.p_value_adjusted_significant else "not statistically significant")
        parts.append(f"{verdict} (p = {node.p_value:.4g}, {node.test_name})")
    return "; ".join(parts) + "."


# --------------------------------------------------------------------------- #
def analyse_root_cause(
    df: pd.DataFrame,
    roles: RoleMap,
    definition: KPIDefinition,
    date_col: str,
    grain: str,
    dimensions: list[str],
    seasonal_period: int | None = None,
    max_depth: int = 2,
    max_segments: int = 6,
    min_support: int = 15,
    fdr: float = 0.10,
    companion_kpis: list[tuple[KPIDefinition, float | None, float | None]] | None = None,
) -> RootCauseTree | None:
    """Explain the latest movement of ``definition`` and return an evidence tree."""
    from ..kpi.engine import _fmt_period, build_periods  # local import avoids a cycle

    periods = build_periods(df, date_col, grain)
    frame = df.assign(__period=periods).dropna(subset=["__period"])
    ordered = sorted(frame["__period"].unique())
    if len(ordered) < 2:
        return None

    current_period = ordered[-1]
    comparison_type = "period_over_period"
    baseline_period = ordered[-2]
    if seasonal_period and len(ordered) > seasonal_period:
        baseline_period = ordered[-1 - seasonal_period]
        comparison_type = "year_over_year"

    current = frame[frame["__period"] == current_period]
    baseline = frame[frame["__period"] == baseline_period]
    cur_val = _value(definition, current, roles)
    base_val = _value(definition, baseline, roles)
    if cur_val is None or base_val is None:
        return None

    delta = cur_val - base_val
    delta_pct = (delta / abs(base_val) * 100.0) if base_val else None
    direction = "flat" if abs(delta_pct or 0) < 0.5 else ("up" if delta > 0 else "down")
    favourable = (None if direction == "flat"
                  else (direction == "up") == definition.higher_is_better)

    # A dimension that the metric is *defined from* cannot explain that metric.
    # Decomposing fraud rate by `is_fraud` reports that fraud is 100% caused by
    # fraud - true, tautological, and worthless. `required_roles` tells us exactly
    # which columns went into the aggregator, so we exclude them and anything
    # derived from them.
    circular = {
        col for role in definition.required_roles
        if (col := roles.get(role)) is not None
    }
    usable_dims = [
        d for d in dimensions
        if d in frame.columns and d not in circular and 1 < frame[d].nunique() <= 60
    ]

    dimension_scores: list[DimensionScore] = []
    per_dimension: dict[str, list[RootCauseNode]] = {}
    for dim in usable_dims:
        nodes, score = _decompose(definition, roles, current, baseline, dim, delta,
                                  base_val, [], min_support, max_segments, fdr)
        if nodes:
            per_dimension[dim] = nodes
            dimension_scores.append(score)
    dimension_scores.sort(key=lambda s: -s.explanatory_power)

    top_nodes: list[RootCauseNode] = []
    if dimension_scores:
        primary_dim = dimension_scores[0].dimension
        top_nodes = per_dimension[primary_dim]

        # recursive drill-down into the strongest drivers
        remaining = [d for d in usable_dims if d != primary_dim]
        if remaining and max_depth > 1:
            second_dim = (dimension_scores[1].dimension if len(dimension_scores) > 1
                          else remaining[0])
            for node in top_nodes[:3]:
                if abs(node.contribution_pct or 0) < 10:
                    continue
                c_sub = current[current[primary_dim].astype(str) == node.segment]
                b_sub = baseline[baseline[primary_dim].astype(str) == node.segment]
                if len(c_sub) + len(b_sub) < min_support * 2:
                    continue
                children, _ = _decompose(definition, roles, c_sub, b_sub, second_dim,
                                         node.delta or 0.0, node.baseline, node.path,
                                         max(min_support // 2, 5), 4, fdr)
                node.children = [c for c in children
                                 if abs(c.contribution_pct or 0) >= 8][:4]

    # ------- exoneration: what did NOT change ------- #
    ruled_out: list[dict[str, Any]] = []
    for score in dimension_scores[1:]:
        if score.explanatory_power < 0.3:
            ruled_out.append({
                "kind": "dimension", "name": score.dimension,
                "reason": (f"all {score.segments_tested} segments moved broadly in line with "
                           f"the total (dispersion {score.dispersion:.2f}); the change is not "
                           f"specific to any of them"),
                "explanatory_power": score.explanatory_power,
            })
    for comp_def, comp_cur, comp_base in (companion_kpis or []):
        if comp_def.id == definition.id or comp_cur is None or not comp_base:
            continue
        change = (comp_cur - comp_base) / abs(comp_base) * 100.0
        if abs(change) < 3.0:
            ruled_out.append({
                "kind": "kpi", "name": comp_def.label,
                "reason": f"unchanged at {_fmt(comp_cur, comp_def.unit)} ({change:+.1f}%), "
                          f"so it does not explain the movement",
                "change_pct": round(change, 3),
            })

    severity = Severity.INFO
    if favourable is False:
        severity = (Severity.CRITICAL if abs(delta_pct or 0) >= 20
                    else Severity.HIGH if abs(delta_pct or 0) >= 10
                    else Severity.MEDIUM)
    elif favourable is True:
        severity = Severity.INFO

    cur_label = _fmt_period(pd.Timestamp(current_period), grain)
    base_label = _fmt_period(pd.Timestamp(baseline_period), grain)
    headline = (
        f"{definition.label} {'increased' if delta > 0 else 'decreased'} "
        f"{abs(delta_pct or 0):.1f}% ({_fmt(base_val, definition.unit)} -> "
        f"{_fmt(cur_val, definition.unit)}) in {cur_label} versus {base_label}."
        if direction != "flat" else
        f"{definition.label} was broadly flat in {cur_label} versus {base_label}."
    )

    narrative = _tree_narrative(definition, headline, top_nodes, dimension_scores, ruled_out)
    explained = sum(abs(n.contribution_pct or 0) for n in top_nodes
                    if n.role == "driver" and n.p_value_adjusted_significant)
    confidence = round(float(np.clip(
        0.35 + 0.45 * min(explained / 100.0, 1.0)
        + 0.20 * (dimension_scores[0].explanatory_power if dimension_scores else 0.0),
        0.0, 0.99)), 3)

    return RootCauseTree(
        metric=definition.id, metric_label=definition.label, unit=definition.unit,
        current_period=cur_label, baseline_period=base_label,
        comparison_type=comparison_type, current_value=cur_val, baseline_value=base_val,
        delta=delta, delta_pct=delta_pct, direction=direction, is_favourable=favourable,
        severity=severity, dimension_scores=dimension_scores, nodes=top_nodes,
        ruled_out=ruled_out, headline=headline, narrative=narrative, confidence=confidence,
        method_notes=[
            f"Comparison: {comparison_type.replace('_', ' ')} ({base_label} -> {cur_label}).",
            ("Additive decomposition: segment deltas sum exactly to the total delta."
             if definition.additive else
             "Mix/rate decomposition applied because the metric is a ratio."),
            f"Benjamini-Hochberg FDR control at q = {fdr:.2f} across segments in each dimension.",
            f"Segments with fewer than {min_support} combined rows were excluded for power.",
        ],
        excluded_dimensions=[
            {"dimension": d,
             "reason": "the metric is computed from this column, so decomposing by it "
                       "would be circular"}
            for d in sorted(circular & set(dimensions))
        ],
    )


def _tree_narrative(
    definition: KPIDefinition,
    headline: str,
    nodes: list[RootCauseNode],
    scores: list[DimensionScore],
    ruled_out: list[dict[str, Any]],
) -> list[str]:
    """Compose the deterministic explanation an executive reads."""
    lines = [headline]
    if scores:
        top = scores[0]
        lines.append(
            f"The strongest explanatory dimension is '{top.dimension}' "
            f"(explanatory power {top.explanatory_power:.2f}; {top.verdict})."
        )
    drivers = [n for n in nodes if n.role == "driver"][:3]
    offsets = [n for n in nodes if n.role == "offset"][:2]
    for n in drivers:
        line = (f"{n.dimension} '{n.segment}' contributed {_pct(n.contribution_pct)} of the "
                f"change ({_fmt(n.baseline, definition.unit)} -> "
                f"{_fmt(n.current, definition.unit)}, {_pct(n.delta_pct)})")
        if n.p_value is not None:
            line += (" and is statistically significant" if n.p_value_adjusted_significant
                     else " but is within normal variation")
        lines.append(line + ".")
        for child in n.children[:2]:
            lines.append(
                f"    Within {n.segment}, {child.dimension} '{child.segment}' accounts for "
                f"{_pct(child.contribution_pct)} of that segment's change "
                f"({_pct(child.delta_pct)})."
            )
    for n in offsets:
        why = ""
        if n.mix_effect is not None and abs(n.mix_effect) > abs(n.rate_effect or 0):
            why = " (a mix effect - its weight in the business changed)"
        lines.append(
            f"Partially offsetting: {n.dimension} '{n.segment}' pushed "
            f"{_pct(n.contribution_pct)} against the total movement{why}, with its own "
            f"level moving {_pct(n.delta_pct)}."
        )
    for item in ruled_out[:3]:
        lines.append(f"Ruled out - {item['name']}: {item['reason']}.")
    return lines
