"""Statistical foundation of InsightOS.

Every published insight is backed by a test statistic, a p-value and an effect
size produced by this package.  Implemented without SciPy so the engine stays
portable and every number remains auditable.
"""

from .distributions import (
    betainc,
    chi2_sf,
    f_sf,
    gammainc_upper,
    norm_cdf,
    norm_ppf,
    norm_sf,
    t_cdf,
    t_sf,
)
from .tests import (
    TestResult,
    benjamini_hochberg,
    bootstrap_ci,
    chi_square_independence,
    cliffs_delta,
    cohens_d,
    mann_whitney_u,
    one_way_anova,
    pearson_correlation,
    poisson_rate_test,
    spearman_correlation,
    two_proportion_z_test,
    welch_t_test,
)
from .timeseries import (
    ChangePoint,
    Decomposition,
    SeasonalityResult,
    TrendResult,
    classical_decompose,
    cusum,
    detect_change_points,
    detect_seasonality,
    mann_kendall,
    rolling_mad_z,
    theil_sen_slope,
)

__all__ = [
    "TestResult",
    "welch_t_test",
    "two_proportion_z_test",
    "poisson_rate_test",
    "mann_whitney_u",
    "chi_square_independence",
    "pearson_correlation",
    "spearman_correlation",
    "one_way_anova",
    "cohens_d",
    "cliffs_delta",
    "benjamini_hochberg",
    "bootstrap_ci",
    "norm_cdf",
    "norm_sf",
    "norm_ppf",
    "t_cdf",
    "t_sf",
    "f_sf",
    "chi2_sf",
    "betainc",
    "gammainc_upper",
    "TrendResult",
    "SeasonalityResult",
    "Decomposition",
    "ChangePoint",
    "mann_kendall",
    "theil_sen_slope",
    "detect_seasonality",
    "classical_decompose",
    "detect_change_points",
    "rolling_mad_z",
    "cusum",
]
