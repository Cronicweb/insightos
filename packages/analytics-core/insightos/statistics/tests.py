"""Hypothesis tests and effect sizes used to qualify every InsightOS finding.

No insight is published by InsightOS unless it carries a test statistic, a
p-value and an effect size.  That rule is what separates this engine from a
dashboard: a dashboard shows that revenue moved, InsightOS states whether the
move is distinguishable from noise and how large it is in practical terms.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any, Sequence

import numpy as np

from .distributions import chi2_sf, f_sf, norm_ppf, norm_sf, t_sf

__all__ = [
    "TestResult",
    "welch_t_test",
    "two_proportion_z_test",
    "mann_whitney_u",
    "chi_square_independence",
    "pearson_correlation",
    "spearman_correlation",
    "one_way_anova",
    "poisson_rate_test",
    "cohens_d",
    "cliffs_delta",
    "benjamini_hochberg",
    "bootstrap_ci",
]


@dataclass
class TestResult:
    """A single statistical verdict, serialisable straight to the API layer."""

    name: str
    statistic: float
    p_value: float
    effect_size: float | None = None
    effect_size_name: str | None = None
    confidence_interval: tuple[float, float] | None = None
    df: float | None = None
    n: int | None = None
    detail: dict[str, Any] = field(default_factory=dict)

    @property
    def significant(self) -> bool:
        return self.p_value < 0.05

    def significant_at(self, alpha: float) -> bool:
        return self.p_value < alpha

    @property
    def effect_magnitude(self) -> str:
        """Cohen-style qualitative bucket for the effect size."""
        if self.effect_size is None or math.isnan(self.effect_size):
            return "unknown"
        e = abs(self.effect_size)
        if self.effect_size_name in {"cohens_d", "hedges_g"}:
            bounds = (0.2, 0.5, 0.8)
        elif self.effect_size_name == "cliffs_delta":
            bounds = (0.147, 0.33, 0.474)
        elif self.effect_size_name in {"cramers_v", "eta_squared", "r"}:
            bounds = (0.1, 0.3, 0.5)
        else:
            bounds = (0.2, 0.5, 0.8)
        if e < bounds[0]:
            return "negligible"
        if e < bounds[1]:
            return "small"
        if e < bounds[2]:
            return "moderate"
        return "large"

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["significant"] = self.significant
        d["effect_magnitude"] = self.effect_magnitude
        if self.confidence_interval is not None:
            d["confidence_interval"] = list(self.confidence_interval)
        return d


def _clean(x: Sequence[float]) -> np.ndarray:
    arr = np.asarray(x, dtype="float64").ravel()
    return arr[np.isfinite(arr)]


# --------------------------------------------------------------------------- #
# Means
# --------------------------------------------------------------------------- #
def welch_t_test(a: Sequence[float], b: Sequence[float], alpha: float = 0.05) -> TestResult:
    """Welch's unequal-variance t-test with Hedges' g and a CI on the difference."""
    x, y = _clean(a), _clean(b)
    n1, n2 = x.size, y.size
    if n1 < 2 or n2 < 2:
        return TestResult("welch_t_test", float("nan"), 1.0, n=int(n1 + n2),
                          detail={"reason": "insufficient observations"})
    m1, m2 = float(x.mean()), float(y.mean())
    v1, v2 = float(x.var(ddof=1)), float(y.var(ddof=1))
    se = math.sqrt(v1 / n1 + v2 / n2)
    if se == 0:
        # Both samples are constant. If the constants differ the separation is
        # perfect rather than untestable, so the null is rejected outright;
        # identical constants carry no evidence at all.
        separated = m1 != m2
        return TestResult(
            "welch_t_test",
            math.inf if separated else 0.0,
            0.0 if separated else 1.0,
            math.inf if separated else 0.0,
            "hedges_g",
            n=int(n1 + n2),
            detail={
                "reason": "zero variance in both samples",
                "mean_a": m1,
                "mean_b": m2,
                "difference": m1 - m2,
                "n_a": int(n1),
                "n_b": int(n2),
            },
        )
    t = (m1 - m2) / se
    df = (v1 / n1 + v2 / n2) ** 2 / (
        (v1 / n1) ** 2 / max(n1 - 1, 1) + (v2 / n2) ** 2 / max(n2 - 1, 1)
    )
    p = 2.0 * t_sf(abs(t), df)
    d = cohens_d(x, y)
    j = 1.0 - 3.0 / (4.0 * (n1 + n2) - 9.0)  # small-sample bias correction
    g = d * j
    crit = abs(norm_ppf(alpha / 2.0)) if df > 200 else _t_crit(alpha, df)
    ci = ((m1 - m2) - crit * se, (m1 - m2) + crit * se)
    return TestResult("welch_t_test", t, p, g, "hedges_g", ci, df, int(n1 + n2),
                      {"mean_a": m1, "mean_b": m2, "n_a": int(n1), "n_b": int(n2),
                       "difference": m1 - m2})


def _t_crit(alpha: float, df: float) -> float:
    """Two-sided t critical value by bisection on the survival function."""
    lo, hi = 0.0, 100.0
    target = alpha / 2.0
    for _ in range(200):
        mid = (lo + hi) / 2.0
        if t_sf(mid, df) > target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def cohens_d(a: Sequence[float], b: Sequence[float]) -> float:
    """Cohen's d using the pooled standard deviation."""
    x, y = _clean(a), _clean(b)
    n1, n2 = x.size, y.size
    if n1 < 2 or n2 < 2:
        return float("nan")
    s_pool = math.sqrt(
        ((n1 - 1) * x.var(ddof=1) + (n2 - 1) * y.var(ddof=1)) / (n1 + n2 - 2)
    )
    if s_pool == 0:
        return 0.0
    return float((x.mean() - y.mean()) / s_pool)


