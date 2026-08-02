"""Executive report generation.

The output of this module is the thing an executive actually reads: five or six
paragraphs that say what happened, why, what it is worth, and what to do. Every
sentence is assembled from values the engine computed, in a fixed rhetorical order
that mirrors how a good analyst briefs a decision-maker:

1. **Headline** - the one number that moved and by how much.
2. **What happened** - the surrounding KPI movement, favourable and unfavourable.
3. **Why it happened** - the root-cause chain, with the exonerations, because
   ruling things out is half of an investigation's value.
4. **What else we noticed** - anomalies and regime changes.
5. **What is likely next** - the forecast, only when it beat a naive benchmark.
6. **What to do** - the prioritised recommendations with value at stake.
7. **How much to trust this** - data quality and explicit limitations.

Section 7 is not optional. A report that never states its own limitations is a
sales document, not an analysis.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

from ..narrative.writer import format_value
from ..types import Severity, to_jsonable

__all__ = ["ReportSection", "ExecutiveReport", "build_executive_report",
           "render_markdown"]


@dataclass
class ReportSection:
    id: str
    title: str
    paragraphs: list[str] = field(default_factory=list)
    bullets: list[str] = field(default_factory=list)


@dataclass
class ExecutiveReport:
    dataset: str
    domain: str
    period: str
    comparison: str
    headline: str
    summary: str
    sections: list[ReportSection] = field(default_factory=list)
    key_numbers: list[dict[str, Any]] = field(default_factory=list)
    confidence: float = 0.0
    generated_at: str = ""
    limitations: list[str] = field(default_factory=list)
    polished: bool = False

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))

    def to_markdown(self) -> str:
        return render_markdown(self)


def _pct(v: float | None) -> str:
    return "n/a" if v is None else f"{v:+.1f}%"


def build_executive_report(result: Any, polisher: Any | None = None) -> ExecutiveReport:
    """Assemble the executive narrative from a completed :class:`AnalysisResult`."""
    sc = result.scorecard
    domain = getattr(result.domain, "domain", None)
    domain_name = getattr(domain, "value", str(domain or "general")).replace("_", " ")
    period = sc.period_label if sc else "the latest period"
    comparison = sc.comparison_label if sc else "the prior period"
    primary = sc.primary() if sc else None
    tree = result.root_causes[0] if result.root_causes else None
    recs = result.recommendations.recommendations if result.recommendations else []

    # ---- headline ---- #
    if primary and primary.delta_pct is not None:
        move = "increased" if primary.delta_pct > 0 else "decreased"
        headline = (f"{primary.label} {move} {abs(primary.delta_pct):.1f}% to "
                    f"{format_value(primary.value, primary.unit)} in {period} "
                    f"versus {comparison}.")
    elif primary:
        headline = (f"{primary.label} stands at "
                    f"{format_value(primary.value, primary.unit)} in {period}.")
    else:
        headline = f"Analysis of {result.dataset} across {result.rows:,} records."

    sections: list[ReportSection] = []

    # ---- 1. what happened ---- #
    what = ReportSection("what-happened", "What happened")
    if sc:
        good = [k for k in sc.kpis if k.is_favourable is True and k.delta_pct is not None]
        bad = [k for k in sc.kpis if k.is_favourable is False and k.delta_pct is not None]
        good.sort(key=lambda k: -abs(k.delta_pct))
        bad.sort(key=lambda k: -abs(k.delta_pct))
        para = headline
        if bad:
            para += (" The movement was accompanied by " +
                     _join([f"{k.label} {_pct(k.delta_pct)}" for k in bad[:3]]) + ".")
        if good:
            para += (" Offsetting this, " +
                     _join([f"{k.label} moved {_pct(k.delta_pct)}" for k in good[:3]]) + ".")
        what.paragraphs.append(para)
        stable = [k for k in sc.kpis if k.delta_pct is not None and abs(k.delta_pct) < 2]
        if stable:
            what.paragraphs.append(
                _join([k.label for k in stable[:3]]) +
                " remained effectively unchanged, which narrows the range of possible "
                "explanations for the movement above."
            )
        for k in sc.kpis[:5]:
            what.bullets.append(
                f"{k.label}: {format_value(k.value, k.unit)} "
                f"({_pct(k.delta_pct)} vs {comparison})"
            )
    sections.append(what)

    # ---- 2. why ---- #
    if tree:
        why = ReportSection("why", "Why it happened")
        why.paragraphs.extend(tree.narrative[:4])
        if tree.ruled_out:
            why.paragraphs.append(
                "Ruled out: " + _join([
                    str(r.get("name") or r.get("dimension", "")).replace("_", " ")
                    for r in tree.ruled_out[:4]
                ]) + ". These dimensions moved in line with the business as a whole, so the "
                     "change is not specific to any of them."
            )
        for node in tree.nodes[:4]:
            why.bullets.append(
                f"{node.dimension.replace('_', ' ')} {node.segment}: "
                f"{_pct(node.delta_pct)} move, "
                f"{_pct(node.contribution_pct)} of the total change"
                + (f", significant at FDR 10% (p = {node.p_value:.3g})"
                   if node.p_value_adjusted_significant and node.p_value is not None
                   else ", not statistically distinguishable from the overall trend")
            )
        why.paragraphs.append(
            f"Confidence in this attribution is {tree.confidence:.0%}, based on the "
            f"strength of the dimension separation and the number of segments that passed "
            f"multiple-comparison correction."
        )
        sections.append(why)

    # ---- 3. anomalies ---- #
    rep = result.anomalies
    if rep and rep.anomalies:
        an = ReportSection("anomalies", "What else we noticed")
        top = rep.anomalies[:4]
        shifts = [a for a in top if a.kind == "level_shift"]
        if shifts:
            an.paragraphs.append(
                f"{len(shifts)} structural level change{'s were' if len(shifts) > 1 else ' was'} "
                f"detected. " + shifts[0].narrative
            )
        points = [a for a in top if a.kind in ("spike", "dip")]
        if points:
            an.paragraphs.append(
                f"{len(points)} single-period {'anomalies were' if len(points) > 1 else 'anomaly was'} "
                f"flagged after removing trend and seasonality. " + points[0].narrative
            )
        for a in top:
            an.bullets.append(f"{a.metric_label} - {a.period}: {a.kind.replace('_', ' ')} "
                              f"({a.severity.value})")
        if rep.segment_anomalies:
            s = rep.segment_anomalies[0]
            an.paragraphs.append(s.narrative)
        sections.append(an)

    # ---- 4. outlook ---- #
    credible = [f for f in (result.forecasts or []) if f.beats_naive]
    if credible:
        ol = ReportSection("outlook", "What is likely next")
        for f in credible[:2]:
            ol.paragraphs.append(f.narrative)
        units = {k.id: k.unit for k in (sc.kpis if sc else [])}
        for f in credible[:3]:
            u = units.get(f.metric, "number")
            last = f.points[-1]
            ol.bullets.append(
                f"{f.metric_label}: {format_value(last.value, u)} by {last.period} "
                f"({int(f.confidence_level * 100)}% interval "
                f"{format_value(last.lower, u)} to {format_value(last.upper, u)})"
            )
        weak = [f for f in (result.forecasts or []) if not f.beats_naive]
        if weak:
            ol.paragraphs.append(
                _join([f.metric_label for f in weak[:3]]) +
                " could not be forecast more accurately than a naive benchmark, so no "
                "projection is offered for them rather than presenting a line with no "
                "information in it."
            )
        sections.append(ol)

    # ---- 5. actions ---- #
    if recs:
        ac = ReportSection("actions", "Recommended actions")
        total = result.recommendations.total_estimated_impact
        ac.paragraphs.append(
            f"{len(recs)} action{'s' if len(recs) != 1 else ''} "
            f"{'are' if len(recs) != 1 else 'is'} recommended, generated from deterministic "
            f"rules over the evidence above"
            + (f", with approximately {format_value(total, 'currency')} of quantified value "
               f"at stake." if total else ".")
        )
        for r in recs[:5]:
            impact = (f" (est. {format_value(r.estimated_impact, r.impact_unit)})"
                      if r.estimated_impact is not None else "")
            ac.bullets.append(f"[{r.priority.upper()}] {r.title}{impact} - {r.action}")
        ac.paragraphs.append(
            "Each recommendation carries the statistics that triggered it and a stated "
            "success measure, so the decision can be reviewed against the same evidence "
            "next period."
        )
        sections.append(ac)

    # ---- 6. trust ---- #
    limitations: list[str] = []
    tr = ReportSection("trust", "How much to trust this")
    q = result.quality
    if q:
        tr.paragraphs.append(
            f"The dataset scores {q.score:.1f}/100 ({q.grade}) across {q.rows:,} rows and "
            f"{q.columns} columns. "
            + ("Quality is sufficient for the conclusions drawn above."
               if q.score >= 85 else
               "Quality issues are material; segment-level conclusions should be confirmed "
               "before acting.")
        )
        for issue in [i for i in q.issues
                      if i.severity in (Severity.CRITICAL, Severity.HIGH)][:3]:
            tr.bullets.append(f"{issue.title} - {issue.affected_pct:.1f}% of rows")
            limitations.append(f"{issue.title} ({issue.affected_pct:.1f}% of rows)")
        if q.score < 85:
            limitations.append(f"Overall data quality is {q.grade} ({q.score:.1f}/100)")
    if tree:
        limitations.append(
            "Root-cause attribution is statistical association within the observed data, "
            "not a controlled experiment; it identifies where to look, not proof of cause."
        )
    if not credible and result.forecasts:
        limitations.append("No forecast beat a naive benchmark; treat projections as absent.")
    if result.warnings:
        limitations.extend(result.warnings)
    tr.paragraphs.append(
        "All figures in this report are computed deterministically from the source data. "
        "Statistical claims are corrected for multiple comparisons using Benjamini-Hochberg "
        "at a 10% false discovery rate."
    )
    sections.append(tr)

    # ---- summary paragraph ---- #
    summary = _compose_summary(headline, sc, tree, recs, q)

    key_numbers: list[dict[str, Any]] = []
    if sc:
        for k in sc.kpis[:6]:
            key_numbers.append({
                "id": k.id, "label": k.label,
                "value": k.value, "formatted": format_value(k.value, k.unit),
                "delta_pct": k.delta_pct, "unit": k.unit,
                "favourable": k.is_favourable,
            })

    confidence = 0.5
    if tree:
        confidence = float(tree.confidence)
    if q:
        confidence = confidence * (0.6 + 0.4 * min(1.0, q.score / 100.0))

    report = ExecutiveReport(
        dataset=result.dataset, domain=domain_name, period=period, comparison=comparison,
        headline=headline, summary=summary, sections=sections, key_numbers=key_numbers,
        confidence=round(confidence, 3),
        generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        limitations=limitations,
    )

    if polisher is not None and getattr(polisher, "enabled", False):
        polished = polisher.polish(report.summary, context=f"{domain_name} analytics summary")
        if polished.polished:
            report.summary = polished.text
            report.polished = True

    return report


def _compose_summary(headline: str, sc: Any, tree: Any, recs: list[Any], q: Any) -> str:
    """The single paragraph that gets pasted into a board deck."""
    parts = [headline]
    if tree and tree.nodes:
        drivers = [n for n in tree.nodes if n.role == "driver"][:2]
        if drivers:
            parts.append(
                "The movement was concentrated in " +
                _join([f"{n.dimension.replace('_', ' ')} {n.segment} ({_pct(n.delta_pct)})"
                       for n in drivers]) +
                f", which together account for "
                f"{sum(abs(n.contribution_pct or 0.0) for n in drivers):.0f}% of the change."
            )
        offs = [n for n in tree.nodes if n.role == "offset"][:1]
        if offs:
            parts.append(
                f"{offs[0].dimension.replace('_', ' ').title()} {offs[0].segment} moved the "
                f"other way ({_pct(offs[0].delta_pct)}), partially offsetting the decline."
            )
        if tree.ruled_out:
            parts.append(
                _join([str(r.get("name") or r.get("dimension", "")).replace("_", " ")
                       for r in tree.ruled_out[:2]]).capitalize()
                + " showed no segment-specific effect and can be excluded."
            )
    if sc:
        stable = [k for k in sc.kpis if k.delta_pct is not None and abs(k.delta_pct) < 2]
        if stable:
            parts.append(_join([k.label for k in stable[:2]]) + " remained stable.")
    if recs:
        top = recs[0]
        parts.append(
            f"The highest-priority action is to {top.title[0].lower()}{top.title[1:]}"
            + (f", worth an estimated {format_value(top.estimated_impact, top.impact_unit)}."
               if top.estimated_impact is not None else ".")
        )
    if q and q.score < 85:
        parts.append(f"Data quality is {q.grade} ({q.score:.0f}/100); confirm segment-level "
                     f"detail before acting.")
    return " ".join(parts)


def _join(items: list[str]) -> str:
    items = [i for i in items if i]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + " and " + items[-1]


def render_markdown(report: ExecutiveReport) -> str:
    """Render the report as portable Markdown for export or a PR comment."""
    lines = [
        f"# Executive Report - {report.dataset}",
        "",
        f"**Domain:** {report.domain.title()}  ",
        f"**Period:** {report.period} vs {report.comparison}  ",
        f"**Confidence:** {report.confidence:.0%}  ",
        f"**Generated:** {report.generated_at}",
        "",
        "## Summary",
        "",
        report.summary,
        "",
    ]
    if report.key_numbers:
        lines += ["## Key numbers", "",
                  "| Metric | Value | Change |", "| --- | ---: | ---: |"]
        for k in report.key_numbers:
            delta = "n/a" if k["delta_pct"] is None else f"{k['delta_pct']:+.1f}%"
            lines.append(f"| {k['label']} | {k['formatted']} | {delta} |")
        lines.append("")
    for section in report.sections:
        lines += [f"## {section.title}", ""]
        for p in section.paragraphs:
            lines += [p, ""]
        for b in section.bullets:
            lines.append(f"- {b}")
        if section.bullets:
            lines.append("")
    if report.limitations:
        lines += ["## Limitations", ""]
        lines += [f"- {item}" for item in report.limitations]
        lines.append("")
    lines += ["---", "",
              "*Generated by InsightOS. Every figure is computed deterministically from "
              "the source data; no figure in this report was produced by a language model.*"]
    return "\n".join(lines)
