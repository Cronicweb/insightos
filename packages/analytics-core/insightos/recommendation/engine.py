"""Deterministic recommendation engine.

A recommendation is only useful if it says *what to do*, *why*, *how much it is
worth* and *how confident we are*. This engine therefore never emits free text: it
runs a set of declarative rules over the outputs of the other modules and produces
:class:`Recommendation` objects that carry their own evidence, an estimated
financial impact computed from the data, and an explicit confidence.

Design rules that keep the output credible:

* **Every recommendation is traceable.** ``triggered_by`` names the rule and
  ``evidence`` carries the statistics that fired it.
* **Impact is computed, never guessed.** The value at stake is derived from the
  actual gap the analysis measured (e.g. the excess decline attributable to a
  segment), and is labelled as an estimate with its basis stated.
* **Nothing is recommended on weak evidence.** Rules require statistical
  significance or a material effect size before firing; borderline findings become
  "investigate" actions rather than "do this" actions.
* **Priority is impact x confidence x urgency**, so the list sorts the way a
  business would sort it rather than the way the code happened to run.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np

from ..types import Evidence, Severity, to_jsonable

__all__ = ["Recommendation", "RecommendationSet", "RuleContext", "generate_recommendations",
           "RULES", "rule"]


@dataclass
class Recommendation:
    id: str
    title: str
    action: str
    rationale: str
    category: str                        # growth | retention | risk | efficiency | data
    priority: str                        # critical | high | medium | low
    priority_score: float
    confidence: float
    effort: str                          # low | medium | high
    horizon: str                         # immediate | this quarter | ongoing
    owner_hint: str
    estimated_impact: float | None = None
    impact_unit: str = "currency"
    impact_basis: str = ""
    metric: str | None = None
    dimension: str | None = None
    segment: str | None = None
    evidence: list[Evidence] = field(default_factory=list)
    triggered_by: str = ""
    success_measure: str = ""

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


@dataclass
class RecommendationSet:
    recommendations: list[Recommendation] = field(default_factory=list)
    rules_evaluated: int = 0
    rules_fired: int = 0
    total_estimated_impact: float | None = None
    narrative: str = ""
    rule_errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


@dataclass
class RuleContext:
    """Everything a rule may look at. Rules must not touch anything else."""

    scorecard: Any = None                # KPIScorecard
    root_cause: Any = None               # RootCauseTree
    quality: Any = None                  # QualityReport
    anomalies: Any = None                # AnomalyReport
    forecasts: list[Any] = field(default_factory=list)
    domain: Any = None                   # Domain
    currency: str = "USD"

    def kpi(self, kpi_id: str) -> Any | None:
        if not self.scorecard:
            return None
        return next((k for k in self.scorecard.kpis if k.id == kpi_id), None)

    def kpis(self) -> list[Any]:
        return list(self.scorecard.kpis) if self.scorecard else []

    def unit_for(self, metric_id: str | None) -> str:
        """Impacts must carry the metric's own unit. Reporting a fraud-rate deviation
        as a bare number invites it to be read as dollars."""
        k = self.kpi(metric_id) if metric_id else None
        return getattr(k, "unit", None) or "number"


RULES: list[tuple[str, Callable[[RuleContext], Iterable[Recommendation]]]] = []


def rule(name: str):
    """Register a rule. Rules are pure functions of the context."""
    def deco(fn: Callable[[RuleContext], Iterable[Recommendation]]):
        RULES.append((name, fn))
        return fn
    return deco


_PRIORITY = [(80, "critical"), (60, "high"), (35, "medium"), (0, "low")]


def _priority(impact_score: float, confidence: float, urgency: float) -> tuple[str, float]:
    score = float(np.clip(impact_score, 0, 100) * confidence * urgency)
    for threshold, label in _PRIORITY:
        if score >= threshold:
            return label, round(score, 1)
    return "low", round(score, 1)


def _money(value: float | None) -> str:
    if value is None:
        return "an unquantified amount"
    a = abs(value)
    for div, suf in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if a >= div:
            return f"{value / div:,.2f}{suf}"
    return f"{value:,.0f}"


# --------------------------------------------------------------------------- #
# Rules
# --------------------------------------------------------------------------- #

@rule("root_cause_primary_driver")
def _r_root_cause(ctx: RuleContext) -> Iterable[Recommendation]:
    """Act on the segment the root-cause engine proved was responsible."""
    tree = ctx.root_cause
    if not tree or tree.is_favourable is not False or not tree.nodes:
        return []
    out: list[Recommendation] = []
    drivers = [n for n in tree.nodes
               if n.role == "driver" and n.p_value_adjusted_significant][:2]
    # An unfavourable move is not always a fall: fraud rate rising is unfavourable,
    # margin falling is unfavourable. The wording has to follow the actual direction
    # or the report contradicts its own numbers.
    worsened = "decline" if tree.direction == "down" else "increase"
    verb = "Recover" if tree.direction == "down" else "Contain"
    for i, node in enumerate(drivers):
        # Value at stake = the part of the decline this segment caused *beyond*
        # what the overall movement would have produced anyway.
        at_stake = abs(node.excess_delta) if node.excess_delta is not None else abs(
            node.delta or 0)
        child = node.children[0] if node.children else None
        focus = (f"{node.dimension} '{node.segment}'"
                 + (f", concentrated in {child.dimension} '{child.segment}'" if child else ""))
        confidence = float(np.clip(0.6 + (0.35 if node.p_value_adjusted_significant else 0)
                                   - (0.1 * i), 0.4, 0.95))
        impact_score = float(np.clip(abs(node.contribution_pct or 0), 0, 100))
        priority, score = _priority(impact_score, confidence, 1.0)
        out.append(Recommendation(
            id=f"rec-rootcause-{node.dimension}-{node.segment}".lower().replace(" ", "-"),
            title=f"{verb} {tree.metric_label.lower()} in {node.dimension} {node.segment}",
            action=(
                f"Open a targeted review of {focus}. It contributed "
                f"{abs(node.contribution_pct or 0):.0f}% of the "
                f"{abs(tree.delta_pct or 0):.1f}% {tree.metric_label.lower()} "
                f"{worsened}"
                + (" - more than 100% because other segments moved the other way and "
                   "masked part of it" if abs(node.contribution_pct or 0) > 110 else "")
                + (f", while moving {node.delta_pct:+.1f}% itself"
                   if node.delta_pct is not None else "")
                + ". Confirm whether the cause is demand, supply, pricing or execution "
                  "before reallocating budget."
            ),
            rationale=(
                f"{focus} moved {node.growth_gap_pp:+.1f} points worse than the business "
                f"as a whole, which is more than sampling variation explains "
                f"(p = {node.p_value:.3g}, {node.test_name})."
                if node.growth_gap_pp is not None and node.p_value is not None
                else node.narrative
            ),
            category="growth", priority=priority, priority_score=score,
            confidence=round(confidence, 2), effort="medium", horizon="immediate",
            owner_hint=f"{node.dimension.replace('_', ' ').title()} lead",
            estimated_impact=at_stake, impact_unit=tree.unit,
            impact_basis=(f"Excess {worsened} attributable to this segment beyond the "
                          f"company-wide movement, in {tree.metric_label.lower()} units."),
            metric=tree.metric, dimension=node.dimension, segment=node.segment,
            evidence=[Evidence(
                label=f"{node.segment} contribution to the {tree.metric_label} change",
                value=round(float(node.contribution_pct or 0), 2), method=node.test_name or "",
                p_value=node.p_value, effect_size=node.effect_size,
                sample_size=node.rows_current,
                comparison=(f"{node.baseline:,.2f} -> {node.current:,.2f}"
                            if node.baseline is not None and node.current is not None
                            else None),
            )],
            triggered_by="root_cause_primary_driver",
            success_measure=(f"{node.dimension} {node.segment} {tree.metric_label.lower()} "
                             f"returns to within 5% of its {tree.baseline_period} level."),
        ))
    return out


@rule("protect_offsetting_strength")
def _r_offsets(ctx: RuleContext) -> Iterable[Recommendation]:
    """Double down on the segment that held the line."""
    tree = ctx.root_cause
    if not tree or not tree.nodes:
        return []
    offsets = [n for n in tree.nodes if n.role == "offset"
               and (n.excess_delta or 0) != 0][:1]
    out = []
    for node in offsets:
        confidence = 0.7 if node.p_value_adjusted_significant else 0.55
        priority, score = _priority(
            float(np.clip(abs(node.contribution_pct or 0), 0, 60)), confidence, 0.8)
        out.append(Recommendation(
            id=f"rec-protect-{node.dimension}-{node.segment}".lower().replace(" ", "-"),
            title=f"Protect and replicate {node.segment}",
            action=(f"Document what {node.dimension} '{node.segment}' did differently and "
                    f"apply it to the declining segments. It moved {node.delta_pct:+.1f}% "
                    f"while the total moved {tree.delta_pct:+.1f}%."),
            rationale=(f"{node.segment} ran {node.growth_gap_pp:+.1f} points ahead of the "
                       f"company trend, offsetting {abs(node.contribution_pct or 0):.0f}% of "
                       f"the overall movement."
                       if node.growth_gap_pp is not None else node.narrative),
            category="growth", priority=priority, priority_score=score,
            confidence=confidence, effort="low", horizon="this quarter",
            owner_hint="Commercial strategy",
            estimated_impact=abs(node.excess_delta or 0), impact_unit=tree.unit,
            impact_basis="Out-performance versus the company-wide movement.",
            metric=tree.metric, dimension=node.dimension, segment=node.segment,
            evidence=[Evidence(
                label=f"{node.segment} out-performance",
                value=round(float(node.growth_gap_pp or 0), 2),
                method="growth-gap versus total", p_value=node.p_value,
                sample_size=node.rows_current)],
            triggered_by="protect_offsetting_strength",
            success_measure="The practice is adopted by at least one declining segment "
                            "and its growth gap narrows next period.",
        ))
    return out


@rule("retention_weakness")
def _r_retention(ctx: RuleContext) -> Iterable[Recommendation]:
    """Retention deterioration is worth more than acquisition in almost every model."""
    out = []
    for kpi_id, label in (("repeat_customer_rate", "repeat purchase rate"),
                          ("retention_rate", "retention rate"),
                          ("churn_rate", "churn rate")):
        k = ctx.kpi(kpi_id)
        if not k or k.delta_pct is None or k.is_favourable is not False:
            continue
        if abs(k.delta_pct) < 3:
            continue
        revenue = ctx.kpi("revenue") or ctx.kpi("total_revenue")
        impact = None
        basis = ""
        if revenue and revenue.value is not None:
            # A point of retention is worth roughly a point of the revenue base it
            # protects; we state the assumption rather than hiding it.
            impact = abs(k.delta_pct) / 100.0 * float(revenue.value)
            basis = (f"{abs(k.delta_pct):.1f}% deterioration in {label} applied to the "
                     f"current-period revenue base of {_money(revenue.value)}.")
        confidence = 0.75 if abs(k.delta_pct) > 8 else 0.6
        priority, score = _priority(min(abs(k.delta_pct) * 4, 100), confidence, 1.0)
        out.append(Recommendation(
            id=f"rec-retention-{kpi_id}",
            title=f"Arrest the decline in {label}",
            action=(f"Stand up a retention programme for the cohorts driving the change: "
                    f"{k.label} moved {k.delta_pct:+.1f}% to "
                    f"{k.value:,.2f} in {k.period_label}. Prioritise win-back contact for "
                    f"lapsed high-value customers before acquisition spend increases."),
            rationale=(f"{k.label} deteriorated {abs(k.delta_pct):.1f}% versus "
                       f"{k.comparison_label}. Retention compounds: a lost repeat buyer "
                       f"removes all future periods of revenue, not just this one."),
            category="retention", priority=priority, priority_score=score,
            confidence=confidence, effort="medium", horizon="immediate",
            owner_hint="Retention / CRM",
            estimated_impact=impact, impact_unit="currency", impact_basis=basis,
            metric=kpi_id,
            evidence=[Evidence(label=k.label, value=round(float(k.value), 4),
                               method="period-over-period comparison",
                               comparison=f"{k.previous_value:,.4f} -> {k.value:,.4f} "
                                          f"({k.delta_pct:+.1f}%)")],
            triggered_by="retention_weakness",
            success_measure=f"{k.label} recovers to at least {k.previous_value:,.2f} "
                            f"within two periods.",
        ))
    return out


@rule("margin_erosion")
def _r_margin(ctx: RuleContext) -> Iterable[Recommendation]:
    """Falling margin while volume holds is a pricing or discount problem."""
    margin = next((ctx.kpi(i) for i in
                   ("gross_margin_pct", "net_margin_pct", "operating_margin_pct")
                   if ctx.kpi(i)), None)
    if not margin or margin.delta_pct is None or margin.is_favourable is not False:
        return []
    if abs(margin.delta_pct) < 2:
        return []
    volume = next((ctx.kpi(i) for i in ("orders", "transaction_volume", "units")
                   if ctx.kpi(i)), None)
    volume_held = bool(volume and volume.delta_pct is not None and volume.delta_pct > -3)
    revenue = ctx.kpi("revenue")
    impact = None
    basis = ""
    if revenue and revenue.value is not None and margin.previous_value is not None:
        # Margin points lost x current revenue = profit forgone this period.
        pts = (margin.previous_value - (margin.value or 0)) / 100.0
        impact = abs(pts) * float(revenue.value)
        basis = (f"{abs(margin.previous_value - (margin.value or 0)):.1f} margin points lost "
                 f"applied to {_money(revenue.value)} of current revenue.")
    confidence = 0.8 if volume_held else 0.65
    priority, score = _priority(min(abs(margin.delta_pct) * 3, 100), confidence, 1.0)
    return [Recommendation(
        id="rec-margin-erosion",
        title="Review discounting and pricing before volume incentives",
        action=(
            f"Audit discount depth, promotional mix and unit cost. {margin.label} fell "
            f"{abs(margin.delta_pct):.1f}% to {margin.value:,.2f}%"
            + (f" while volume held ({volume.label} {volume.delta_pct:+.1f}%), which points "
               f"to price or cost rather than demand." if volume_held else ".")
        ),
        rationale=(f"{margin.label} moved from {margin.previous_value:,.2f}% to "
                   f"{margin.value:,.2f}%. Margin lost on stable volume is recoverable "
                   f"through pricing action and does not require new demand."),
        category="efficiency", priority=priority, priority_score=score,
        confidence=confidence, effort="low", horizon="immediate",
        owner_hint="Pricing / Revenue management",
        estimated_impact=impact, impact_unit="currency", impact_basis=basis,
        metric=margin.id,
        evidence=[Evidence(label=margin.label, value=round(float(margin.value or 0), 4),
                           method="period-over-period comparison",
                           comparison=f"{margin.previous_value:,.2f}% -> "
                                      f"{margin.value:,.2f}%")]
        + ([Evidence(label=volume.label, value=round(float(volume.value or 0), 2),
                     method="period-over-period comparison",
                     comparison=f"{volume.delta_pct:+.1f}%")] if volume else []),
        triggered_by="margin_erosion",
        success_measure=f"{margin.label} recovers at least half of the lost points "
                        f"within one period without a volume decline.",
    )]


@rule("marketing_efficiency")
def _r_marketing(ctx: RuleContext) -> Iterable[Recommendation]:
    """Reallocate spend from failing channels to proven ones."""
    roas = ctx.kpi("roas")
    cpa = ctx.kpi("cpa")
    tree = ctx.root_cause
    out: list[Recommendation] = []
    if (roas and roas.value is not None and roas.is_favourable is False
            and roas.delta_pct is not None and abs(roas.delta_pct) >= 5):
        worst = None
        best = None
        if tree and tree.metric in ("roas", "cpa") and tree.nodes:
            drivers = [n for n in tree.nodes if n.role == "driver"]
            offs = [n for n in tree.nodes if n.role == "offset"]
            worst = drivers[0] if drivers else None
            best = offs[0] if offs else None
        spend = ctx.kpi("marketing_spend") or ctx.kpi("ad_spend")
        impact = None
        basis = ""
        if spend and spend.value is not None and roas.previous_value:
            # Restoring prior efficiency on the same spend is the recoverable amount.
            impact = float(spend.value) * (roas.previous_value - roas.value)
            basis = (f"Current spend of {_money(spend.value)} at the previous efficiency of "
                     f"{roas.previous_value:,.2f}x rather than {roas.value:,.2f}x.")
        confidence = 0.75 if worst else 0.6
        priority, score = _priority(min(abs(roas.delta_pct) * 4, 100), confidence, 1.0)
        action = (f"Shift budget away from under-performing channels and into the ones "
                  f"holding efficiency. {roas.label} fell {abs(roas.delta_pct):.1f}% to "
                  f"{roas.value:,.2f}x.")
        if worst is not None:
            action += (f" {worst.dimension} '{worst.segment}' contributed "
                       f"{worst.contribution_pct:.0f}% of the decline")
            if best is not None:
                action += (f", while '{best.segment}' improved {best.delta_pct:+.1f}% and "
                           f"can absorb reallocated budget")
            action += "."
        out.append(Recommendation(
            id="rec-marketing-efficiency",
            title="Reallocate media spend toward efficient channels",
            action=action,
            rationale=(f"{roas.label} moved from {roas.previous_value:,.2f}x to "
                       f"{roas.value:,.2f}x. Because spend is fungible across channels, "
                       f"efficiency loss concentrated in one channel is recoverable without "
                       f"increasing the total budget."),
            category="efficiency", priority=priority, priority_score=score,
            confidence=confidence, effort="low", horizon="immediate",
            owner_hint="Performance marketing",
            estimated_impact=impact, impact_unit="currency", impact_basis=basis,
            metric="roas",
            dimension=worst.dimension if worst else None,
            segment=worst.segment if worst else None,
            evidence=[Evidence(label=roas.label, value=round(float(roas.value), 4),
                               method="period-over-period comparison",
                               comparison=f"{roas.previous_value:,.2f}x -> "
                                          f"{roas.value:,.2f}x")],
            triggered_by="marketing_efficiency",
            success_measure=f"{roas.label} recovers above {roas.previous_value:,.2f}x at "
                            f"equal or lower total spend.",
        ))
    if cpa and cpa.is_favourable is False and cpa.delta_pct and cpa.delta_pct > 15:
        priority, score = _priority(min(cpa.delta_pct * 2, 100), 0.7, 0.9)
        out.append(Recommendation(
            id="rec-cpa-inflation", title="Contain acquisition cost inflation",
            action=(f"Pause or re-bid the campaigns driving cost per acquisition up "
                    f"{cpa.delta_pct:+.1f}% to {cpa.value:,.2f}, and re-test creative before "
                    f"restoring budget."),
            rationale=(f"Acquisition cost rose {cpa.delta_pct:+.1f}% versus "
                       f"{cpa.comparison_label}, which compresses payback period on every "
                       f"new customer acquired this period."),
            category="efficiency", priority=priority, priority_score=score, confidence=0.7,
            effort="low", horizon="immediate", owner_hint="Performance marketing",
            estimated_impact=None, impact_unit="currency", metric="cpa",
            evidence=[Evidence(label=cpa.label, value=round(float(cpa.value or 0), 2),
                               method="period-over-period comparison",
                               comparison=f"{cpa.delta_pct:+.1f}%")],
            triggered_by="marketing_efficiency",
            success_measure=f"CPA returns below {cpa.previous_value:,.2f} within one period.",
        ))
    return out


@rule("fraud_and_risk")
def _r_risk(ctx: RuleContext) -> Iterable[Recommendation]:
    """Risk metrics get their own rule because urgency dominates size."""
    out = []
    for kpi_id in ("fraud_rate", "chargeback_rate", "decline_rate", "default_rate"):
        k = ctx.kpi(kpi_id)
        if not k or k.delta_pct is None or k.is_favourable is not False:
            continue
        if k.delta_pct < 10:
            continue
        confidence = 0.85 if k.delta_pct > 30 else 0.7
        # Risk is urgent by nature: a 1.4x urgency multiplier reflects that a
        # rising fraud rate compounds daily while a margin issue does not.
        priority, score = _priority(min(k.delta_pct * 2, 100), confidence, 1.4)
        out.append(Recommendation(
            id=f"rec-risk-{kpi_id}",
            title=f"Escalate the rise in {k.label.lower()}",
            action=(f"Trigger a risk review: {k.label} rose {k.delta_pct:+.1f}% to "
                    f"{k.value:,.3f} in {k.period_label}. Re-tune detection thresholds and "
                    f"review the highest-exposure merchants or channels first."),
            rationale=(f"{k.label} increased {k.delta_pct:+.1f}% versus {k.comparison_label}. "
                       f"Risk metrics compound while unaddressed, so the cost of waiting a "
                       f"period is materially higher than for commercial metrics."),
            category="risk", priority=priority, priority_score=score, confidence=confidence,
            effort="medium", horizon="immediate", owner_hint="Risk / Fraud operations",
            estimated_impact=None, impact_unit="percent",
            impact_basis="Exposure depends on transaction mix; size with the risk team.",
            metric=kpi_id,
            evidence=[Evidence(label=k.label, value=round(float(k.value or 0), 5),
                               method="period-over-period comparison",
                               comparison=f"{k.previous_value:,.5f} -> {k.value:,.5f} "
                                          f"({k.delta_pct:+.1f}%)")],
            triggered_by="fraud_and_risk",
            success_measure=f"{k.label} returns to its {k.comparison_label} level or the "
                            f"increase is explained by a known mix change.",
        ))
    return out


@rule("concentration_risk")
def _r_concentration(ctx: RuleContext) -> Iterable[Recommendation]:
    """A single segment carrying the business is a risk, not just a fact."""
    tree = ctx.root_cause
    if not tree or not tree.nodes:
        return []
    top = max(tree.nodes, key=lambda n: n.share_current_pct or 0)
    if (top.share_current_pct or 0) < 45:
        return []
    priority, score = _priority(float(top.share_current_pct), 0.65, 0.7)
    return [Recommendation(
        id=f"rec-concentration-{top.dimension}".lower().replace(" ", "-"),
        title=f"Reduce dependence on {top.segment}",
        action=(f"Build a diversification plan: {top.dimension} '{top.segment}' now accounts "
                f"for {top.share_current_pct:.1f}% of {tree.metric_label.lower()}. Set a "
                f"target mix and fund the next two largest segments toward it."),
        rationale=(f"With {top.share_current_pct:.1f}% of {tree.metric_label.lower()} in a "
                   f"single {tree.nodes[0].dimension.replace('_', ' ')}, a shock there "
                   f"transmits almost fully to the company total - which is exactly what "
                   f"the current-period movement demonstrated."),
        category="risk", priority=priority, priority_score=score, confidence=0.65,
        effort="high", horizon="ongoing", owner_hint="Strategy / FP&A",
        estimated_impact=None, impact_unit="percent",
        impact_basis="Concentration is a variance risk rather than a level impact.",
        metric=tree.metric, dimension=top.dimension, segment=top.segment,
        evidence=[Evidence(label=f"{top.segment} share of {tree.metric_label}",
                           value=round(float(top.share_current_pct), 2),
                           method="share of current-period total")],
        triggered_by="concentration_risk",
        success_measure=f"{top.segment} share falls below "
                        f"{max(35, top.share_current_pct - 8):.0f}% without a total decline.",
    )]


@rule("data_quality_blockers")
def _r_quality(ctx: RuleContext) -> Iterable[Recommendation]:
    """Analytics is only as trustworthy as its input; say so when it isn't."""
    q = ctx.quality
    if not q:
        return []
    blockers = [i for i in q.issues
                if i.severity in (Severity.CRITICAL, Severity.HIGH)][:3]
    if q.score >= 90 and not blockers:
        return []
    priority, score = _priority(max(0.0, 100 - q.score) * 1.5,
                                0.95, 1.2 if q.score < 70 else 0.8)
    detail = "; ".join(f"{i.title} ({i.affected_pct:.1f}% of rows)" for i in blockers)
    return [Recommendation(
        id="rec-data-quality",
        title="Remediate data quality before acting on marginal findings"
              if q.score >= 70 else "Fix data quality before trusting these results",
        action=(f"Address the highest-severity data issues at source: {detail}."
                if detail else
                f"Raise the dataset quality score from {q.score:.1f} ({q.grade}) by "
                f"resolving the issues listed in the quality report."),
        rationale=(f"The dataset scores {q.score:.1f}/100 ({q.grade}). "
                   + ("Findings below a few percent in magnitude are within the noise "
                      "introduced by these issues and should not drive decisions."
                      if q.score < 85 else
                      "Quality is adequate for headline conclusions, but the listed issues "
                      "will distort segment-level detail.")),
        category="data",
        priority=priority if q.score < 85 else "medium",
        priority_score=score, confidence=0.95, effort="medium",
        horizon="this quarter", owner_hint="Data engineering",
        estimated_impact=None, impact_unit="percent",
        impact_basis="Quality debt affects confidence rather than a single metric.",
        evidence=[Evidence(label="Data quality score", value=round(float(q.score), 2),
                           method="weighted DAMA dimension scoring",
                           sample_size=int(q.rows),
                           comparison=f"grade {q.grade}")]
        + [Evidence(label=i.title, value=f"{i.affected_pct:.2f}%", method=i.dimension,
                    sample_size=int(i.affected_rows)) for i in blockers],
        triggered_by="data_quality_blockers",
        success_measure="Quality score above 90 with no critical or high issues.",
    )]