def cliffs_delta(a: Sequence[float], b: Sequence[float]) -> float:
    """Non-parametric effect size in [-1, 1]; O(n log n) via rank arithmetic."""
    x, y = _clean(a), _clean(b)
    if x.size == 0 or y.size == 0:
        return float("nan")
    combined = np.concatenate([x, y])
    ranks = _rankdata(combined)
    r1 = ranks[: x.size].sum()
    u1 = r1 - x.size * (x.size + 1) / 2.0
    return float(2.0 * u1 / (x.size * y.size) - 1.0)


# --------------------------------------------------------------------------- #
# Proportions / counts
# --------------------------------------------------------------------------- #
def two_proportion_z_test(
    success_a: int, n_a: int, success_b: int, n_b: int, alpha: float = 0.05
) -> TestResult:
    """Pooled two-proportion z-test with an unpooled Wald CI on the difference."""
    if n_a <= 0 or n_b <= 0:
        return TestResult("two_proportion_z_test", float("nan"), 1.0,
                          detail={"reason": "empty sample"})
    p1, p2 = success_a / n_a, success_b / n_b
    p_pool = (success_a + success_b) / (n_a + n_b)
    se_pool = math.sqrt(p_pool * (1 - p_pool) * (1 / n_a + 1 / n_b))
    if se_pool == 0:
        return TestResult("two_proportion_z_test", 0.0, 1.0, 0.0, "cohens_h",
                          n=n_a + n_b, detail={"p_a": p1, "p_b": p2})
    z = (p1 - p2) / se_pool
    p = 2.0 * norm_sf(abs(z))
    h = 2 * math.asin(math.sqrt(min(max(p1, 0), 1))) - 2 * math.asin(math.sqrt(min(max(p2, 0), 1)))
    se_un = math.sqrt(p1 * (1 - p1) / n_a + p2 * (1 - p2) / n_b)
    crit = abs(norm_ppf(alpha / 2.0))
    ci = ((p1 - p2) - crit * se_un, (p1 - p2) + crit * se_un)
    return TestResult("two_proportion_z_test", z, p, h, "cohens_h", ci, None, n_a + n_b,
                      {"p_a": p1, "p_b": p2, "difference": p1 - p2})


def poisson_rate_test(count_a: int, exposure_a: float, count_b: int, exposure_b: float) -> TestResult:
    """E-test style comparison of two Poisson rates via the variance-stabilising transform."""
    if exposure_a <= 0 or exposure_b <= 0:
        return TestResult("poisson_rate_test", float("nan"), 1.0,
                          detail={"reason": "non-positive exposure"})
    r1, r2 = count_a / exposure_a, count_b / exposure_b
    z_num = 2 * (math.sqrt(count_a + 0.375) - math.sqrt(count_b + 0.375) * math.sqrt(exposure_a / exposure_b))
    z_den = math.sqrt(1 + exposure_a / exposure_b)
    z = z_num / z_den if z_den else 0.0
    p = 2.0 * norm_sf(abs(z))
    ratio = r1 / r2 if r2 else float("inf")
    return TestResult("poisson_rate_test", z, p, ratio, "rate_ratio", None, None,
                      count_a + count_b, {"rate_a": r1, "rate_b": r2})


