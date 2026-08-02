"""Recommendation governance.

A recommendation that says "increase budget" is an opinion. A recommendation that
says *who* should act, *what evidence* fired it, *how confident* the engine is
given the quality of the data, *whether approval is required* and *what was
considered and rejected* is an auditable decision record.

This module runs after the rules and never changes what they concluded - it only
attaches accountability and, where the data does not deserve confidence, degrades
it. Degradation is one-directional: governance can lower confidence, never raise
it. That property is what makes the confidence number trustworthy.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .engine import Recommendation, RecommendationSet, _priority

__all__ = ["apply_governance", "explain_recommendation"]

_QUALITY_NOTE = {
    "executive_ready": "Data is executive-ready; the recommendation is presented at full confidence.",
    "operational": "Data is operational-grade; confidence is capped for executive escalation.",
    "exploratory": "Data is exploratory only; treat this as a hypothesis to be verified.",
    "blocked": "Data quality is below the reporting threshold; this is a data action, not a business action.",
}


def _statistical_tests(rec: Recommendation) -> list[str]:
    tests: list[str] = []
    for ev in rec.evidence:
        method = getattr(ev, "method", "") or ""
        if method and method not in tests:
            tests.append(method)
    return tests


def _significance(rec: Recommendation) -> float | None:
    values = [
        getattr(ev, "p_value", None) for ev in rec.evidence
        if getattr(ev, "p_value", None) is not None
    ]
    return float(min(values)) if values else None


def _audit_trail(rec: Recommendation, readiness: str, cap: float | None,
                 capped: bool, timestamp: str) -> list[str]:
    trail = [
        f"{timestamp} - rule '{rec.triggered_by or rec.id}' fired on metric "
        f"'{rec.metric or 'n/a'}'"
        + (f", segment '{rec.segment}'" if rec.segment else ""),
        f"{timestamp} - {len(rec.evidence)} piece(s) of evidence attached"
        + (f" using {', '.join(_statistical_tests(rec))}" if rec.evidence else ""),
        f"{timestamp} - data readiness assessed as '{readiness}'",
    ]
    if capped and cap is not None:
        trail.append(
            f"{timestamp} - confidence reduced from {rec.confidence_before_cap:.2f} "
            f"to {cap:.2f} because the dataset is not {readiness.replace('_', ' ')}-grade"
        )
    if rec.approval_required:
        trail.append(
            f"{timestamp} - approval required from {rec.approval_authority} "
            f"before this action is taken"
        )
    return trail


def apply_governance(
    recset: RecommendationSet | None,
    *,
    plugin: Any = None,
    governance: Any = None,
    fallback_owner: str = "Business Owner",
) -> RecommendationSet | None:
    """Attach ownership, approval, audit trail and quality-degraded confidence."""
    if recset is None:
        return None

    readiness = getattr(governance, "decision_readiness", "operational")
    cap = getattr(governance, "confidence_cap", None)
    playbook = getattr(plugin, "playbook", None)
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    degraded = 0

    for rec in recset.recommendations:
        rec.confidence_before_cap = rec.confidence
        rec.confidence_cap = cap
        if cap is not None and rec.confidence > cap:
            rec.confidence = round(float(cap), 3)
            degraded += 1
            # Priority is impact x confidence x urgency, so a capped confidence must
            # re-rank the action rather than silently contradict its own score.
            urgency = (rec.priority_score / max(rec.confidence_before_cap, 1e-6)
                       if rec.confidence_before_cap else rec.priority_score)
            rec.priority, rec.priority_score = _priority(
                min(urgency, 100.0), rec.confidence, 1.0)

        if playbook is not None:
            rec.suggested_owner = playbook.owner_for(rec.category, rec.owner_hint or fallback_owner)
            rec.approval_required = playbook.requires_approval(
                rec.category,
                rec.estimated_impact if rec.impact_unit == "currency" else None,
            )
            rec.approval_authority = playbook.approval_authority if rec.approval_required else ""
            rec.review_cadence = playbook.review_cadence
        else:
            rec.suggested_owner = rec.owner_hint or fallback_owner
            rec.approval_required = rec.priority == "critical"
            rec.approval_authority = "Analytics Lead" if rec.approval_required else ""

        rec.statistical_tests = _statistical_tests(rec)
        rec.evidence_count = len(rec.evidence)
        rec.significance = _significance(rec)
        rec.data_quality_impact = _QUALITY_NOTE.get(readiness, "")
        rec.rules_fired = [rec.triggered_by] if rec.triggered_by else [rec.id]
        rec.rejected_alternatives = [
            alt for alt in recset.rejected_alternatives if alt.get("id") != rec.id
        ][:3]
        rec.audit_trail = _audit_trail(
            rec, readiness, cap, rec.confidence != rec.confidence_before_cap, timestamp)

    approvals = sum(1 for r in recset.recommendations if r.approval_required)
    notes = [f"Data readiness: {readiness.replace('_', ' ')}."]
    if degraded:
        notes.append(
            f"{degraded} recommendation{'s' if degraded != 1 else ''} had confidence "
            f"capped at {cap:.0%} because the underlying data is not executive-grade."
        )
    if approvals:
        notes.append(
            f"{approvals} action{'s' if approvals != 1 else ''} require sign-off before execution."
        )
    if recset.rejected_alternatives:
        notes.append(
            f"{len(recset.rejected_alternatives)} lower-ranked alternative"
            f"{'s were' if len(recset.rejected_alternatives) != 1 else ' was'} "
            f"considered and set aside."
        )
    recset.governance_note = " ".join(notes)
    return recset


def explain_recommendation(rec: Recommendation) -> dict[str, Any]:
    """The answer to "why?" - the whole basis of a recommendation, in one payload."""
    return {
        "id": rec.id,
        "question": "Why is this being recommended?",
        "confidence": rec.confidence,
        "confidenceBeforeCap": rec.confidence_before_cap,
        "confidenceCap": rec.confidence_cap,
        "evidenceCount": rec.evidence_count,
        "significance": rec.significance,
        "statisticalTests": list(rec.statistical_tests),
        "evidence": [
            ev.to_dict() if hasattr(ev, "to_dict") else ev for ev in rec.evidence
        ],
        "rulesFired": list(rec.rules_fired),
        "rejectedAlternatives": list(rec.rejected_alternatives),
        "supportingMetrics": [m for m in (rec.metric, rec.dimension, rec.segment) if m],
        "contribution": rec.estimated_impact,
        "contributionUnit": rec.impact_unit,
        "contributionBasis": rec.impact_basis,
        "dataQualityImpact": rec.data_quality_impact,
        "suggestedOwner": rec.suggested_owner,
        "approvalRequired": rec.approval_required,
        "approvalAuthority": rec.approval_authority,
        "auditTrail": list(rec.audit_trail),
        "successMeasure": rec.success_measure,
    }
