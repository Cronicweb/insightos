"""Tests for the experimentation and incrementality engines."""

from __future__ import annotations

import math

import numpy as np
import pytest

from insightos.experiment import (
    analyse_conversion_experiment,
    analyse_value_experiment,
    cuped_adjust,
    difference_in_differences,
    holdout_lift,
    incremental_roas,
    minimum_detectable_effect,
    payback_period_days,
    power_for_proportion,
    sample_ratio_mismatch,
    sample_size_for_mean,
    sample_size_for_proportion,
    sequential_alpha,
)


# ---------------------------------------------------------------- design ----


def test_sample_size_matches_textbook_value():
    # 5% baseline, 10% relative lift, alpha=.05, power=.80 -> ~ 31.2k per arm.
    plan = sample_size_for_proportion(0.05, relative_effect=0.10)
    assert 29_000 <= plan.per_variant <= 34_000
    assert plan.total == plan.per_variant * 2
    assert plan.absolute_effect == pytest.approx(0.005)


def test_sample_size_scales_with_smaller_effects():
    small = sample_size_for_proportion(0.05, relative_effect=0.05)
    large = sample_size_for_proportion(0.05, relative_effect=0.20)
    assert small.per_variant > large.per_variant * 3


def test_more_arms_costs_more_per_arm():
    two = sample_size_for_proportion(0.10, relative_effect=0.10, variants=2)
    four = sample_size_for_proportion(0.10, relative_effect=0.10, variants=4)
    assert four.per_variant > two.per_variant


def test_duration_uses_daily_traffic():
    plan = sample_size_for_proportion(0.10, relative_effect=0.10, daily_traffic=10_000)
    assert plan.duration_days is not None
    assert plan.duration_days == pytest.approx(plan.total / 10_000)
    assert "day" in plan.feasible_in or "week" in plan.feasible_in
    assert "per variant" in plan.summary()


def test_sample_size_for_mean_is_sane():
    plan = sample_size_for_mean(100.0, 40.0, relative_effect=0.05)
    assert plan.per_variant > 100
    assert plan.absolute_effect == pytest.approx(5.0)


def test_mde_round_trips_with_power():
    n = 20_000
    mde = minimum_detectable_effect(0.10, n)  # relative
    achieved = power_for_proportion(0.10, 0.10 * (1 + mde), n)
    assert achieved == pytest.approx(0.80, abs=0.03)
    assert minimum_detectable_effect(0.10, 200_000) < mde


def test_sample_size_rejects_missing_effect():
    with pytest.raises(ValueError):
        sample_size_for_proportion(0.10)


# --------------------------------------------------------------- validity ----


def test_srm_passes_on_a_fair_split():
    result = sample_ratio_mismatch({"control": 50_120, "treatment": 49_880})
    assert result.detail["mismatch"] is False


def test_srm_catches_a_skewed_split():
    result = sample_ratio_mismatch({"control": 52_000, "treatment": 48_000})
    assert result.detail["mismatch"] is True
    assert result.p_value < 0.001


def test_srm_honours_a_deliberate_unequal_split():
    counts = {"control": 90_000, "treatment": 10_000}
    ratio = {"control": 0.9, "treatment": 0.1}
    assert sample_ratio_mismatch(counts, ratio).detail["mismatch"] is False
    assert sample_ratio_mismatch(counts).detail["mismatch"] is True


def test_sequential_alpha_relaxes_to_alpha_at_full_information():
    assert sequential_alpha(0.05, 1.0) == pytest.approx(0.05)
    assert sequential_alpha(0.05, 1.5) == pytest.approx(0.05)
    early = sequential_alpha(0.05, 0.25)
    assert 0 < early < 0.005


# ------------------------------------------------------------------ cuped ----


def test_cuped_reduces_variance_on_correlated_covariate():
    rng = np.random.default_rng(7)
    pre = rng.normal(100, 25, 5_000)
    post = pre * 0.8 + rng.normal(20, 10, 5_000)
    result = cuped_adjust(post, pre)
    assert result.variance_after < result.variance_before
    assert result.variance_reduction > 0.5
    assert result.values.mean() == pytest.approx(post.mean(), abs=1e-6)


def test_cuped_is_harmless_when_the_covariate_is_noise():
    rng = np.random.default_rng(11)
    post = rng.normal(100, 20, 2_000)
    noise = rng.normal(0, 1, 2_000)
    result = cuped_adjust(post, noise)
    assert result.variance_reduction < 0.05


# --------------------------------------------------------------- readouts ----