def chi_square_independence(table: Sequence[Sequence[float]]) -> TestResult:
    """Pearson chi-square test of independence with Cramer's V."""
    obs = np.asarray(table, dtype="float64")
    if obs.ndim != 2 or obs.size == 0 or obs.sum() == 0:
        return TestResult("chi_square_independence", float("nan"), 1.0,
                          detail={"reason": "degenerate table"})
    row = obs.sum(axis=1, keepdims=True)
    col = obs.sum(axis=0, keepdims=True)
    total = obs.sum()
    exp = row @ col / total
    with np.errstate(divide="ignore", invalid="ignore"):
        terms = np.where(exp > 0, (obs - exp) ** 2 / exp, 0.0)
    stat = float(terms.sum())
    df = (obs.shape[0] - 1) * (obs.shape[1] - 1)
    p = chi2_sf(stat, df) if df > 0 else 1.0
    k = min(obs.shape) - 1
    v = math.sqrt(stat / (total * k)) if k > 0 else 0.0
    return TestResult("chi_square_independence", stat, p, v, "cramers_v", None, float(df),
                      int(total), {"min_expected": float(exp.min())})


# --------------------------------------------------------------------------- #
# Association
# --------------------------------------------------------------------------- #
def pearson_correlation(x: Sequence[float], y: Sequence[float], alpha: float = 0.05) -> TestResult:
    """Pearson r with a Fisher z confidence interval.

    Note the convention used throughout the engine: ``statistic`` carries the t
    statistic (what the p-value is computed from) and ``effect_size`` carries r.
    """
    a, b = np.asarray(x, dtype="float64"), np.asarray(y, dtype="float64")
    mask = np.isfinite(a) & np.isfinite(b)
    a, b = a[mask], b[mask]
    n = a.size
    if n < 3 or a.std() == 0 or b.std() == 0:
        return TestResult("pearson_correlation", float("nan"), 1.0, n=int(n),
                          detail={"reason": "insufficient variation"})
    r = float(np.corrcoef(a, b)[0, 1])
    r = max(min(r, 0.999999999999), -0.999999999999)
    t = r * math.sqrt((n - 2) / (1 - r * r))
    p = 2.0 * t_sf(abs(t), n - 2)
    z = 0.5 * math.log((1 + r) / (1 - r))
    se = 1.0 / math.sqrt(n - 3)
    crit = abs(norm_ppf(alpha / 2.0))
    ci = (math.tanh(z - crit * se), math.tanh(z + crit * se))
    return TestResult("pearson_correlation", t, p, r, "r", ci, float(n - 2), int(n))


def _rankdata(values: np.ndarray) -> np.ndarray:
    """Average ranks, ties handled - equivalent to scipy.stats.rankdata."""
    order = np.argsort(values, kind="mergesort")
    ranks = np.empty(values.size, dtype="float64")
    ranks[order] = np.arange(1, values.size + 1, dtype="float64")
    sorted_vals = values[order]
    i = 0
    while i < sorted_vals.size:
        j = i
        while j + 1 < sorted_vals.size and sorted_vals[j + 1] == sorted_vals[i]:
            j += 1
        if j > i:
            ranks[order[i : j + 1]] = (i + j + 2) / 2.0
        i = j + 1
    return ranks


def spearman_correlation(x: Sequence[float], y: Sequence[float]) -> TestResult:
    """Spearman rank correlation (Pearson r on ranks)."""
    a, b = np.asarray(x, dtype="float64"), np.asarray(y, dtype="float64")
    mask = np.isfinite(a) & np.isfinite(b)
    a, b = a[mask], b[mask]
    if a.size < 3:
        return TestResult("spearman_correlation", float("nan"), 1.0, n=int(a.size))
    res = pearson_correlation(_rankdata(a), _rankdata(b))
    res.name = "spearman_correlation"
    res.effect_size_name = "rho"
    return res


