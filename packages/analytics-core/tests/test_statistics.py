"""The hand-written statistics are the foundation everything else stands on, so
they are checked against independently known values rather than against
themselves. InsightOS implements these directly (no SciPy) to keep the engine
dependency-light and to make every method auditable in a single file.
"""
from __future__ import annotations

import math

import numpy as np
import pytest

from insightos.statistics import distributions as dist
from insightos.statistics import tests as st
from insightos.statistics import timeseries as ts

# --------------------------------------------------------------------------- #
# Distributions - compared against published quantiles.
# --------------------------------------------------------------------------- #


def test_normal_cdf_matches_known_quantiles():
    assert dist.norm_cdf(0.0) == pytest.approx(0.5, abs=1e-9)
    assert dist.norm_cdf(1.959963985) == pytest.approx(0.975, abs=1e-6)
    assert dist.norm_cdf(-1.959963985) == pytest.approx(0.025, abs=1e-6)
    assert dist.norm_cdf(2.575829304) == pytest.approx(0.995, abs=1e-6)


def test_normal_cdf_is_monotonic_and_bounded():
    xs = np.linspace(-6, 6, 200)
    vals = [dist.norm_cdf(float(x)) for x in xs]
    assert all(0.0 <= v <= 1.0 for v in vals)
    assert all(b >= a - 1e-12 for a, b in zip(vals, vals[1:]))


def test_norm_ppf_inverts_norm_cdf():
    for p in (0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99):
        assert dist.norm_cdf(dist.norm_ppf(p)) == pytest.approx(p, abs=1e-6)


def test_students_t_approaches_the_normal_as_df_grows():
    assert dist.t_sf(1.96, df=5) > dist.t_sf(1.96, df=5000)
    assert dist.t_sf(1.959963985, df=1_000_000) == pytest.approx(0.025, abs=1e-4)


def test_chi_square_survival_known_value():
    """chi2(1) at 3.8414588 is the classic 5% critical value."""
    assert dist.chi2_sf(3.8414588, 1) == pytest.approx(0.05, abs=1e-5)


# --------------------------------------------------------------------------- #
# Hypothesis tests.
# --------------------------------------------------------------------------- #


def test_benjamini_hochberg_rejects_nothing_under_the_null():
    assert not any(st.benjamini_hochberg([0.9, 0.8, 0.7, 0.6, 0.5], fdr=0.10))


def test_benjamini_hochberg_finds_a_real_signal():
    flags = st.benjamini_hochberg([0.0001, 0.0002, 0.9, 0.8, 0.7], fdr=0.10)
    assert flags[0] and flags[1]
    assert not flags[2]


def test_benjamini_hochberg_is_less_conservative_than_bonferroni():
    """Why the engine uses FDR control: screening dozens of segments with
    Bonferroni would suppress genuine drivers."""
    ps = [0.01, 0.02, 0.03, 0.04, 0.05]
    bh = st.benjamini_hochberg(ps, fdr=0.10)
    bonferroni = [p <= 0.05 / len(ps) for p in ps]
    assert sum(bh) >= sum(bonferroni)


def test_benjamini_hochberg_handles_empty_input():
    assert st.benjamini_hochberg([]) == []


def test_two_proportion_test_separates_clearly_different_rates():
    r = st.two_proportion_z_test(success_a=50, n_a=1000, success_b=100, n_b=1000)
    assert r.p_value < 0.001
    assert r.significant
    assert r.detail["difference"] == pytest.approx(-0.05, abs=1e-9)


def test_two_proportion_test_returns_one_for_identical_rates():
    r = st.two_proportion_z_test(success_a=100, n_a=1000, success_b=100, n_b=1000)
    assert r.p_value == pytest.approx(1.0, abs=1e-9)
    assert not r.significant


def test_two_proportion_test_degrades_on_empty_samples():
    r = st.two_proportion_z_test(success_a=0, n_a=0, success_b=0, n_b=0)
    assert r.p_value == 1.0
    assert not r.significant


def test_welch_t_test_separates_shifted_distributions():
    rng = np.random.default_rng(7)
    a = list(rng.normal(0.0, 1.0, 500))
    b = list(rng.normal(1.0, 1.0, 500))
    assert st.welch_t_test(a, b).p_value < 1e-10


def test_welch_t_test_does_not_cry_wolf():
    rng = np.random.default_rng(11)
    a = list(rng.normal(0.0, 1.0, 500))
    b = list(rng.normal(0.0, 1.0, 500))
    assert st.welch_t_test(a, b).p_value > 0.01


def test_cohens_d_recovers_a_known_effect_size():
    rng = np.random.default_rng(3)
    a = list(rng.normal(0.0, 1.0, 4000))
    b = list(rng.normal(0.8, 1.0, 4000))
    d = st.cohens_d(a, b)
    assert not math.isnan(d)
    assert 0.65 < abs(d) < 0.95


