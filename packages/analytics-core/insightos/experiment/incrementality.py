"""Incrementality: what did the campaign *cause*, not what did it correlate with.

Attribution answers "which touchpoint gets the credit for this sale".
Incrementality answers a harder and more valuable question: "would this sale
have happened anyway".  A campaign can hold 100% of last-click attribution and
still be worth zero, because it was retargeting people who had already decided.

Two designs are supported, in decreasing order of trustworthiness:

1. **Randomised holdout** - a slice of the eligible audience is deliberately
   withheld from the campaign.  The difference in outcome between exposed and
   held-out members is the causal effect, full stop.
2. **Difference-in-differences** - when a holdout was not run, compare the
   before/after change in the treated group against the same change in an
   untreated comparison group.  This removes any trend common to both, but it
   is only valid if the two groups *were* moving in parallel beforehand, which
   :func:`difference_in_differences` reports on rather than assumes.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Any, Sequence

import numpy as np

from ..statistics.distributions import norm_ppf, norm_sf
from ..statistics.tests import TestResult, welch_t_test

__all__ = [
    "IncrementalityResult",
    "holdout_lift",
    "difference_in_differences",
    "incremental_roas",
    "payback_period_days",
]


@dataclass
class IncrementalityResult:
    """A causal effect estimate with its cost consequences attached.

    ``incremental_per_member`` is the estimate; everything else is the business
    translation of it.  ``roi`` and ``iroas`` are ``None`` when no spend was
    supplied, because inventing a denominator is exactly the sort of thing this
    engine exists to refuse to do.
    """

    method: str
    metric: str
    treated_n: int
    control_n: int
    treated_mean: float
    control_mean: float
    incremental_per_member: float
    relative_lift: float
    confidence_interval: tuple[float, float] | None
    p_value: float
    significant: bool
    total_incremental: float
    spend: float | None = None
    iroas: float | None = None
    roi: float | None = None
    cost_per_incremental_action: float | None = None
    warnings: list[str] | None = None
    test: TestResult | None = None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["test"] = self.test.to_dict() if self.test else None
        if self.confidence_interval is not None:
            d["confidence_interval"] = list(self.confidence_interval)
        return d

    def summary(self) -> str:
        verdict = "significant" if self.significant else "not distinguishable from noise"
        base = (
            f"{self.method}: {self.incremental_per_member:+,.2f} incremental {self.metric} "
            f"per member ({self.relative_lift:+.1%} vs control), p={self.p_value:.3g} - "
            f"{verdict}. Total incremental {self.metric}: {self.total_incremental:+,.0f}."
        )
        if self.iroas is not None:
            base += f" iROAS {self.iroas:.2f}x on spend of {self.spend:,.0f}."
        return base


def _clean(x: Sequence[float]) -> np.ndarray:
    arr = np.asarray(x, dtype="float64").ravel()
    return arr[np.isfinite(arr)]


def holdout_lift(
    treated: Sequence[float],
    holdout: Sequence[float],
    spend: float | None = None,
    population: int | None = None,
    metric: str = "value",
    alpha: float = 0.05,
) -> IncrementalityResult:
    """Causal lift from a randomised holdout.

    Parameters
    ----------
    treated, holdout
        Per-member outcomes (spend, margin, transactions) for the exposed and
        withheld groups.  Because assignment was random, the difference in means
        is an unbiased estimate of the campaign's effect.
    spend
        Campaign cost.  Supplied only so the result can be expressed as iROAS
        and ROI; it never influences the statistical test.
    population
        Size of the audience the campaign actually reached, used to scale the
        per-member effect into a total.  Defaults to the treated sample size,
        which is correct when the whole treated population was measured and
        conservative when it was sampled.
    """
    t, c = _clean(treated), _clean(holdout)
    if t.size < 2 or c.size < 2:
        raise ValueError("holdout_lift needs at least two observations in each group")

    test = welch_t_test(t, c, alpha=alpha)
    t_mean, c_mean = float(t.mean()), float(c.mean())
    delta = t_mean - c_mean
    n_reached = int(population if population is not None else t.size)
    total = delta * n_reached

    warnings: list[str] = []
    ratio = t.size / c.size if c.size else float("inf")
    if ratio > 50:
        warnings.append(
            f"The holdout is {ratio:.0f}x smaller than the treated group; the estimate is "
            f"unbiased but its confidence interval is driven almost entirely by holdout "
            f"noise. Widen the holdout if this decision matters."
        )
    if c.size < 100:
        warnings.append(f"Only {c.size} members in the holdout - treat the interval with care.")

    result = IncrementalityResult(
        method="randomised holdout",
        metric=metric,
        treated_n=int(t.size),
        control_n=int(c.size),
        treated_mean=t_mean,
        control_mean=c_mean,
        incremental_per_member=delta,
        relative_lift=delta / c_mean if c_mean else float("nan"),
        confidence_interval=test.confidence_interval,
        p_value=test.p_value,
        significant=test.p_value < alpha,
        total_incremental=total,
        spend=spend,
        warnings=warnings,
        test=test,
    )
    if spend is not None and spend > 0:
        result.iroas = total / spend
        result.roi = (total - spend) / spend
        if delta != 0:
            result.cost_per_incremental_action = spend / (delta * n_reached) if total else None
    return result


def difference_in_differences(
    treated_pre: Sequence[float],
    treated_post: Sequence[float],
    control_pre: Sequence[float],
    control_post: Sequence[float],
    spend: float | None = None,
    population: int | None = None,
    metric: str = "value",
    alpha: float = 0.05,
    parallel_trend_tolerance: float = 0.10,
) -> IncrementalityResult:
    """Difference-in-differences estimate when no randomised holdout exists.

    ``DiD = (post_treated - pre_treated) - (post_control - pre_control)``

    The standard error combines all four group variances, which assumes the four
    samples are independent - true for repeated cross-sections, mildly
    optimistic for a panel of the same members measured twice.

    The identifying assumption is *parallel trends*: absent the campaign, both
    groups would have moved together.  That cannot be proven from two periods,
    but a gross level mismatch between the groups before treatment is a strong
    hint it is false, so the pre-period gap is checked and reported as a warning
    when it exceeds ``parallel_trend_tolerance`` of the control's pre-period
    level.
    """
    tp, tq = _clean(treated_pre), _clean(treated_post)
    cp, cq = _clean(control_pre), _clean(control_post)
    for arr, label in ((tp, "treated_pre"), (tq, "treated_post"),
                       (cp, "control_pre"), (cq, "control_post")):
        if arr.size < 2:
            raise ValueError(f"{label} needs at least two observations")

    means = [float(a.mean()) for a in (tp, tq, cp, cq)]
    did = (means[1] - means[0]) - (means[3] - means[2])
    se = math.sqrt(sum(float(a.var(ddof=1)) / a.size for a in (tp, tq, cp, cq)))
    z = did / se if se > 0 else 0.0
    p = 2.0 * norm_sf(abs(z)) if se > 0 else 1.0
    crit = abs(norm_ppf(alpha / 2.0))
    ci = (did - crit * se, did + crit * se) if se > 0 else None

    warnings: list[str] = []
    if means[2] != 0:
        gap = abs(means[0] - means[2]) / abs(means[2])
        if gap > parallel_trend_tolerance:
            warnings.append(
                f"The treated and comparison groups differed by {gap:.0%} before the campaign "
                f"started, well above the {parallel_trend_tolerance:.0%} tolerance. The "
                f"parallel-trends assumption behind this estimate is questionable; prefer a "
                f"randomised holdout, or match the comparison group first."
            )
    warnings.append(
        "Difference-in-differences is quasi-experimental: it removes shocks common to both "
        "groups but cannot remove anything that hit only the treated group at the same time "
        "as the campaign."
    )

    n_reached = int(population if population is not None else tq.size)
    total = did * n_reached
    result = IncrementalityResult(
        method="difference-in-differences",
        metric=metric,
        treated_n=int(tq.size),
        control_n=int(cq.size),
        treated_mean=means[1],
        control_mean=means[3],
        incremental_per_member=did,
        relative_lift=did / means[2] if means[2] else float("nan"),
        confidence_interval=ci,
        p_value=p,
        significant=p < alpha,
        total_incremental=total,
        spend=spend,
        warnings=warnings,
        test=TestResult(
            "difference_in_differences",
            z,
            p,
            did,
            "absolute_difference",
            ci,
            None,
            int(tp.size + tq.size + cp.size + cq.size),
            {
                "treated_pre": means[0],
                "treated_post": means[1],
                "control_pre": means[2],
                "control_post": means[3],
                "treated_change": means[1] - means[0],
                "control_change": means[3] - means[2],
                "standard_error": se,
            },
        ),
    )
    if spend is not None and spend > 0:
        result.iroas = total / spend
        result.roi = (total - spend) / spend
    return result


def incremental_roas(incremental_value: float, spend: float) -> float:
    """Incremental return on ad spend.

    Deliberately separate from last-click ROAS: the numerator must be a *causal*
    estimate from a holdout or DiD design, not attributed revenue.  A campaign
    routinely shows 6x attributed ROAS and 0.8x iROAS, and only one of those two
    numbers should be allowed near a budget decision.
    """
    if spend <= 0:
        raise ValueError("spend must be positive to compute iROAS")
    return incremental_value / spend


def payback_period_days(spend: float, incremental_value_per_day: float) -> float:
    """Days of incremental margin needed to recover the campaign cost."""
    if incremental_value_per_day <= 0:
        return float("inf")
    return spend / incremental_value_per_day
