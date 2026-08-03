"""Customer lifetime value, computed from observed behaviour rather than assumed.

Two numbers are produced and they are deliberately kept apart:

* **Historic CLV** - margin a customer has already generated.  A fact.
* **Predicted CLV** - margin they are expected to generate from here, given the
  retention curve their cohort is actually on.  A model, and labelled as one.

The prediction uses the standard discounted-margin identity

``CLV = AOV x purchases_per_period x margin_rate x r / (1 + d - r)``

where ``r`` is the per-period retention rate and ``d`` the per-period discount
rate.  It is a geometric series, not a black box: the same arithmetic a finance
partner would do on a napkin, which is exactly why it survives review.

Where a fitted probabilistic model would normally go (BG/NBD, Pareto/NBD) this
module ships the closed-form *probability alive* heuristic instead and says so.
An unfitted heuristic that a reviewer can check beats a fitted model nobody in
the room can interrogate.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from .cohort import cohort_retention

__all__ = [
    "CLVResult",
    "predicted_clv",
    "probability_alive",
    "expected_remaining_lifetime",
    "value_concentration",
    "gini",
    "customer_lifetime_value",
]


@dataclass
class CLVResult:
    """Everything needed to defend a lifetime-value number in a review."""

    period: str
    customers: int
    average_order_value: float
    purchases_per_period: float
    margin_rate: float
    retention_rate: float
    discount_rate: float
    predicted_clv: float
    expected_lifetime_periods: float
    historic_clv_mean: float
    historic_clv_median: float
    top_decile_value_share: float
    gini: float
    horizon_periods: int | None = None
    by_segment: list[dict[str, Any]] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def narrative(self) -> str:
        parts = [
            f"Predicted lifetime value is {self.predicted_clv:,.2f} per customer: "
            f"{self.average_order_value:,.2f} average order value x "
            f"{self.purchases_per_period:.2f} purchases per {self.period} x "
            f"{self.margin_rate:.0%} margin, retained at {self.retention_rate:.1%} per "
            f"{self.period} and discounted at {self.discount_rate:.1%}.",
            f"That implies an expected relationship of "
            f"{self.expected_lifetime_periods:.1f} {self.period}s.",
            f"Realised value to date averages {self.historic_clv_mean:,.2f} "
            f"(median {self.historic_clv_median:,.2f}); the gap between mean and median is "
            f"the concentration this business runs on.",
            f"The top 10% of customers hold {self.top_decile_value_share:.1%} of all value "
            f"(Gini {self.gini:.2f}).",
        ]
        if self.by_segment:
            best = max(self.by_segment, key=lambda s: s["predicted_clv"])
            worst = min(self.by_segment, key=lambda s: s["predicted_clv"])
            if best["segment"] != worst["segment"]:
                ratio = (
                    best["predicted_clv"] / worst["predicted_clv"]
                    if worst["predicted_clv"] > 0
                    else float("inf")
                )
                parts.append(
                    f"{best['segment']} is worth {ratio:.1f}x {worst['segment']} over a "
                    f"lifetime, which is the ratio acquisition bids should respect."
                )
        return " ".join(parts)


def predicted_clv(
    average_order_value: float,
    purchases_per_period: float,
    margin_rate: float,
    retention_rate: float,
    discount_rate: float = 0.01,
    horizon_periods: int | None = None,
) -> float:
    """Discounted expected margin from a customer, per the geometric identity.

    With ``horizon_periods=None`` the series runs to infinity and collapses to
    ``m * r / (1 + d - r)``.  With a finite horizon the sum is truncated, which
    is what a finance partner will ask for whenever the retention estimate comes
    from fewer periods of history than the horizon implies.

    ``retention_rate`` must be below ``1 + discount_rate`` or the series
    diverges - a customer who never churns is worth infinity, which is true and
    useless.
    """
    if not 0.0 <= retention_rate < 1.0:
        raise ValueError("retention_rate must be in [0, 1)")
    if discount_rate < 0:
        raise ValueError("discount_rate cannot be negative")

    margin_per_period = average_order_value * purchases_per_period * margin_rate
    r, d = retention_rate, discount_rate
    if horizon_periods is None:
        return float(margin_per_period * r / (1.0 + d - r))
    total = 0.0
    for k in range(1, int(horizon_periods) + 1):
        total += margin_per_period * (r**k) / ((1.0 + d) ** k)
    return float(total)


def expected_remaining_lifetime(retention_rate: float) -> float:
    """Expected number of further periods before churn, ``1 / (1 - r)``."""
    if not 0.0 <= retention_rate < 1.0:
        return float("inf")
    return 1.0 / (1.0 - retention_rate)


def probability_alive(
    frequency: int,
    recency_periods: float,
    observation_periods: float,
) -> float:
    """Heuristic probability a customer is still active (BG/NBD-style).

    ``P(alive) ~ (t_x / T)^x`` where ``x`` is the number of *repeat* purchases,
    ``t_x`` the age at the last one and ``T`` the total observed age.

    The intuition is the whole value of it: someone who bought ten times and
    whose last purchase was at 95% of their observed life is almost certainly
    still around, while someone who bought ten times and stopped at the 20% mark
    almost certainly is not.  A single-purchase customer carries almost no
    information either way, and the formula reflects that by staying near 1.

    This is the closed-form approximation, not a fitted BG/NBD. It is monotone
    and directionally right, which is enough to rank a base for outreach; it is
    not calibrated, so it must not be multiplied into a revenue forecast.
    """
    if observation_periods <= 0:
        return 1.0
    repeats = max(int(frequency) - 1, 0)
    if repeats == 0:
        return 1.0
    ratio = min(max(recency_periods / observation_periods, 0.0), 1.0)
    return float(ratio**repeats)


def gini(values: np.ndarray | pd.Series) -> float:
    """Gini coefficient of value concentration, 0 = perfectly even, 1 = one customer.

    Reported alongside CLV because the average is close to meaningless when the
    distribution is this skewed: a book with a Gini of 0.7 needs a retention
    strategy aimed at a few thousand people, not a mass campaign.
    """
    x = np.asarray(values, dtype="float64").ravel()
    x = x[np.isfinite(x)]
    x = x[x >= 0]
    if x.size == 0 or x.sum() == 0:
        return 0.0
    x = np.sort(x)
    n = x.size
    index = np.arange(1, n + 1)
    return float((2.0 * (index * x).sum()) / (n * x.sum()) - (n + 1.0) / n)


def value_concentration(values: np.ndarray | pd.Series, decile: float = 0.10) -> float:
    """Share of total value held by the top ``decile`` of customers."""
    x = np.asarray(values, dtype="float64").ravel()
    x = x[np.isfinite(x)]
    total = x.sum()
    if x.size == 0 or total <= 0:
        return 0.0
    k = max(int(math.ceil(x.size * decile)), 1)
    top = np.sort(x)[-k:]
    return float(top.sum() / total)


def customer_lifetime_value(
    frame: pd.DataFrame,
    customer_col: str,
    date_col: str,
    value_col: str,
    margin_rate: float = 0.30,
    discount_rate: float = 0.01,
    freq: str = "M",
    segment_col: str | None = None,
    horizon_periods: int | None = None,
    retention_rate: float | None = None,
) -> CLVResult:
    """End-to-end CLV from a transaction log.

    Every input to the formula is measured from the data rather than assumed,
    with two deliberate exceptions that are recorded in ``assumptions``:
    ``margin_rate``, which is never in a transaction table, and
    ``discount_rate``, which is a finance policy choice.

    ``retention_rate`` is derived from the cohort curve when not supplied. If
    the history is too short to see a second period the function falls back to
    the observed repeat-purchase rate and says so, rather than silently
    inventing a number.
    """
    for col in (customer_col, date_col, value_col):
        if col not in frame.columns:
            raise KeyError(f"column {col!r} is not in the frame")
    if not 0.0 < margin_rate <= 1.0:
        raise ValueError("margin_rate must be in (0, 1]")

    df = frame.copy()
    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    df[value_col] = pd.to_numeric(df[value_col], errors="coerce")
    df = df.dropna(subset=[customer_col, date_col, value_col])
    if df.empty:
        raise ValueError("no usable rows: check the customer, date and value columns")

    assumptions = [
        f"Margin rate of {margin_rate:.0%} is an input, not a measurement - transaction "
        f"tables do not carry cost of goods.",
        f"Discount rate of {discount_rate:.1%} per {freq.upper()} reflects the cost of "
        f"capital and is a finance policy choice.",
    ]

    per_customer = df.groupby(customer_col).agg(
        orders=(value_col, "count"),
        revenue=(value_col, "sum"),
        first_seen=(date_col, "min"),
        last_seen=(date_col, "max"),
    )
    aov = float(df[value_col].sum() / len(df))

    cohorts = cohort_retention(df, customer_col, date_col, freq=freq)
    span = _period_span(df[date_col], freq)
    purchases_per_period = float(len(df) / max(len(per_customer) * max(span, 1.0), 1.0))

    if retention_rate is not None:
        r = float(retention_rate)
        assumptions.append("Retention rate was supplied by the caller.")
    elif np.isfinite(cohorts.steady_state_retention):
        r = float(cohorts.steady_state_retention)
        assumptions.append(
            f"Retention of {r:.1%} per {freq.upper()} is the median period-over-period "
            f"survival of the observed cohort curve, over {cohorts.periods_observed} periods."
        )
    else:
        repeat = float((per_customer["orders"] > 1).mean())
        r = min(max(repeat, 0.0), 0.95)
        assumptions.append(
            f"History is too short for a cohort curve, so retention falls back to the "
            f"observed repeat-purchase rate of {r:.1%}. Treat the CLV as a lower bound "
            f"and recompute once a second period of data exists."
        )

    r = min(max(r, 0.0), 0.99)
    clv = predicted_clv(aov, purchases_per_period, margin_rate, r, discount_rate,
                        horizon_periods)
    historic = per_customer["revenue"] * margin_rate

    by_segment: list[dict[str, Any]] = []
    if segment_col and segment_col in df.columns:
        owner = df.groupby(customer_col)[segment_col].first()
        for segment, members in owner.groupby(owner):
            idx = members.index
            chunk = df[df[customer_col].isin(idx)]
            if chunk.empty:
                continue
            seg_aov = float(chunk[value_col].sum() / len(chunk))
            seg_freq = float(len(chunk) / max(len(idx) * max(span, 1.0), 1.0))
            by_segment.append(
                {
                    "segment": str(segment),
                    "customers": int(len(idx)),
                    "average_order_value": seg_aov,
                    "purchases_per_period": seg_freq,
                    "predicted_clv": predicted_clv(
                        seg_aov, seg_freq, margin_rate, r, discount_rate, horizon_periods
                    ),
                    "historic_clv_mean": float(
                        per_customer.loc[idx, "revenue"].mean() * margin_rate
                    ),
                }
            )
        by_segment.sort(key=lambda s: s["predicted_clv"], reverse=True)

    return CLVResult(
        period=cohorts.period_name,
        customers=int(len(per_customer)),
        average_order_value=aov,
        purchases_per_period=purchases_per_period,
        margin_rate=margin_rate,
        retention_rate=r,
        discount_rate=discount_rate,
        predicted_clv=clv,
        expected_lifetime_periods=expected_remaining_lifetime(r),
        historic_clv_mean=float(historic.mean()),
        historic_clv_median=float(historic.median()),
        top_decile_value_share=value_concentration(historic),
        gini=gini(historic),
        horizon_periods=horizon_periods,
        by_segment=by_segment,
        assumptions=assumptions,
    )


def _period_span(dates: pd.Series, freq: str) -> float:
    """How many periods of history the dataset covers, as a float."""
    lo, hi = dates.min(), dates.max()
    days = max((hi - lo).days, 0) + 1
    divisor = {"D": 1.0, "W": 7.0, "M": 30.4375, "Q": 91.3125, "Y": 365.25}
    return days / divisor.get(freq.upper(), 30.4375)
