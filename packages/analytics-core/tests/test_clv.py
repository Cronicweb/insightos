"""Tests for RFM segmentation, cohort retention and lifetime value."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from insightos.clv import (
    SEGMENT_ORDER,
    cohort_retention,
    customer_lifetime_value,
    expected_remaining_lifetime,
    gini,
    predicted_clv,
    probability_alive,
    rfm_table,
    summarise_rfm,
    value_concentration,
)


def _transactions(seed: int = 42, customers: int = 240) -> pd.DataFrame:
    """A synthetic transaction log with a decaying repeat pattern."""
    rng = np.random.default_rng(seed)
    rows = []
    start = pd.Timestamp("2024-01-01")
    for c in range(customers):
        joined = start + pd.Timedelta(days=int(rng.integers(0, 240)))
        segment = ["Consumer", "Enterprise"][c % 2]
        orders = 1 + int(rng.geometric(0.35))
        cursor = joined
        for _ in range(orders):
            rows.append(
                {
                    "customer_id": f"C{c:04d}",
                    "order_date": cursor,
                    "amount": float(rng.gamma(4.0, 30.0 if segment == "Consumer" else 55.0)),
                    "segment": segment,
                }
            )
            cursor = cursor + pd.Timedelta(days=int(rng.integers(20, 70)))
            if cursor > start + pd.Timedelta(days=540):
                break
    return pd.DataFrame(rows)


# -------------------------------------------------------------------- rfm ----


def test_rfm_table_scores_every_customer():
    df = _transactions()
    table = rfm_table(df, "customer_id", "order_date", "amount")
    assert len(table) == df["customer_id"].nunique()
    assert set(table["segment"]).issubset(set(SEGMENT_ORDER))
    assert table["r_score"].between(1, 5).all()
    assert table["f_score"].between(1, 5).all()
    assert table["m_score"].between(1, 5).all()
    assert table["rfm_cell"].str.len().eq(3).all()
    assert table["action"].notna().all()


def test_rfm_recency_ranks_correctly():
    df = pd.DataFrame(
        {
            "customer_id": ["A", "B", "C", "D", "E"],
            "order_date": pd.to_datetime(
                ["2024-06-01", "2024-05-01", "2024-04-01", "2024-03-01", "2024-01-01"]
            ),
            "amount": [10.0, 20.0, 30.0, 40.0, 50.0],
        }
    )
    table = rfm_table(df, "customer_id", "order_date", "amount")
    assert table.loc["A", "r_score"] > table.loc["E", "r_score"]
    assert table.loc["A", "recency_days"] < table.loc["E", "recency_days"]


def test_rfm_survives_single_frequency_data():
    # Every customer bought exactly once: qcut would explode on duplicate edges.
    df = pd.DataFrame(
        {
            "customer_id": [f"C{i}" for i in range(50)],
            "order_date": pd.date_range("2024-01-01", periods=50, freq="D"),
            "amount": np.linspace(10, 500, 50),
        }
    )
    table = rfm_table(df, "customer_id", "order_date", "amount")
    assert len(table) == 50
    assert table["frequency"].eq(1).all()


def test_summarise_rfm_shares_sum_to_one():
    table = rfm_table(_transactions(), "customer_id", "order_date", "amount")
    summary = summarise_rfm(table)
    assert summary.customers == len(table)
    total = sum(s["monetary_share"] for s in summary.segments)
    assert total == pytest.approx(1.0, abs=1e-6)
    assert sum(s["customers"] for s in summary.segments) == summary.customers
    assert summary.narrative()


def test_rfm_rejects_a_missing_column():
    with pytest.raises(KeyError):
        rfm_table(_transactions(), "customer_id", "order_date", "not_a_column")


# ---------------------------------------------------------------- cohorts ----


def test_cohort_matrix_starts_at_one_and_decays():
    result = cohort_retention(_transactions(), "customer_id", "order_date", freq="M")
    assert not result.matrix.empty
    first_column = result.matrix[0].dropna()
    assert first_column.tolist() == pytest.approx([1.0] * len(first_column))
    assert result.curve[0] == pytest.approx(1.0)
    assert result.curve[1] < 1.0
    assert result.period_name == "month"


def test_cohort_leaves_unobserved_cells_blank():
    result = cohort_retention(_transactions(), "customer_id", "order_date", freq="M")
    youngest = result.matrix.index[-1]
    assert result.matrix.loc[youngest].isna().sum() > 0


def test_cohort_sizes_match_customer_counts():
    df = _transactions()
    result = cohort_retention(df, "customer_id", "order_date", freq="M")
    assert int(result.sizes.sum()) == df["customer_id"].nunique()


def test_cohort_handles_weekly_and_quarterly_frequencies():
    df = _transactions()
    for freq in ("W", "Q", "D", "Y"):
        result = cohort_retention(df, "customer_id", "order_date", freq=freq)
        assert not result.matrix.empty


def test_cohort_rejects_a_bad_frequency():
    with pytest.raises(ValueError):
        cohort_retention(_transactions(), "customer_id", "order_date", freq="fortnight")


def test_cohort_perfect_retention_is_all_ones():
    rows = []
    for c in range(20):
        for m in range(6):
            rows.append(
                {
                    "customer_id": f"C{c}",
                    "order_date": pd.Timestamp("2024-01-15") + pd.DateOffset(months=m),
                }
            )
    df = pd.DataFrame(rows)
    result = cohort_retention(df, "customer_id", "order_date", freq="M")
    assert result.curve[:6] == pytest.approx([1.0] * 6)
    # Clamped just below 1.0 on purpose: a customer who never churns is worth
    # infinity, which is true and useless.
    assert result.steady_state_retention == pytest.approx(1.0, abs=1e-4)
    assert result.steady_state_retention < 1.0


# ------------------------------------------------------------------- clv ----


def test_predicted_clv_matches_the_closed_form():
    # 100 AOV, 1 purchase/period, 30% margin, r=.8, d=.01 -> 30 * .8/.21
    assert predicted_clv(100.0, 1.0, 0.30, 0.80, 0.01) == pytest.approx(
        30.0 * 0.80 / (1.01 - 0.80)
    )


def test_predicted_clv_rises_with_retention():
    low = predicted_clv(100.0, 1.0, 0.3, 0.5)
    high = predicted_clv(100.0, 1.0, 0.3, 0.9)
    assert high > low * 5


def test_finite_horizon_is_below_the_infinite_series():
    finite = predicted_clv(100.0, 1.0, 0.3, 0.8, 0.01, horizon_periods=6)
    infinite = predicted_clv(100.0, 1.0, 0.3, 0.8, 0.01)
    assert finite < infinite
    assert predicted_clv(100.0, 1.0, 0.3, 0.8, 0.01, horizon_periods=500) == pytest.approx(
        infinite, rel=1e-4
    )


def test_predicted_clv_rejects_impossible_retention():
    with pytest.raises(ValueError):
        predicted_clv(100.0, 1.0, 0.3, 1.0)


def test_expected_lifetime():
    assert expected_remaining_lifetime(0.75) == pytest.approx(4.0)


def test_probability_alive_direction():
    # Same number of purchases; the one who stopped early is less likely alive.
    recent = probability_alive(frequency=10, recency_periods=11.4, observation_periods=12.0)
    stale = probability_alive(frequency=10, recency_periods=2.4, observation_periods=12.0)
    assert recent > stale
    assert probability_alive(1, 0.0, 12.0) == 1.0


def test_gini_bounds():
    assert gini(np.ones(100)) == pytest.approx(0.0, abs=1e-9)
    skewed = np.array([0.0] * 99 + [1_000.0])
    assert gini(skewed) > 0.9
    assert gini(np.array([])) == 0.0


def test_value_concentration():
    values = np.array([1.0] * 90 + [100.0] * 10)
    assert value_concentration(values) == pytest.approx(1000 / 1090, rel=1e-6)


def test_customer_lifetime_value_end_to_end():
    df = _transactions()
    result = customer_lifetime_value(
        df, "customer_id", "order_date", "amount", segment_col="segment"
    )
    assert result.customers == df["customer_id"].nunique()
    assert result.average_order_value == pytest.approx(df["amount"].mean())
    assert result.predicted_clv > 0
    assert 0.0 <= result.retention_rate < 1.0
    assert 0.0 <= result.top_decile_value_share <= 1.0
    assert result.assumptions
    assert len(result.by_segment) == 2
    assert result.narrative()
    assert result.to_dict()["predicted_clv"] == result.predicted_clv


def test_clv_segments_rank_enterprise_above_consumer():
    result = customer_lifetime_value(
        _transactions(), "customer_id", "order_date", "amount", segment_col="segment"
    )
    ranked = [s["segment"] for s in result.by_segment]
    assert ranked[0] == "Enterprise"


def test_clv_respects_an_explicit_retention_rate():
    result = customer_lifetime_value(
        _transactions(), "customer_id", "order_date", "amount", retention_rate=0.6
    )
    assert result.retention_rate == pytest.approx(0.6)
    assert any("supplied by the caller" in a for a in result.assumptions)


def test_clv_rejects_a_missing_column():
    with pytest.raises(KeyError):
        customer_lifetime_value(_transactions(), "customer_id", "order_date", "nope")


def test_clv_rejects_an_impossible_margin():
    with pytest.raises(ValueError):
        customer_lifetime_value(
            _transactions(), "customer_id", "order_date", "amount", margin_rate=1.5
        )
