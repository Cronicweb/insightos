"""End-to-end guarantees the whole product depends on."""
from __future__ import annotations

import json

import pandas as pd
import pytest

from insightos.pipeline import AnalysisOptions, analyse


@pytest.mark.slow
def test_pipeline_runs_clean(any_dataset):
    _, result = any_dataset
    assert result.warnings == [], f"pipeline recorded warnings: {result.warnings}"
    assert result.schema is not None
    assert result.quality is not None
    assert result.scorecard is not None
    assert result.report is not None


# Some domains genuinely overlap: an e-commerce order table is also a sales
# table, and the KPI sets they imply are near-identical. The detector is judged
# on whether it lands in the right family, not on a label preference.
_ACCEPTABLE_DOMAINS = {
    "banking": {"banking", "finance"},
    "ecommerce": {"ecommerce", "sales", "retail"},
    "marketing": {"marketing"},
}


@pytest.mark.slow
def test_domain_is_detected_correctly(any_dataset):
    ds, result = any_dataset
    detected = getattr(result.domain.domain, "value", str(result.domain.domain))
    allowed = _ACCEPTABLE_DOMAINS.get(ds.domain_hint, {ds.domain_hint})
    assert detected in allowed, f"expected one of {sorted(allowed)}, got {detected}"
    assert result.domain.confidence > 0.3
    assert result.domain.rationale


@pytest.mark.slow
def test_no_chart_exists_without_an_explanation(any_dataset):
    """The headline invariant of the project. `ChartSpec` enforces it at
    construction time; this asserts the guarantee survives serialisation."""
    _, result = any_dataset
    assert result.charts
    for chart in result.charts:
        assert chart.narrative is not None
        assert chart.narrative.headline
        assert chart.narrative.bullets


@pytest.mark.slow
def test_recommendations_are_evidence_backed(any_dataset):
    _, result = any_dataset
    assert result.recommendations.recommendations
    for rec in result.recommendations.recommendations:
        assert rec.evidence, f"{rec.id} has no evidence; it would be an opinion"
        assert rec.triggered_by, "every recommendation names the rule that fired it"
        assert rec.success_measure
        assert 0.0 <= rec.confidence <= 1.0


@pytest.mark.slow
def test_result_is_json_serialisable(any_dataset):
    """The static GitHub Pages build is only possible because the whole result
    round-trips through JSON with no custom encoder."""
    _, result = any_dataset
    blob = json.dumps(result.to_dict())
    assert len(blob) > 10_000
    assert json.loads(blob)["dataset"]


@pytest.mark.slow
def test_quality_score_is_bounded_and_explained(any_dataset):
    _, result = any_dataset
    q = result.quality
    assert 0.0 <= q.score <= 100.0
    assert q.grade
    assert q.dimensions
    assert abs(sum(d.weight for d in q.dimensions) - 1.0) < 1e-6, "dimension weights must sum to 1"
    for issue in q.issues:
        assert issue.title and issue.detail


def test_tiny_frame_degrades_gracefully():
    """A three-row frame cannot support anomaly detection or forecasting. The
    engine must return a partial result, not raise."""
    df = pd.DataFrame(
        {
            "order_date": pd.to_datetime(["2024-01-01", "2024-02-01", "2024-03-01"]),
            "revenue": [100.0, 120.0, 90.0],
            "region": ["East", "West", "East"],
        }
    )
    result = analyse(df, AnalysisOptions(dataset_name="tiny"))
    assert result.rows == 3
    assert result.schema is not None
    json.dumps(result.to_dict())


def test_empty_frame_does_not_crash():
    result = analyse(pd.DataFrame({"a": []}), AnalysisOptions(dataset_name="empty"))
    assert result.rows == 0
    json.dumps(result.to_dict())