def test_effect_magnitude_is_labelled_qualitatively():
    rng = np.random.default_rng(5)
    a = list(rng.normal(0.0, 1.0, 3000))
    b = list(rng.normal(2.0, 1.0, 3000))
    assert st.welch_t_test(a, b).effect_magnitude in {"moderate", "large"}


def test_cliffs_delta_is_scale_free():
    a = [1.0, 2.0, 3.0, 4.0]
    b = [5.0, 6.0, 7.0, 8.0]
    assert st.cliffs_delta(a, b) == pytest.approx(-1.0, abs=1e-9)
    assert st.cliffs_delta(a, a) == pytest.approx(0.0, abs=1e-9)


def test_chi_square_independence_detects_association():
    assert st.chi_square_independence([[50, 50], [50, 50]]).p_value > 0.5
    assert st.chi_square_independence([[90, 10], [10, 90]]).p_value < 1e-10


def test_mann_whitney_is_robust_where_a_mean_would_mislead():
    a = [1.0, 2.0, 3.0, 4.0, 5.0]
    b = [6.0, 7.0, 8.0, 9.0, 1_000_000.0]
    assert st.mann_whitney_u(a, b).p_value < 0.05


def test_one_way_anova_separates_group_means():
    rng = np.random.default_rng(13)
    same = [list(rng.normal(0, 1, 200)) for _ in range(3)]
    shifted = [list(rng.normal(m, 1, 200)) for m in (0.0, 1.0, 2.0)]
    assert st.one_way_anova(same).p_value > 0.01
    assert st.one_way_anova(shifted).p_value < 1e-10


def test_pearson_correlation_recovers_a_linear_relationship():
    x = [float(i) for i in range(100)]
    y = [2.0 * v + 1.0 for v in x]
    r = st.pearson_correlation(x, y)
    # ``statistic`` carries the t statistic; the correlation itself is the
    # effect size, which is what an analyst actually reports.
    assert r.effect_size == pytest.approx(1.0, abs=1e-6)
    assert r.effect_size_name == "r"
    assert r.p_value < 1e-10


def test_pearson_reports_no_correlation_for_a_constant_column():
    assert math.isnan(st.pearson_correlation([1.0] * 20, [float(i) for i in range(20)]).statistic)


def test_test_result_serialises_for_the_api_layer():
    r = st.two_proportion_z_test(success_a=50, n_a=1000, success_b=100, n_b=1000)
    d = r.to_dict()
    assert d["name"] == "two_proportion_z_test"
    assert "significant" in d and "effect_magnitude" in d


# --------------------------------------------------------------------------- #
# Time series.
# --------------------------------------------------------------------------- #


def test_mann_kendall_detects_a_monotonic_trend():
    rising = ts.mann_kendall([float(i) for i in range(20)])
    assert rising.direction == "increasing"
    assert rising.significant
    assert rising.tau == pytest.approx(1.0, abs=1e-9)

    assert ts.mann_kendall([float(-i) for i in range(20)]).direction == "decreasing"


def test_mann_kendall_finds_no_trend_in_noise():
    rng = np.random.default_rng(42)
    assert not ts.mann_kendall(list(rng.normal(0, 1, 60))).significant


def test_theil_sen_is_robust_to_a_catastrophic_outlier():
    """Exactly why the engine reports Theil-Sen rather than least squares: one
    corrupt observation must not rewrite the reported trend."""
    clean = [float(i) for i in range(30)]
    contaminated = list(clean)
    contaminated[15] = 10_000.0

    assert ts.theil_sen_slope(clean) == pytest.approx(1.0, abs=1e-9)
    assert ts.theil_sen_slope(contaminated) == pytest.approx(1.0, abs=0.25)


def test_seasonality_is_detected_in_a_clean_cycle():
    y = [10.0 + 5.0 * math.sin(2 * math.pi * i / 12) for i in range(72)]
    result = ts.detect_seasonality(y)
    assert result.detected
    assert result.period == 12


def test_seasonality_is_not_invented_in_noise():
    rng = np.random.default_rng(21)
    result = ts.detect_seasonality(list(rng.normal(0, 1, 120)))
    assert not result.detected or result.strength < 0.35


def test_classical_decomposition_returns_aligned_components():
    y = [10.0 + 0.1 * i + 3.0 * math.sin(2 * math.pi * i / 12) for i in range(60)]
    d = ts.classical_decompose(y, period=12)
    assert len(d.trend) == len(y)
    assert len(d.seasonal) == len(y)
    assert len(d.residual) == len(y)


def test_rolling_mad_z_flags_a_planted_spike():
    y = [10.0] * 40
    y[30] = 90.0
    z = ts.rolling_mad_z(y, window=7)
    assert abs(z[30]) > 3.5


def test_change_point_detection_finds_a_level_shift():
    y = [10.0] * 40 + [30.0] * 40
    points = ts.detect_change_points(y)
    assert points, "a tripling of the level must register as a change point"
    assert any(30 <= p.index <= 50 for p in points)
