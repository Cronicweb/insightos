"""The four vertical demo datasets carry a planted, machine-checkable truth.

These are regression tests for the *engine*, not for the generators: each
dataset hides one deliberate business event, and the pipeline is expected to
rediscover it without any hints. When one of these fails it usually means a
role resolver, a KPI definition or the root-cause ranking has regressed.
"""
from __future__ import annotations

import pytest

from insightos.demo import GENERATORS
from insightos.pipeline import AnalysisOptions, analyse

VERTICALS = ["retail", "healthcare", "hr", "manufacturing"]


@pytest.fixture(scope="module")
def analysed():
    out = {}
    for key in VERTICALS:
        ds = GENERATORS[key]()
        out[key] = (ds, analyse(ds.frame, AnalysisOptions(dataset_name=key,
                                                          source_type="demo")))
    return out


@pytest.mark.parametrize("key", VERTICALS)
def test_pipeline_runs_clean(analysed, key):
    """No stage may degrade. A warning here means a silent contract break."""
    _, res = analysed[key]
    assert res.warnings == [], f"{key} degraded: {res.warnings}"


@pytest.mark.parametrize("key", VERTICALS)
def test_dataset_is_substantial(analysed, key):
    ds, res = analysed[key]
    assert len(ds.frame) > 20_000
    assert res.schema is not None and len(res.schema.columns) >= 10
    assert res.quality is not None and res.quality.score > 0.5


@pytest.mark.parametrize("key", VERTICALS)
def test_domain_and_plugin_resolve(analysed, key):
    _, res = analysed[key]
    assert res.domain is not None
    assert res.plugin is not None, f"{key} loaded no domain plugin"


@pytest.mark.parametrize("key", VERTICALS)
def test_expected_metric_is_discovered(analysed, key):
    """The KPI the story is about must appear in the scorecard on its own."""
    ds, res = analysed[key]
    want = ds.ground_truth["expected_metric"]
    ids = {k.id for k in res.scorecard.kpis}
    assert want in ids, f"{key}: {want} missing from {sorted(ids)}"


@pytest.mark.parametrize("key", VERTICALS)
def test_expected_metric_moved_in_the_planted_direction(analysed, key):
    ds, res = analysed[key]
    want = ds.ground_truth["expected_metric"]
    kpi = next(k for k in res.scorecard.kpis if k.id == want)
    assert kpi.delta_pct is not None
    if ds.ground_truth["expected_direction"] == "up":
        assert kpi.delta_pct > 5, f"{key}: {want} moved {kpi.delta_pct}"
    else:
        assert kpi.delta_pct < -3, f"{key}: {want} moved {kpi.delta_pct}"


@pytest.mark.parametrize("key", VERTICALS)
def test_root_cause_recovers_the_planted_segment(analysed, key):
    """The strongest contributor must be the segment the generator sabotaged."""
    ds, res = analysed[key]
    want_metric = ds.ground_truth["expected_metric"]
    trees = [t for t in res.root_causes if t.metric == want_metric]
    assert trees, (f"{key}: no root-cause tree for {want_metric}; "
                   f"got {[t.metric for t in res.root_causes]}")
    nodes = [n for n in trees[0].nodes if n.contribution_pct is not None]
    assert nodes, f"{key}: root-cause tree for {want_metric} is empty"
    top = max(nodes, key=lambda n: abs(n.contribution_pct))
    assert top.dimension == ds.ground_truth["expected_top_dimension"]
    assert top.segment == ds.ground_truth["expected_top_segment"]


@pytest.mark.parametrize("key", VERTICALS)
def test_every_chart_carries_a_narrative(analysed, key):
    """The headline invariant: InsightOS never renders a chart without a why."""
    _, res = analysed[key]
    assert res.charts
    for chart in res.charts:
        assert chart.narrative is not None
        assert chart.narrative.headline.strip()


@pytest.mark.parametrize("key", VERTICALS)
def test_governance_and_privacy_are_attached(analysed, key):
    _, res = analysed[key]
    assert res.governance is not None
    assert res.governance.decision_readiness in {
        "executive_ready", "operational", "exploratory", "blocked"}
    assert res.privacy is not None


@pytest.mark.parametrize("key", VERTICALS)
def test_recommendations_are_governed(analysed, key):
    """A recommendation without an owner and an audit trail is not auditable."""
    _, res = analysed[key]
    for rec in res.recommendations.recommendations:
        assert rec.suggested_owner
        assert rec.audit_trail
        assert 0.0 <= rec.confidence <= 1.0


def test_serialisation_is_json_safe(analysed):
    import json
    for _key, (_, res) in analysed.items():
        json.dumps(res.to_dict())