def mann_whitney_u(a: Sequence[float], b: Sequence[float]) -> TestResult:
    """Mann-Whitney U with a tie-corrected normal approximation."""
    x, y = _clean(a), _clean(b)
    n1, n2 = x.size, y.size
    if n1 == 0 or n2 == 0:
        return TestResult("mann_whitney_u", float("nan"), 1.0)
    combined = np.concatenate([x, y])
    ranks = _rankdata(combined)
    u1 = ranks[:n1].sum() - n1 * (n1 + 1) / 2.0
    mu = n1 * n2 / 2.0
    _, counts = np.unique(combined, return_counts=True)
    tie = float(((counts ** 3 - counts).sum()))
    n = n1 + n2
    sigma_sq = (n1 * n2 / 12.0) * ((n + 1) - tie / (n * (n - 1))) if n > 1 else 0.0
    sigma = math.sqrt(sigma_sq) if sigma_sq > 0 else 0.0
    z = (u1 - mu) / sigma if sigma else 0.0
    p = 2.0 * norm_sf(abs(z)) if sigma else 1.0
    delta = 2.0 * u1 / (n1 * n2) - 1.0
    return TestResult("mann_whitney_u", float(u1), p, float(delta), "cliffs_delta",
                      None, None, int(n), {"z": z})


def one_way_anova(groups: Sequence[Sequence[float]]) -> TestResult:
    """One-way ANOVA with eta-squared - used to rank which dimension explains most variance."""
    cleaned = [_clean(g) for g in groups]
    cleaned = [g for g in cleaned if g.size > 0]
    k = len(cleaned)
    n = int(sum(g.size for g in cleaned))
    if k < 2 or n <= k:
        return TestResult("one_way_anova", float("nan"), 1.0, n=n,
                          detail={"reason": "insufficient groups"})
    grand = float(np.concatenate(cleaned).mean())
    ss_between = float(sum(g.size * (g.mean() - grand) ** 2 for g in cleaned))
    ss_within = float(sum(((g - g.mean()) ** 2).sum() for g in cleaned))
    df_b, df_w = k - 1, n - k
    if ss_within == 0 or df_w <= 0:
        return TestResult("one_way_anova", float("inf"), 0.0, 1.0, "eta_squared",
                          None, float(df_b), n)
    f = (ss_between / df_b) / (ss_within / df_w)
    p = f_sf(f, df_b, df_w)
    eta_sq = ss_between / (ss_between + ss_within)
    return TestResult("one_way_anova", f, p, eta_sq, "eta_squared", None, float(df_b), n,
                      {"df_between": df_b, "df_within": df_w, "groups": k})


# --------------------------------------------------------------------------- #
# Multiple testing & resampling
# --------------------------------------------------------------------------- #
def benjamini_hochberg(p_values: Sequence[float], fdr: float = 0.10) -> list[bool]:
    """Benjamini-Hochberg step-up procedure controlling the false discovery rate.

    The root-cause engine screens dozens of segments at once; without FDR control
    roughly one in twenty pure-noise segments would be reported as a "driver".
    """
    p = np.asarray(list(p_values), dtype="float64")
    m = p.size
    if m == 0:
        return []
    order = np.argsort(p)
    thresholds = fdr * (np.arange(1, m + 1)) / m
    passed = p[order] <= thresholds
    keep = np.zeros(m, dtype=bool)
    if passed.any():
        cutoff = np.max(np.where(passed)[0])
        keep[order[: cutoff + 1]] = True
    return keep.tolist()


def bootstrap_ci(
    values: Sequence[float],
    statistic: str = "mean",
    n_boot: int = 2000,
    alpha: float = 0.05,
    seed: int = 7,
) -> tuple[float, float]:
    """Percentile bootstrap CI - used where distributional assumptions are unsafe."""
    x = _clean(values)
    if x.size < 2:
        return (float("nan"), float("nan"))
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, x.size, size=(n_boot, x.size))
    samples = x[idx]
    stat = samples.mean(axis=1) if statistic == "mean" else np.median(samples, axis=1)
    lo, hi = np.quantile(stat, [alpha / 2.0, 1 - alpha / 2.0])
    return (float(lo), float(hi))