def test_conversion_experiment_detects_a_real_lift():
    readout = analyse_conversion_experiment(
        {"control": (2_000, 100_000), "offer": (2_400, 100_000)},
        control="control",
        name="statement credit offer",
    )
    assert readout.valid is True
    assert readout.winner == "offer"
    assert readout.decision == "ship"
    treatment = next(v for v in readout.variants if v.name == "offer")
    assert treatment.relative_lift == pytest.approx(0.20, abs=0.01)
    assert "offer" in readout.narrative


def test_conversion_experiment_calls_a_null_result_inconclusive():
    readout = analyse_conversion_experiment(
        {"control": (2_000, 100_000), "offer": (2_010, 100_000)},
        control="control",
    )
    assert readout.winner is None
    assert readout.decision == "no difference detected"
    assert "minimum detectable effect" in readout.narrative


def test_multiple_arms_are_fdr_controlled():
    arms = {"control": (2_000, 100_000)}
    for i in range(8):
        arms[f"arm_{i}"] = (2_005 + i, 100_000)
    readout = analyse_conversion_experiment(arms, control="control")
    assert readout.winner is None


def test_srm_invalidates_the_whole_readout():
    readout = analyse_conversion_experiment(
        {"control": (2_000, 60_000), "offer": (2_400, 40_000)},
        control="control",
    )
    assert readout.valid is False
    assert readout.decision == "invalid"
    assert readout.warnings


def test_value_experiment_detects_a_spend_lift():
    rng = np.random.default_rng(3)
    control = rng.normal(120, 30, 4_000)
    treatment = rng.normal(129, 30, 4_000)
    readout = analyse_value_experiment(
        {"control": control, "treatment": treatment}, control="control"
    )
    assert readout.winner == "treatment"
    variant = next(v for v in readout.variants if v.name == "treatment")
    assert variant.absolute_lift > 0


def test_value_experiment_accepts_covariates():
    rng = np.random.default_rng(5)
    pre_c = rng.normal(100, 30, 3_000)
    pre_t = rng.normal(100, 30, 3_000)
    readout = analyse_value_experiment(
        {"control": pre_c * 0.9 + rng.normal(10, 8, 3_000),
         "treatment": pre_t * 0.9 + rng.normal(14, 8, 3_000)},
        control="control",
        covariates={"control": pre_c, "treatment": pre_t},
    )
    assert readout.variants
    assert any("CUPED" in w for w in readout.warnings)


def test_unknown_control_arm_raises():
    with pytest.raises(ValueError):
        analyse_conversion_experiment({"a": (1, 10)}, control="control")


# -------------------------------------------------------- incrementality ----


def test_holdout_lift_recovers_a_planted_effect():
    rng = np.random.default_rng(13)
    holdout = rng.normal(80, 20, 5_000)
    treated = rng.normal(88, 20, 20_000)
    result = holdout_lift(treated, holdout, spend=40_000.0, population=20_000)
    assert result.incremental_per_member == pytest.approx(8.0, abs=1.5)
    assert result.significant is True
    assert result.iroas is not None and result.iroas > 1.0


def test_holdout_lift_without_spend_has_no_roas():
    rng = np.random.default_rng(17)
    result = holdout_lift(rng.normal(50, 10, 1_000), rng.normal(50, 10, 1_000))
    assert result.iroas is None


def test_difference_in_differences_recovers_the_treatment_effect():
    rng = np.random.default_rng(19)
    seasonal = 6.0
    effect = 9.0
    result = difference_in_differences(
        treated_pre=rng.normal(100, 15, 4_000),
        treated_post=rng.normal(100 + seasonal + effect, 15, 4_000),
        control_pre=rng.normal(100, 15, 4_000),
        control_post=rng.normal(100 + seasonal, 15, 4_000),
    )
    assert result.incremental_per_member == pytest.approx(effect, abs=1.5)
    assert result.significant is True


def test_difference_in_differences_warns_on_broken_parallel_trends():
    rng = np.random.default_rng(23)
    result = difference_in_differences(
        treated_pre=rng.normal(150, 15, 2_000),
        treated_post=rng.normal(160, 15, 2_000),
        control_pre=rng.normal(100, 15, 2_000),
        control_post=rng.normal(105, 15, 2_000),
    )
    assert result.warnings


def test_incremental_roas_and_payback():
    assert incremental_roas(250_000.0, 100_000.0) == pytest.approx(2.5)
    with pytest.raises(ValueError):
        incremental_roas(1.0, 0.0)
    assert payback_period_days(50_000.0, 2_500.0) == pytest.approx(20.0)
    assert math.isinf(payback_period_days(50_000.0, 0.0))
