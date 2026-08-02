"""Dataset governance charter."""
from __future__ import annotations

import pandas as pd
import pytest

from insightos.demo.generators import GENERATORS
from insightos.governance import (
    DecisionReadiness,
    readiness_confidence_cap,
)
from insightos.pipeline import AnalysisOptions, analyse


@pytest.fixture(scope="module")
def clean_result():
    return analyse(
        GENERATORS["ecommerce"]().frame,
        AnalysisOptions(dataset_name="ecommerce", source="synthetic", source_type="demo"),
    )


def test_clean_demo_data_is_executive_ready(clean_result) -> None:
    gov = clean_result.governance
    assert gov is not None
    assert gov.decision_readiness is DecisionReadiness.EXECUTIVE_READY
    assert gov.quality_score > 80
    assert gov.confidence_cap == 1.0


def test_every_check_carries_a_human_explanation(clean_result) -> None:
    assert len(clean_result.governance.checks) >= 5
    for check in clean_result.governance.checks:
        assert check.detail.strip()
        assert check.status in {"pass", "warn", "fail"}


def test_governance_serialises_for_the_web(clean_result) -> None:
    payload = clean_result.governance.to_dict()
    for key in ("source", "owner", "trustLevel", "decisionReadiness", "qualityScore", "checks"):
        assert key in payload
    assert isinstance(payload["freshness"], dict)


def test_readiness_caps_are_monotonic() -> None:
    caps = [
        readiness_confidence_cap(DecisionReadiness.BLOCKED),
        readiness_confidence_cap(DecisionReadiness.EXPLORATORY),
        readiness_confidence_cap(DecisionReadiness.OPERATIONAL),
        readiness_confidence_cap(DecisionReadiness.EXECUTIVE_READY),
    ]
    assert caps == sorted(caps)
    assert caps[-1] == 1.0


def test_dirty_data_is_downgraded() -> None:
    df = pd.DataFrame(
        {
            "date": pd.to_datetime(["2019-01-01"] * 30),
            "revenue": [None] * 25 + [1.0, 2.0, 3.0, 4.0, 5.0],
            "region": ["East"] * 30,
        }
    )
    res = analyse(df, AnalysisOptions(dataset_name="dirty", source_type="upload"))
    gov = res.governance
    assert gov.decision_readiness in (DecisionReadiness.BLOCKED, DecisionReadiness.EXPLORATORY)
    assert gov.confidence_cap < 1.0
    assert any(c.status != "pass" for c in gov.checks)
