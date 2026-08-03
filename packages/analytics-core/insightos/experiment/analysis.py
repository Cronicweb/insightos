"""Experiment readout: is the difference real, and is the test itself trustworthy?

The order of operations here is the point.  Before any lift is reported the
readout checks that the randomisation actually worked (sample ratio mismatch);
before any winner is declared across three arms it controls the false discovery
rate; and if the test is being peeked at mid-flight it widens the bar rather
than pretending a fixed-horizon p-value is still valid.

A "significant" result from a broken assignment is worse than no result, because
somebody will act on it.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any, Mapping, Sequence

import numpy as np

from ..statistics.distributions import chi2_sf, norm_cdf, norm_ppf
from ..statistics.tests import (
    TestResult,
    benjamini_hochberg,
    two_proportion_z_test,
    welch_t_test,
)

__all__ = [
    "VariantReadout",
    "ExperimentReadout",
    "CupedResult",
    "sample_ratio_mismatch",
    "cuped_adjust",
    "sequential_alpha",
    "analyse_conversion_experiment",
    "analyse_value_experiment",
]

# A winner is only called when the effect clears this share of the pre-agreed
# minimum detectable effect; statistical significance alone is not a decision.
_PRACTICAL_FLOOR = 0.0


@dataclass
class VariantReadout:
    """One arm of the experiment, plus its comparison against control."""

    name: str
    exposures: int
    metric: float
    is_control: bool = False
    successes: int | None = None
    absolute_lift: float | None = None
    relative_lift: float | None = None
    confidence_interval: tuple[float, float] | None = None
    p_value: float | None = None
    significant: bool = False
    test: TestResult | None = None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["test"] = self.test.to_dict() if self.test else None
        if self.confidence_interval is not None:
            d["confidence_interval"] = list(self.confidence_interval)
        return d


@dataclass
class ExperimentReadout:
    """The full verdict, including the reasons it might not be usable."""

    name: str
    metric: str
    control: str
    variants: list[VariantReadout] = field(default_factory=list)
    srm: TestResult | None = None
    valid: bool = True
    decision: str = "inconclusive"
    winner: str | None = None
    alpha: float = 0.05
    effective_alpha: float = 0.05
    information_fraction: float = 1.0
    warnings: list[str] = field(default_factory=list)
    narrative: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "metric": self.metric,
            "control": self.control,
            "variants": [v.to_dict() for v in self.variants],
            "srm": self.srm.to_dict() if self.srm else None,
            "valid": self.valid,
            "decision": self.decision,
            "winner": self.winner,
            "alpha": self.alpha,
            "effective_alpha": self.effective_alpha,
            "information_fraction": self.information_fraction,
            "warnings": list(self.warnings),
            "narrative": self.narrative,
        }


@dataclass
class CupedResult:
    """Variance-reduced metric values plus the honest accounting of the gain."""

    values: np.ndarray
    theta: float
    variance_before: float
    variance_after: float
    variance_reduction: float
    correlation: float

    @property
    def effective_sample_multiplier(self) -> float:
        """How much bigger an unadjusted test would have to be to match this one."""
        if self.variance_after <= 0:
            return float("inf")
        return self.variance_before / self.variance_after

    def to_dict(self) -> dict[str, Any]:
        return {
            "theta": self.theta,
            "variance_before": self.variance_before,
            "variance_after": self.variance_after,
            "variance_reduction": self.variance_reduction,
            "correlation": self.correlation,
            "effective_sample_multiplier": self.effective_sample_multiplier,
        }


# --------------------------------------------------------------------------- #
# Trust checks
# --------------------------------------------------------------------------- #
def sample_ratio_mismatch(
    counts: Mapping[str, int],
    expected_ratio: Mapping[str, float] | None = None,
    alpha: float = 0.001,
) -> TestResult:
    """Chi-square goodness-of-fit test on the assignment split.

    A 50/50 test that lands at 50.4/49.6 on ten million users is not rounding -
    it is a bug in bucketing, a bot filter that fires asymmetrically, or a
    redirect that drops traffic on one arm.  Industry practice is to test this
    at a strict alpha (0.001 by default): the cost of a false alarm is one
    afternoon, the cost of a miss is a wrong decision shipped to production.
    """
    names = list(counts.keys())
    observed = np.asarray([float(counts[k]) for k in names], dtype="float64")
    total = float(observed.sum())
    if total <= 0 or observed.size < 2:
        return TestResult("sample_ratio_mismatch", float("nan"), 1.0,
                          detail={"reason": "not enough arms to test"})

    if expected_ratio is None:
        weights = np.full(observed.size, 1.0 / observed.size)
    else:
        raw = np.asarray([float(expected_ratio.get(k, 0.0)) for k in names], dtype="float64")
        if raw.sum() <= 0:
            raise ValueError("expected_ratio must contain at least one positive weight")
        weights = raw / raw.sum()

    expected = weights * total
    with np.errstate(divide="ignore", invalid="ignore"):
        terms = np.where(expected > 0, (observed - expected) ** 2 / expected, 0.0)
    stat = float(terms.sum())
    df = observed.size - 1
    p = chi2_sf(stat, df)
    return TestResult(
        "sample_ratio_mismatch",
        stat,
        p,
        None,
        None,
        None,
        float(df),
        int(total),
        {
            "observed": {k: int(counts[k]) for k in names},
            "expected": {k: float(e) for k, e in zip(names, expected)},
            "alpha": alpha,
            "mismatch": p < alpha,
        },
    )


def sequential_alpha(alpha: float, information_fraction: float) -> float:
    """O'Brien-Fleming alpha spending for a mid-flight look (Lan-DeMets).

    Checking a running test every morning and stopping the first time ``p <
    0.05`` inflates the real false-positive rate to roughly 25-30%.  This
    returns the *nominal* alpha that keeps the overall type-I error at
    ``alpha`` given that only ``information_fraction`` of the planned sample has
    arrived: early looks face a punishing bar that relaxes to ``alpha`` exactly
    at the planned end of the test.
    """
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be in (0, 1)")
    t = float(information_fraction)
    if t <= 0:
        return 0.0
    if t >= 1.0:
        return alpha
    z = abs(norm_ppf(1.0 - alpha / 2.0))
    return float(2.0 * (1.0 - norm_cdf(z / math.sqrt(t))))


def cuped_adjust(values: Sequence[float], covariate: Sequence[float]) -> CupedResult:
    """CUPED: strip pre-experiment variance out of the metric (Deng et al., 2013).

    ``y_adj = y - theta * (x - mean(x))`` where ``theta = cov(y, x) / var(x)``.

    The adjusted metric has the same expectation as the original - the treatment
    effect is untouched - but a smaller variance whenever the covariate (usually
    the same member's spend in the four weeks *before* the test) predicts the
    outcome.  A correlation of 0.6 removes ~36% of the variance, which is the
    same as running the test 1.6x longer for free.

    The covariate must be measured strictly before assignment; anything
    post-assignment is contaminated by the treatment and will bias the result.
    """
    y = np.asarray(values, dtype="float64").ravel()
    x = np.asarray(covariate, dtype="float64").ravel()
    if y.size != x.size:
        raise ValueError("values and covariate must be the same length")
    mask = np.isfinite(y) & np.isfinite(x)
    y, x = y[mask], x[mask]
    if y.size < 3 or float(x.var()) == 0.0:
        var = float(y.var(ddof=1)) if y.size > 1 else 0.0
        return CupedResult(y, 0.0, var, var, 0.0, 0.0)

    theta = float(np.cov(y, x, ddof=1)[0, 1] / x.var(ddof=1))
    adjusted = y - theta * (x - x.mean())
    var_before = float(y.var(ddof=1))
    var_after = float(adjusted.var(ddof=1))
    reduction = 1.0 - var_after / var_before if var_before > 0 else 0.0
    corr = float(np.corrcoef(y, x)[0, 1]) if y.std() > 0 else 0.0
    return CupedResult(adjusted, theta, var_before, var_after, reduction, corr)


# --------------------------------------------------------------------------- #
# Readouts
# --------------------------------------------------------------------------- #
def _finalise(
    readout: ExperimentReadout,
    tested: list[VariantReadout],
    fdr: float,
) -> ExperimentReadout:
    """Apply FDR control across arms, pick a winner and write the narrative."""
    if len(tested) > 1:
        keep = benjamini_hochberg([v.p_value or 1.0 for v in tested], fdr=fdr)
        for variant, survives in zip(tested, keep):
            variant.significant = bool(variant.significant and survives)
        readout.warnings.append(
            f"{len(tested)} treatment arms compared; Benjamini-Hochberg FDR control at "
            f"{fdr:.0%} applied so roughly one arm in twenty is not reported as a winner "
            f"by chance alone"
        )

    winners = [
        v for v in tested if v.significant and (v.absolute_lift or 0.0) > _PRACTICAL_FLOOR
    ]
    losers = [v for v in tested if v.significant and (v.absolute_lift or 0.0) < 0]

    if not readout.valid:
        readout.decision = "invalid"
    elif winners:
        best = max(winners, key=lambda v: v.absolute_lift or 0.0)
        readout.winner = best.name
        readout.decision = "ship"
    elif losers:
        readout.decision = "do not ship"
    elif readout.information_fraction < 1.0:
        readout.decision = "keep running"
    else:
        readout.decision = "no difference detected"

    readout.narrative = _narrate(readout, tested)
    return readout


def _narrate(readout: ExperimentReadout, tested: Sequence[VariantReadout]) -> str:
    if not readout.valid:
        p = f"p={readout.srm.p_value:.2g}" if readout.srm else "no test available"
        return (
            f"{readout.name} cannot be read out: the traffic split failed its sample ratio "
            f"check ({p}), which means assignment - not the treatment - differs between "
            f"arms. Fix the bucketing and rerun; do not interpret the lift."
        )

    parts: list[str] = []
    for v in tested:
        direction = "lifted" if (v.absolute_lift or 0) > 0 else "reduced"
        verdict = "significant" if v.significant else "not significant"
        ci = (
            f" (95% CI {v.confidence_interval[0]:+.4g} to {v.confidence_interval[1]:+.4g})"
            if v.confidence_interval
            else ""
        )
        parts.append(
            f"{v.name} {direction} {readout.metric} by {abs(v.relative_lift or 0):.1%}{ci}, "
            f"p={v.p_value:.3g} - {verdict}"
        )
    body = "; ".join(parts) if parts else "no treatment arms were supplied"

    if readout.decision == "ship":
        tail = f"Recommended action: ship {readout.winner}."
    elif readout.decision == "do not ship":
        tail = "Recommended action: do not ship - the treatment is significantly worse."
    elif readout.decision == "keep running":
        tail = (
            f"Recommended action: keep running - only {readout.information_fraction:.0%} of "
            f"the planned sample has arrived, so the bar is alpha={readout.effective_alpha:.4g}, "
            f"not {readout.alpha:.4g}."
        )
    else:
        tail = (
            "Recommended action: no change. Note that 'no difference detected' is not "
            "'no difference' - check the design's minimum detectable effect before "
            "concluding the idea does not work."
        )
    return f"{body}. {tail}"


def analyse_conversion_experiment(
    arms: Mapping[str, tuple[int, int]],
    control: str,
    name: str = "experiment",
    metric: str = "conversion rate",
    alpha: float = 0.05,
    fdr: float = 0.10,
    expected_ratio: Mapping[str, float] | None = None,
    information_fraction: float = 1.0,
) -> ExperimentReadout:
    """Read out a conversion test.

    Parameters
    ----------
    arms
        ``{arm_name: (successes, exposures)}`` - e.g.
        ``{"control": (1_204, 42_000), "offer_a": (1_331, 41_890)}``.
    control
        Which key is the control arm.
    information_fraction
        Share of the *planned* sample collected so far.  Anything below 1.0
        triggers O'Brien-Fleming alpha spending instead of a fixed-horizon test.
    """
    if control not in arms:
        raise ValueError(f"control arm {control!r} is not present in arms")

    effective_alpha = sequential_alpha(alpha, information_fraction)
    readout = ExperimentReadout(
        name=name,
        metric=metric,
        control=control,
        alpha=alpha,
        effective_alpha=effective_alpha,
        information_fraction=float(information_fraction),
    )

    srm = sample_ratio_mismatch({k: int(v[1]) for k, v in arms.items()}, expected_ratio)
    readout.srm = srm
    if bool(srm.detail.get("mismatch")):
        readout.valid = False
        readout.warnings.append(
            "Sample ratio mismatch: the arms did not receive the traffic split they were "
            "configured for, so any measured difference may be an assignment artefact."
        )

    c_success, c_n = int(arms[control][0]), int(arms[control][1])
    c_rate = c_success / c_n if c_n else float("nan")
    readout.variants.append(
        VariantReadout(control, c_n, c_rate, is_control=True, successes=c_success)
    )

    tested: list[VariantReadout] = []
    for arm, (success, n) in arms.items():
        if arm == control:
            continue
        test = two_proportion_z_test(int(success), int(n), c_success, c_n, alpha=alpha)
        rate = success / n if n else float("nan")
        variant = VariantReadout(
            name=arm,
            exposures=int(n),
            metric=rate,
            successes=int(success),
            absolute_lift=rate - c_rate,
            relative_lift=(rate - c_rate) / c_rate if c_rate else float("nan"),
            confidence_interval=test.confidence_interval,
            p_value=test.p_value,
            significant=test.p_value < effective_alpha,
            test=test,
        )
        readout.variants.append(variant)
        tested.append(variant)

    return _finalise(readout, tested, fdr)


def analyse_value_experiment(
    arms: Mapping[str, Sequence[float]],
    control: str,
    name: str = "experiment",
    metric: str = "value per member",
    alpha: float = 0.05,
    fdr: float = 0.10,
    covariates: Mapping[str, Sequence[float]] | None = None,
    information_fraction: float = 1.0,
) -> ExperimentReadout:
    """Read out a continuous-metric test (spend, margin, sessions) with Welch's t.

    Pass ``covariates`` - the same members' pre-period values, keyed by arm - to
    apply CUPED before testing.  The variance reduction achieved is recorded in
    ``warnings`` so the readout never hides the fact that it was applied.
    """
    if control not in arms:
        raise ValueError(f"control arm {control!r} is not present in arms")

    effective_alpha = sequential_alpha(alpha, information_fraction)
    readout = ExperimentReadout(
        name=name,
        metric=metric,
        control=control,
        alpha=alpha,
        effective_alpha=effective_alpha,
        information_fraction=float(information_fraction),
    )

    series: dict[str, np.ndarray] = {}
    for arm, values in arms.items():
        arr = np.asarray(values, dtype="float64").ravel()
        arr = arr[np.isfinite(arr)]
        if covariates and arm in covariates:
            adjusted = cuped_adjust(values, covariates[arm])
            arr = adjusted.values
            if adjusted.variance_reduction > 0.01:
                readout.warnings.append(
                    f"CUPED applied to {arm}: {adjusted.variance_reduction:.1%} of the "
                    f"variance removed using a pre-period covariate "
                    f"(r={adjusted.correlation:.2f}), worth "
                    f"{adjusted.effective_sample_multiplier:.2f}x the sample size."
                )
        series[arm] = arr

    srm = sample_ratio_mismatch({k: int(v.size) for k, v in series.items()})
    readout.srm = srm
    if bool(srm.detail.get("mismatch")):
        readout.valid = False
        readout.warnings.append(
            "Sample ratio mismatch: arm sizes are inconsistent with an even split."
        )

    c = series[control]
    c_mean = float(c.mean()) if c.size else float("nan")
    readout.variants.append(VariantReadout(control, int(c.size), c_mean, is_control=True))

    tested: list[VariantReadout] = []
    for arm, arr in series.items():
        if arm == control:
            continue
        test = welch_t_test(arr, c, alpha=alpha)
        mean = float(arr.mean()) if arr.size else float("nan")
        variant = VariantReadout(
            name=arm,
            exposures=int(arr.size),
            metric=mean,
            absolute_lift=mean - c_mean,
            relative_lift=(mean - c_mean) / c_mean if c_mean else float("nan"),
            confidence_interval=test.confidence_interval,
            p_value=test.p_value,
            significant=test.p_value < effective_alpha,
            test=test,
        )
        readout.variants.append(variant)
        tested.append(variant)

    return _finalise(readout, tested, fdr)
