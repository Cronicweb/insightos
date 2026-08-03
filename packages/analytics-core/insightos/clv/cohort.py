"""Acquisition cohorts and the retention curve they trace out.

A single "retention rate" is almost always a mix of two different things: how
many customers come back at all, and how long the ones who do keep coming.  A
cohort matrix separates them, and it is the only honest way to tell whether the
base is improving or whether last quarter's acquisition push is simply still
young.

Period arithmetic here is written out explicitly rather than delegated to
``PeriodIndex``.  It costs a dozen lines and buys two things: the bucket
boundaries are inspectable, and the module keeps working across pandas releases
that reshuffle period internals.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

__all__ = [
    "CohortRetention",
    "cohort_retention",
    "retention_curve",
]

_FREQ_LABEL = {"D": "day", "W": "week", "M": "month", "Q": "quarter", "Y": "year"}


def _bucket(dates: pd.Series, freq: str) -> tuple[pd.Series, pd.Series]:
    """Return (bucket_start_timestamp, integer_period_ordinal) for each date.

    The ordinal is what makes ``period_2 - period_1`` a meaningful number of
    periods; the timestamp is what a human reads on the cohort axis.
    """
    f = freq.upper()
    if f not in _FREQ_LABEL:
        raise ValueError(f"freq must be one of {sorted(_FREQ_LABEL)}, got {freq!r}")

    d = dates.dt.normalize()
    if f == "D":
        start = d
        ordinal = (d - pd.Timestamp("1970-01-01")).dt.days
    elif f == "W":
        start = d - pd.to_timedelta(d.dt.weekday, unit="D")
        ordinal = (start - pd.Timestamp("1970-01-05")).dt.days // 7  # first Monday of 1970
    elif f == "M":
        start = d - pd.to_timedelta(d.dt.day - 1, unit="D")
        ordinal = d.dt.year * 12 + (d.dt.month - 1)
    elif f == "Q":
        q_month = ((d.dt.month - 1) // 3) * 3 + 1
        start = pd.to_datetime(
            {"year": d.dt.year, "month": q_month, "day": np.ones(len(d), dtype="int64")}
        )
        start.index = d.index
        ordinal = d.dt.year * 4 + (d.dt.month - 1) // 3
    else:  # "Y"
        start = pd.to_datetime(
            {
                "year": d.dt.year,
                "month": np.ones(len(d), dtype="int64"),
                "day": np.ones(len(d), dtype="int64"),
            }
        )
        start.index = d.index
        ordinal = d.dt.year
    return start, ordinal.astype("int64")


@dataclass
class CohortRetention:
    """The cohort matrix plus the two retention numbers CLV actually needs."""

    freq: str
    matrix: pd.DataFrame
    sizes: pd.Series
    curve: list[float] = field(default_factory=list)
    initial_retention: float = float("nan")
    steady_state_retention: float = float("nan")
    periods_observed: int = 0

    @property
    def period_name(self) -> str:
        return _FREQ_LABEL.get(self.freq.upper(), "period")

    def retention_at(self, period: int) -> float:
        """Weighted retention at ``period`` periods after acquisition."""
        if 0 <= period < len(self.curve):
            return self.curve[period]
        return float("nan")

    def to_dict(self) -> dict[str, Any]:
        return {
            "freq": self.freq,
            "period_name": self.period_name,
            "cohorts": [str(i) for i in self.matrix.index],
            "sizes": {str(k): int(v) for k, v in self.sizes.items()},
            "matrix": [
                [None if pd.isna(v) else float(v) for v in row]
                for row in self.matrix.to_numpy()
            ],
            "curve": self.curve,
            "initial_retention": self.initial_retention,
            "steady_state_retention": self.steady_state_retention,
            "periods_observed": self.periods_observed,
        }

    def narrative(self) -> str:
        if not self.curve or len(self.curve) < 2:
            return "Not enough history to trace a retention curve."
        p = self.period_name
        parts = [
            f"{self.initial_retention:.1%} of customers return within one {p} of acquisition."
        ]
        if len(self.curve) > 3 and np.isfinite(self.steady_state_retention):
            parts.append(
                f"Beyond that the base decays at roughly "
                f"{1 - self.steady_state_retention:.1%} per {p}, implying an average "
                f"customer lifespan of about "
                f"{1 / max(1 - self.steady_state_retention, 1e-9):.1f} {p}s."
            )
        worst = int(np.argmin(np.diff(self.curve))) + 1 if len(self.curve) > 2 else 1
        parts.append(f"The steepest drop-off is between {p} {worst - 1} and {p} {worst}.")
        return " ".join(parts)


def cohort_retention(
    frame: pd.DataFrame,
    customer_col: str,
    date_col: str,
    freq: str = "M",
    max_periods: int = 12,
) -> CohortRetention:
    """Build the acquisition-cohort retention matrix.

    A customer belongs to the cohort of their *first* observed transaction and
    stays there forever.  Cell ``(cohort, k)`` is the share of that cohort seen
    transacting in period ``k`` after acquisition, so column 0 is 1.0 by
    construction.

    Only cells the data could actually have observed are filled: a cohort
    acquired last month has no period-6 value, and leaving those as ``NaN``
    rather than 0 is the difference between a retention curve and a curve that
    slopes down purely because recent cohorts are young.
    """
    for col in (customer_col, date_col):
        if col not in frame.columns:
            raise KeyError(f"column {col!r} is not in the frame")

    df = frame[[customer_col, date_col]].copy()
    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    df = df.dropna()
    if df.empty:
        return CohortRetention(freq, pd.DataFrame(), pd.Series(dtype="int64"))

    start, ordinal = _bucket(df[date_col], freq)
    df["_start"] = start
    df["_ordinal"] = ordinal

    first = df.groupby(customer_col)["_ordinal"].transform("min")
    df["_cohort_ordinal"] = first
    df["_offset"] = (df["_ordinal"] - first).astype("int64")
    df = df[(df["_offset"] >= 0) & (df["_offset"] <= max_periods)]

    cohort_start = df.groupby("_cohort_ordinal")["_start"].min()
    active = (
        df.groupby(["_cohort_ordinal", "_offset"])[customer_col]
        .nunique()
        .unstack(fill_value=0)
        .sort_index()
    )
    if active.empty:
        return CohortRetention(freq, pd.DataFrame(), pd.Series(dtype="int64"))

    sizes = active[0] if 0 in active.columns else active.iloc[:, 0]
    matrix = active.div(sizes, axis=0)

    # Blank out cells that lie in the future for that cohort.
    latest = int(df["_ordinal"].max())
    for cohort in matrix.index:
        horizon = latest - int(cohort)
        for offset in matrix.columns:
            if int(offset) > horizon:
                matrix.loc[cohort, offset] = np.nan

    labels = [cohort_start.get(i, pd.NaT) for i in matrix.index]
    matrix.index = pd.Index(
        [pd.Timestamp(x).date().isoformat() if pd.notna(x) else str(i)
         for x, i in zip(labels, matrix.index)],
        name="cohort",
    )
    matrix.columns = pd.Index([int(c) for c in matrix.columns], name="periods_since")
    sizes.index = matrix.index

    curve = retention_curve(active, sizes.to_numpy(), matrix)
    initial = curve[1] if len(curve) > 1 else float("nan")
    ratios = [
        curve[k + 1] / curve[k]
        for k in range(1, len(curve) - 1)
        if curve[k] > 0 and np.isfinite(curve[k + 1])
    ]
    steady = float(np.median(ratios)) if ratios else float("nan")

    return CohortRetention(
        freq=freq.upper(),
        matrix=matrix,
        sizes=sizes.astype("int64"),
        curve=curve,
        initial_retention=float(initial),
        steady_state_retention=min(steady, 0.999999) if np.isfinite(steady) else float("nan"),
        periods_observed=int(len(curve)),
    )


def retention_curve(
    active: pd.DataFrame,
    sizes: np.ndarray,
    matrix: pd.DataFrame,
) -> list[float]:
    """Size-weighted average retention by period, over fully observed cohorts only.

    Weighting by cohort size stops a tiny 40-customer cohort with an odd curve
    from moving the headline number, and the observed-only restriction stops
    young cohorts from dragging the tail toward zero.
    """
    curve: list[float] = []
    values = matrix.to_numpy()
    counts = active.to_numpy()
    for j in range(values.shape[1]):
        observed = ~np.isnan(values[:, j])
        denom = float(sizes[observed].sum())
        if denom <= 0:
            break
        curve.append(float(counts[observed, j].sum() / denom))
    return curve