@rule("anomaly_investigation")
def _r_anomaly(ctx: RuleContext) -> Iterable[Recommendation]:
    """A level shift means something changed structurally - find out what."""
    rep = ctx.anomalies
    if not rep or not rep.anomalies:
        return []
    shifts = [a for a in rep.anomalies if a.kind == "level_shift"
              and a.severity in (Severity.CRITICAL, Severity.HIGH)][:1]
    points = [a for a in rep.anomalies if a.kind in ("spike", "dip")
              and a.severity == Severity.CRITICAL][:1]
    out = []
    for a in shifts + points:
        urgency = 1.2 if a.kind == "level_shift" else 0.9
        priority, score = _priority(min(abs(a.deviation_pct or 10) * 2.5, 100),
                                    a.confidence, urgency)
        out.append(Recommendation(
            id=f"rec-anomaly-{a.metric}-{a.period}".lower().replace(" ", "-"),
            title=(f"Investigate the {a.metric_label} level shift at {a.period}"
                   if a.kind == "level_shift" else
                   f"Explain the {a.metric_label} {a.kind} in {a.period}"),
            action=(f"Reconstruct what changed around {a.period}: releases, pricing, "
                    f"campaigns, supply, or an upstream data change. "
                    + (f"{a.metric_label} moved to a new level "
                       f"({a.deviation_pct:+.1f}%) and has not returned."
                       if a.kind == "level_shift" else
                       f"{a.metric_label} deviated {a.deviation_pct:+.1f}% from expectation "
                       f"for a single period.")),
            rationale=a.narrative,
            category="risk" if a.kind == "level_shift" else "growth",
            priority=priority, priority_score=score, confidence=a.confidence,
            effort="low", horizon="immediate", owner_hint="Analytics / Business operations",
            estimated_impact=abs(a.deviation) if a.deviation is not None else None,
            impact_unit=ctx.unit_for(a.metric),
            impact_basis="Deviation from the modelled expectation for the affected period(s).",
            metric=a.metric,
            evidence=[Evidence(label=f"{a.metric_label} at {a.period}",
                               value=round(float(a.observed), 4), method=a.method,
                               comparison=(f"expected {a.expected:,.2f}"
                                           if a.expected is not None else None))],
            triggered_by="anomaly_investigation",
            success_measure="The change is attributed to a named cause and either reversed "
                            "or accepted as the new baseline.",
        ))
    return out


