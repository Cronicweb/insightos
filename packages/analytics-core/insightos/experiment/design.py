"""Experiment design: how big does the test need to be, and for how long?

The most expensive mistake in marketing analytics is reading a test that was
never large enough to answer the question.  This module is deliberately the
*first* thing in the package: InsightOS refuses to call a result "flat" unless
the test had the power to detect the effect the business cared about.

Everything here is closed-form and SciPy-free, built on
:mod:`insightos.statistics.distributions`, so every number an analyst quotes in
a design review can be re-derived by hand.

References
----------
* Cohen, J. (1988). *Statistical Power Analysis for the Behavioral Sciences.*
* Kohavi, Tang & Xu (2020). *Trustworthy Online Controlled Experiments*, ch. 17.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Any

from ..statistics.distributions import norm_cdf, norm_ppf

__all__ = [
    "SampleSizePlan",
    "sample_size_for_proportion",
    "sample_size_for_mean",
    "minimum_detectable_effect",
    "power_for_proportion",
    "power_for_mean",
]


@dataclass
class SampleSizePlan:
    """A runnable test design.

    ``per_variant`` is what an analyst actually needs to negotiate for: the
    number of *exposures* each arm requires before the readout is meaningful.
    """

    metric: str
    baseline: float
    target: float
    absolute_effect: float
    relative_effect: float
    per_variant: int
    total: int
    alpha: float
    power: float
    variants: int
    tails: int
    duration_days: float | None = None
    daily_traffic: float | None = None
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def feasible_in(self) -> str:
        """Plain-English duration, or an honest admission that it is unbounded."""
        if self.duration_days is None:
            return "unknown - supply daily_traffic to size the calendar"
        if not math.isfinite(self.duration_days):
            return "never at this traffic level"
        weeks = self.duration_days / 7.0
        if weeks >= 2:
            return f"{weeks:.1f} weeks"
        return f"{self.duration_days:.1f} days"

    def summary(self) -> str:
        return (
            f"To detect a {self.relative_effect:+.1%} move in {self.metric} "
            f"(from {self.baseline:.4g} to {self.target:.4g}) at alpha={self.alpha:.3g} "
            f"with {self.power:.0%} power you need {self.per_variant:,} exposures per "
            f"variant ({self.total:,} total across {self.variants} arms) - "
            f"{self.feasible_in}."
        )


def _z(alpha: float, power: float, tails: int, comparisons: int) -> tuple[float, float]:
    """Critical values, Bonferroni-adjusted when more than one arm is compared.

    Running three treatment arms against one control is three tests, not one;
    spending the full alpha on each is the single most common way teams ship a
    variant that never worked.
    """
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be in (0, 1)")
    if not 0.0 < power < 1.0:
        raise ValueError("power must be in (0, 1)")
    if tails not in (1, 2):
        raise ValueError("tails must be 1 or 2")
    adjusted = alpha / max(comparisons, 1)
    z_alpha = abs(norm_ppf(1.0 - adjusted / tails))
    z_beta = abs(norm_ppf(power))
    return z_alpha, z_beta


def _duration(total: int, daily_traffic: float | None) -> float | None:
    if daily_traffic is None:
        return None
    if daily_traffic <= 0:
        return math.inf
    return total / daily_traffic


def sample_size_for_proportion(
    baseline_rate: float,
    relative_effect: float | None = None,
    absolute_effect: float | None = None,
    alpha: float = 0.05,
    power: float = 0.80,
    variants: int = 2,
    tails: int = 2,
    daily_traffic: float | None = None,
    metric: str = "conversion rate",
) -> SampleSizePlan:
    """Exposures per arm for a conversion-rate (binomial) experiment.

    Uses the unpooled normal approximation

    ``n = (z_a + z_b)^2 * (p1(1-p1) + p2(1-p2)) / (p2 - p1)^2``

    which is the standard planning formula and is accurate whenever
    ``n * p >= 10``.  ``variants`` counts *all* arms including control, so a
    control plus two treatments is ``variants=3`` and costs two comparisons of
    alpha.

    Exactly one of ``relative_effect`` (e.g. ``0.05`` for a 5% lift) or
    ``absolute_effect`` (e.g. ``0.004`` for 40 basis points) must be given.
    """
    if not 0.0 < baseline_rate < 1.0:
        raise ValueError("baseline_rate must be a proportion strictly between 0 and 1")
    if (relative_effect is None) == (absolute_effect is None):
        raise ValueError("supply exactly one of relative_effect or absolute_effect")
    if variants < 2:
        raise ValueError("an experiment needs at least a control and one treatment")

    delta = (
        baseline_rate * relative_effect if absolute_effect is None else float(absolute_effect)
    )
    if delta == 0:
        raise ValueError("effect size must be non-zero")
    target = baseline_rate + delta
    if not 0.0 < target < 1.0:
        raise ValueError(f"the requested effect implies an impossible rate of {target:.4f}")

    z_alpha, z_beta = _z(alpha, power, tails, variants - 1)
    variance = baseline_rate * (1 - baseline_rate) + target * (1 - target)
    per_variant = int(math.ceil((z_alpha + z_beta) ** 2 * variance / (delta**2)))
    total = per_variant * variants
    return SampleSizePlan(
        metric=metric,
        baseline=baseline_rate,
        target=target,
        absolute_effect=delta,
        relative_effect=delta / baseline_rate,
        per_variant=per_variant,
        total=total,
        alpha=alpha,
        power=power,
        variants=variants,
        tails=tails,
        duration_days=_duration(total, daily_traffic),
        daily_traffic=daily_traffic,
        note="normal approximation to the binomial; Bonferroni-adjusted for multiple arms"
        if variants > 2
        else "normal approximation to the binomial",
    )


def sample_size_for_mean(
    baseline_mean: float,
    baseline_sd: float,
    relative_effect: float | None = None,
    absolute_effect: float | None = None,
    alpha: float = 0.05,
    power: float = 0.80,
    variants: int = 2,
    tails: int = 2,
    daily_traffic: float | None = None,
    metric: str = "average value",
) -> SampleSizePlan:
    """Exposures per arm for a continuous metric such as spend per member.

    ``n = 2 * sd^2 * (z_a + z_b)^2 / delta^2``.

    Revenue-style metrics are heavy tailed, so ``baseline_sd`` should be
    measured on the *same* winsorised or capped metric the readout will use -
    otherwise a handful of outliers silently doubles the sample the test needs.
    """
    if baseline_sd <= 0:
        raise ValueError("baseline_sd must be positive")
    if (relative_effect is None) == (absolute_effect is None):
        raise ValueError("supply exactly one of relative_effect or absolute_effect")

    delta = (
        baseline_mean * relative_effect if absolute_effect is None else float(absolute_effect)
    )
    if delta == 0:
        raise ValueError("effect size must be non-zero")

    z_alpha, z_beta = _z(alpha, power, tails, variants - 1)
    per_variant = int(math.ceil(2.0 * (baseline_sd**2) * (z_alpha + z_beta) ** 2 / (delta**2)))
    total = per_variant * variants
    return SampleSizePlan(
        metric=metric,
        baseline=baseline_mean,
        target=baseline_mean + delta,
        absolute_effect=delta,
        relative_effect=delta / baseline_mean if baseline_mean else float("nan"),
        per_variant=per_variant,
        total=total,
        alpha=alpha,
        power=power,
        variants=variants,
        tails=tails,
        duration_days=_duration(total, daily_traffic),
        daily_traffic=daily_traffic,
        note=f"two-sample normal approximation at sd={baseline_sd:.4g}",
    )


def minimum_detectable_effect(
    baseline_rate: float,
    n_per_variant: int,
    alpha: float = 0.05,
    power: float = 0.80,
    variants: int = 2,
    tails: int = 2,
) -> float:
    """The smallest *relative* lift a test of this size could detect.

    This is the number to quote when a stakeholder asks "the test was flat, so
    the idea doesn't work, right?".  If the MDE is 12% and the business case
    needed 3%, the test never had an opinion worth having.

    Solved numerically against :func:`power_for_proportion` so the answer is
    consistent with the readout rather than with a looser closed form.
    """
    if n_per_variant <= 0:
        raise ValueError("n_per_variant must be positive")
    if not 0.0 < baseline_rate < 1.0:
        raise ValueError("baseline_rate must be a proportion strictly between 0 and 1")

    lo, hi = 0.0, (1.0 - baseline_rate) / baseline_rate
    if power_for_proportion(baseline_rate, baseline_rate * (1 + hi), n_per_variant,
                            alpha, variants, tails) < power:
        return float("inf")
    for _ in range(200):
        mid = (lo + hi) / 2.0
        achieved = power_for_proportion(
            baseline_rate, baseline_rate * (1 + mid), n_per_variant, alpha, variants, tails
        )
        if achieved < power:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def power_for_proportion(
    baseline_rate: float,
    treatment_rate: float,
    n_per_variant: int,
    alpha: float = 0.05,
    variants: int = 2,
    tails: int = 2,
) -> float:
    """Probability this design rejects the null, given the effect is real."""
    if n_per_variant <= 0:
        return 0.0
    delta = treatment_rate - baseline_rate
    if delta == 0:
        return alpha / tails
    se = math.sqrt(
        (baseline_rate * (1 - baseline_rate) + treatment_rate * (1 - treatment_rate))
        / n_per_variant
    )
    if se == 0:
        return 1.0
    adjusted = alpha / max(variants - 1, 1)
    z_alpha = abs(norm_ppf(1.0 - adjusted / tails))
    return float(norm_cdf(abs(delta) / se - z_alpha))


def power_for_mean(
    absolute_effect: float,
    baseline_sd: float,
    n_per_variant: int,
    alpha: float = 0.05,
    variants: int = 2,
    tails: int = 2,
) -> float:
    """Power for a continuous metric under the same two-sample assumptions."""
    if n_per_variant <= 0 or baseline_sd <= 0:
        return 0.0
    se = baseline_sd * math.sqrt(2.0 / n_per_variant)
    adjusted = alpha / max(variants - 1, 1)
    z_alpha = abs(norm_ppf(1.0 - adjusted / tails))
    return float(norm_cdf(abs(absolute_effect) / se - z_alpha))
