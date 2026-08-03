"""Controlled experiments and campaign incrementality.

Marketing analytics lives or dies on one distinction: *correlation with a
campaign* versus *effect of a campaign*.  Every other module in InsightOS
observes what happened; this one is the only one licensed to say what caused it,
and only because the data came from a design that supports the claim.

The package is ordered the way a competent test is run:

* :mod:`~insightos.experiment.design`         - size it before you run it
* :mod:`~insightos.experiment.analysis`       - check the split, then read it out
* :mod:`~insightos.experiment.incrementality` - convert lift into money

Nothing here is domain specific: a card-acquisition offer test, a landing page
test and a retention email test all read out with the same code.
"""

from .analysis import (
    CupedResult,
    ExperimentReadout,
    VariantReadout,
    analyse_conversion_experiment,
    analyse_value_experiment,
    cuped_adjust,
    sample_ratio_mismatch,
    sequential_alpha,
)
from .design import (
    SampleSizePlan,
    minimum_detectable_effect,
    power_for_mean,
    power_for_proportion,
    sample_size_for_mean,
    sample_size_for_proportion,
)
from .incrementality import (
    IncrementalityResult,
    difference_in_differences,
    holdout_lift,
    incremental_roas,
    payback_period_days,
)

__all__ = [
    "SampleSizePlan",
    "sample_size_for_proportion",
    "sample_size_for_mean",
    "minimum_detectable_effect",
    "power_for_proportion",
    "power_for_mean",
    "VariantReadout",
    "ExperimentReadout",
    "CupedResult",
    "sample_ratio_mismatch",
    "cuped_adjust",
    "sequential_alpha",
    "analyse_conversion_experiment",
    "analyse_value_experiment",
    "IncrementalityResult",
    "holdout_lift",
    "difference_in_differences",
    "incremental_roas",
    "payback_period_days",
]
