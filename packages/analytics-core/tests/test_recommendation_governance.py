"""Recommendation governance and explainability."""
from __future__ import annotations

import pytest

from insightos.demo.generators import GENERATORS
from insightos.pipeline import AnalysisOptions, analyse
from insightos.recommendation import explain_recommendation


@pytest.fixture(scope="module")
def result():
    return analyse(
        GENERATORS["banking"]().frame,
        AnalysisOptions(dataset_name="banking", source="synthetic", source_type="demo",
                        owner="Analytics Team"),
    )


def test_recommendations_are_produced(result) -> None:
    assert result.recommendations.recommendations


def test_every_recommendation_is_owned_and_auditable(result) -> None:
    for rec in result.recommendations.recommendations:
        assert rec.suggested_owner, rec.title
        assert rec.audit_trail, rec.title
        assert rec.rules_fired, rec.title
        assert isinstance(rec.approval_required, bool)


def test_confidence_is_capped_by_data_readiness(result) -> None:
    cap = result.governance.confidence_cap
    for rec in result.recommendations.recommendations:
        assert rec.confidence <= cap + 1e-9
        assert rec.confidence_before_cap >= rec.confidence


def test_no_recommendation_is_a_bare_imperative(result) -> None:
    for rec in result.recommendations.recommendations:
        assert len(rec.rationale) > 20, rec.title
        assert rec.evidence, rec.title


def test_explainability_payload_answers_why(result) -> None:
    rec = result.recommendations.recommendations[0]
    why = explain_recommendation(rec)
    for key in (
        "question",
        "evidence",
        "statisticalTests",
        "confidence",
        "supportingMetrics",
        "rulesFired",
        "rejectedAlternatives",
        "dataQualityImpact",
        "auditTrail",
    ):
        assert key in why, key
    assert 0.0 <= why["confidence"] <= 1.0


def test_rejected_alternatives_are_recorded(result) -> None:
    assert isinstance(result.recommendations.rejected_alternatives, list)


def test_governance_note_explains_any_capping(result) -> None:
    note = result.recommendations.governance_note
    assert note is None or isinstance(note, str)


def test_pipeline_payload_exposes_the_new_blocks(result) -> None:
    payload = result.to_dict()
    for key in ("privacy", "governance", "plugin"):
        assert key in payload, key
    assert payload["governance"]["decisionReadiness"]