@rule("forecast_shortfall")
def _r_forecast(ctx: RuleContext) -> Iterable[Recommendation]:
    """Only act on a forecast that earned the right to be believed."""
    out = []
    for fc in ctx.forecasts or []:
        if not fc or not fc.points or not fc.beats_naive:
            continue
        first, last = fc.points[0].value, fc.points[-1].value
        if first == 0:
            continue
        change = (last - first) / abs(first) * 100.0
        if change > -5:
            continue
        priority, score = _priority(min(abs(change) * 3, 100),
                                    float(np.clip(1 - (fc.mase or 0.5), 0.4, 0.9)), 0.9)
        out.append(Recommendation(
            id=f"rec-forecast-{fc.metric}",
            title=f"Plan for a projected {fc.metric_label.lower()} shortfall",
            action=(f"Re-plan the next {fc.horizon} periods around a projected "
                    f"{abs(change):.1f}% decline in {fc.metric_label.lower()} to "
                    f"{last:,.2f} by {fc.points[-1].period}, and pre-agree the trigger "
                    f"point for corrective action."),
            rationale=(f"{fc.narrative} This model beat the naive benchmark in backtesting "
                       f"(MASE {fc.mase:.2f}), so the projection carries information rather "
                       f"than merely extending the last value."),
            category="growth", priority=priority, priority_score=score,
            confidence=round(float(np.clip(1 - (fc.mase or 0.5), 0.4, 0.9)), 2),
            effort="medium", horizon="this quarter", owner_hint="FP&A",
            estimated_impact=abs(last - first), impact_unit="number",
            impact_basis=f"Projected movement between {fc.points[0].period} and "
                         f"{fc.points[-1].period}.",
            metric=fc.metric,
            evidence=[Evidence(label=f"{fc.metric_label} forecast ({fc.model})",
                               value=round(float(last), 2),
                               method=f"{fc.model}, rolling-origin backtested",
                               comparison=f"{int(fc.confidence_level * 100)}% interval "
                                          f"{fc.points[-1].lower:,.2f} to "
                                          f"{fc.points[-1].upper:,.2f}")],
            triggered_by="forecast_shortfall",
            success_measure=f"Actual {fc.metric_label.lower()} lands above the forecast "
                            f"central path.",
        ))
    return out


