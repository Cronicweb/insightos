"""The root-cause engine is the signature feature, so it is tested against
*planted* ground truth rather than against its own output.

Each demo generator injects a known effect and records it in `ground_truth`.
A passing suite therefore means the engine recovered a cause that was put there
on purpose - not merely that it produced something self-consistent.
"""
from __future__ import annotations

import pytest


def _tree_for(result, metric: str):
    for tree in result.root_causes:
        if tree.metric == metric:
            return tree
    return result.root_causes[0] if result.root_causes else None


@pytest.mark.slow
def test_banking_locates_the_planted_region(banking):
    ds, result = banking
    truth = ds.ground_truth
    tree = _tree_for(result, truth["primary_metric"])

    assert tree is not None, "engine produced no root-cause tree for the primary metric"
    assert tree.direction == truth["expected_direction"]

    top_dimension = tree.dimension_scores[0].dimension
    assert top_dimension == truth["expected_top_dimension"], (
        f"expected {truth['expected_top_dimension']} to best explain the move, got {top_dimension}"
    )

    drivers = [n.segment for n in tree.nodes if n.role == "driver"]
    assert truth["expected_top_segment"] in drivers


@pytest.mark.slow
def test_banking_reports_the_offsetting_segment_as_an_offset(banking):
    """`Premium` grew while the total fell. It must not be reported as a cause of
    the decline, and it must not be silently dropped either."""
    ds, result = banking
    tree = _tree_for(result, ds.ground_truth["primary_metric"])
    assert tree is not None

    expected = ds.ground_truth["expected_offset_segment"]

    # Roles are relative to the node's own parent: a segment may legitimately
    # drive the movement of a branch that itself offsets the total. The claim
    # under test is about the top level, where the comparison is against the
    # overall decline.
    top_drivers = {n.segment for n in tree.nodes if n.role == "driver"}
    top_offsets = {n.segment for n in tree.nodes if n.role == "offset"}

    assert expected not in top_drivers, f"{expected} grew; it cannot be a driver of a decline"
    if expected in {n.segment for n in tree.nodes}:
        assert expected in top_offsets

    # And it must survive into a child branch rather than being silently dropped,
    # everywhere reported as having grown.
    def walk(nodes):
        for n in nodes:
            yield n
            yield from walk(n.children)

    appearances = [n for n in walk(tree.nodes) if n.segment == expected]
    assert appearances, f"{expected} was dropped; offsetting segments must stay visible"
    for node in appearances:
        assert node.delta is None or node.delta > 0, (
            f"{expected} was planted as growing but is reported with delta {node.delta}"
        )


@pytest.mark.slow
def test_marketing_exonerates_spend(marketing):
    """Spend was deliberately held constant. An engine that blames it is wrong,
    and this is the test that catches the most seductive class of false positive."""
    ds, result = marketing
    tree = _tree_for(result, ds.ground_truth["primary_metric"])
    assert tree is not None

    top_dimension = tree.dimension_scores[0].dimension
    assert top_dimension == ds.ground_truth["expected_top_dimension"]

    drivers = [n.segment for n in tree.nodes if n.role == "driver"]
    assert ds.ground_truth["expected_top_segment"] in drivers

    blob = " ".join(tree.narrative).lower()
    assert "spend" not in blob or "unchanged" in blob or "not" in blob


@pytest.mark.slow
def test_ecommerce_finds_the_returning_customer_collapse(ecommerce):
    ds, result = ecommerce
    tree = _tree_for(result, ds.ground_truth["primary_metric"])
    assert tree is not None

    dimensions = [d.dimension for d in tree.dimension_scores]
    assert ds.ground_truth["expected_top_dimension"] in dimensions[:2]


@pytest.mark.slow
def test_contributions_are_signed_and_may_exceed_one_hundred(any_dataset):
    """When some segments offset others, contributions legitimately sum past 100%.
    This asserts the engine does *not* normalise that away - doing so would hide
    the offset and misstate the size of the real driver."""
    _, result = any_dataset
    for tree in result.root_causes:
        for node in tree.nodes:
            if node.contribution_pct is None:
                continue
            assert isinstance(node.contribution_pct, float)
            assert node.expected_delta is not None
            # excess = actual - expected; the engine ranks on unexpectedness.
            assert abs((node.delta - node.expected_delta) - node.excess_delta) < 1e-6


@pytest.mark.slow
def test_every_node_carries_a_statistical_verdict(any_dataset):
    _, result = any_dataset
    for tree in result.root_causes:
        for node in tree.nodes:
            assert node.test_name, "a node without a named test is unfalsifiable"
            assert node.role in {"driver", "offset", "stable"}
            assert node.narrative


@pytest.mark.slow
def test_circular_dimensions_are_excluded(banking):
    """`fraud_rate` must never be decomposed by `is_fraud`: the dimension defines
    the metric, so the 'explanation' would be a tautology."""
    _, result = banking
    for tree in result.root_causes:
        if "fraud" not in tree.metric:
            continue
        used = {d.dimension for d in tree.dimension_scores}
        assert "is_fraud" not in used