def generate_recommendations(ctx: RuleContext, limit: int = 8) -> RecommendationSet:
    """Run every registered rule and return a prioritised, de-duplicated set."""
    found: list[Recommendation] = []
    errors: list[str] = []
    fired = 0
    for name, fn in RULES:
        try:
            produced = list(fn(ctx) or [])
        except Exception as exc:
            # A failing rule must never take down the report; it abstains. But it is
            # recorded, because a rule that silently never fires is indistinguishable
            # from a rule that is broken.
            errors.append(f"{name}: {exc.__class__.__name__}: {exc}")
            continue
        if produced:
            fired += 1
        found.extend(produced)

    seen: set[str] = set()
    unique: list[Recommendation] = []
    for rec in sorted(found, key=lambda r: -r.priority_score):
        if rec.id in seen:
            continue
        seen.add(rec.id)
        unique.append(rec)
    top = unique[:limit]

    monetary = [r.estimated_impact for r in top
                if r.estimated_impact is not None and r.impact_unit == "currency"]
    total = float(sum(monetary)) if monetary else None
    counts: dict[str, int] = {}
    for r in top:
        counts[r.priority] = counts.get(r.priority, 0) + 1
    parts = [f"{v} {k}" for k, v in sorted(counts.items(),
                                           key=lambda kv: -_priority_rank(kv[0]))]
    narrative = (
        f"{len(top)} recommendation{'s' if len(top) != 1 else ''} generated from "
        f"{fired} of {len(RULES)} deterministic rules"
        + (f" ({', '.join(parts)})" if parts else "")
        + (f", with an estimated {_money(total)} of quantified value at stake."
           if total else ". Impacts are directional where the data does not support "
           "a monetary estimate.")
    )
    return RecommendationSet(top, len(RULES), fired, total, narrative, errors)


def _priority_rank(label: str) -> int:
    return {"critical": 3, "high": 2, "medium": 1, "low": 0}.get(label, 0)
