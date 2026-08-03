"""RFM: turn a transaction log into a behavioural segmentation of the base.

Recency, Frequency and Monetary value are the three questions that separate a
customer worth an incentive from one worth leaving alone.  RFM predates every
machine-learning approach to segmentation and still holds its own, for two
reasons that matter in a regulated business: it needs no training data, and a
marketer can read the reason a member landed in a segment straight off the row.

The scoring here is rank-based rather than fixed-threshold, so the segmentation
is defined relative to *this* book of customers.  A monetary score of 5 always
means "top 20% of this base", never "spent more than some number a consultant
picked in 2019".
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd

__all__ = [
    "RFMSummary",
    "rfm_table",
    "summarise_rfm",
    "SEGMENT_ORDER",
]

# Ordered from most to least valuable, so any UI that renders these gets a
# sensible sort for free.
SEGMENT_ORDER = [
    "Champions",
    "Loyal customers",
    "Cannot lose them",
    "Potential loyalists",
    "New customers",
    "Promising",
    "Needs attention",
    "At risk",
    "Hibernating",
    "Lost",
]

# What to actually do about each segment. Deterministic, auditable, and the
# reason this module belongs in an engine that recommends actions rather than
# one that only describes.
SEGMENT_ACTIONS = {
    "Champions": "Reward and reference. Early access, not discounts - they already convert.",
    "Loyal customers": "Grow share of wallet with adjacent products; they respond to relevance.",
    "Cannot lose them": "High value, gone quiet. Personal outreach; this is where retention spend pays.",
    "Potential loyalists": "Push the second and third purchase; membership and bundling offers.",
    "New customers": "Onboard hard. The first 90 days set the lifetime value.",
    "Promising": "Low-cost nudges only until behaviour is established.",
    "Needs attention": "Was valuable, is drifting. Time-limited incentive with a measured holdout.",
    "At risk": "Reactivation campaign; test incentive depth before rolling out.",
    "Hibernating": "Low-cost winback or suppress. Do not spend premium acquisition budget here.",
    "Lost": "Suppress from paid channels. Keep for lookalike exclusion, not for targeting.",
}


@dataclass
class RFMSummary:
    """Segment-level roll-up: how many members, and how much value they carry."""

    as_of: str
    customers: int
    segments: list[dict[str, Any]] = field(default_factory=list)
    value_column: str = "monetary"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def top_segment_by_value(self) -> str | None:
        if not self.segments:
            return None
        return max(self.segments, key=lambda s: s["monetary_total"])["segment"]

    def narrative(self) -> str:
        if not self.segments:
            return "No customers available to segment."
        ranked = sorted(self.segments, key=lambda s: s["monetary_share"], reverse=True)
        lead = ranked[0]
        at_risk = [
            s for s in self.segments
            if s["segment"] in {"At risk", "Cannot lose them", "Needs attention"}
        ]
        risk_share = sum(s["monetary_share"] for s in at_risk)
        parts = [
            f"{self.customers:,} customers segmented as of {self.as_of}.",
            f"{lead['segment']} carry {lead['monetary_share']:.1%} of value from "
            f"{lead['share_of_customers']:.1%} of the base.",
        ]
        if risk_share > 0:
            parts.append(
                f"{risk_share:.1%} of value sits in segments that are lapsing "
                f"(at risk, needs attention, cannot lose them) - that is the retention "
                f"budget's addressable pool."
            )
        return " ".join(parts)


def _score(values: pd.Series, bins: int, higher_is_better: bool) -> pd.Series:
    """Rank-based 1..bins score, tie-safe and robust to skewed distributions.

    Quantile cutting with ``qcut`` throws on duplicate bin edges the moment a
    metric has a common value (frequency = 1 is the single most common row in
    any retail dataset), so ranks are used instead: every customer gets a score
    and the bin edges are always well defined.
    """
    if values.empty:
        return pd.Series(dtype="int64", index=values.index)
    pct = values.rank(ascending=higher_is_better, pct=True, method="average")
    scored = np.ceil(pct * bins)
    return scored.clip(lower=1, upper=bins).astype("int64")


def _segment(r: int, f: int, m: int, bins: int) -> str:
    """Map an (R, F) pair onto the standard RFM grid.

    Rules are evaluated in order and the first match wins, so the grid is
    exhaustive and every customer receives exactly one label. ``m`` only breaks
    the tie between "at risk" and "cannot lose them", because the difference
    between those two is entirely about how much money is walking out.
    """
    hi = bins  # 5 on the default scale
    mid = (bins + 1) / 2.0  # 3

    if r >= hi - 1 and f >= hi - 1:
        return "Champions"
    if r >= mid and f >= hi - 1:
        return "Loyal customers"
    if r <= 2 and f >= hi - 1 and m >= hi - 1:
        return "Cannot lose them"
    if r >= hi - 1 and f >= mid:
        return "Potential loyalists"
    if r >= hi - 1 and f <= 2:
        return "New customers"
    if r >= mid and f <= 2:
        return "Promising"
    if r >= mid:
        return "Needs attention"
    if f >= mid:
        return "At risk"
    if r <= 1 and f <= 1:
        return "Lost"
    return "Hibernating"


def rfm_table(
    frame: pd.DataFrame,
    customer_col: str,
    date_col: str,
    value_col: str,
    as_of: pd.Timestamp | str | None = None,
    bins: int = 5,
) -> pd.DataFrame:
    """Collapse a transaction log to one scored row per customer.

    Parameters
    ----------
    frame
        Transaction-grain data: one row per order, payment or interaction.
    as_of
        The observation date.  Defaults to the day after the last transaction,
        which is the only choice that stops the most recent buyer scoring a
        recency of zero and skewing the ranks.

    Returns
    -------
    DataFrame indexed by customer with ``recency_days``, ``frequency``,
    ``monetary``, the three 1-5 scores, a concatenated ``rfm_cell`` (e.g.
    ``"545"``), the ``segment`` label and its recommended ``action``.
    """
    for col in (customer_col, date_col, value_col):
        if col not in frame.columns:
            raise KeyError(f"column {col!r} is not in the frame")
    if bins < 2:
        raise ValueError("bins must be at least 2")

    df = frame[[customer_col, date_col, value_col]].copy()
    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    df[value_col] = pd.to_numeric(df[value_col], errors="coerce")
    df = df.dropna(subset=[customer_col, date_col])
    if df.empty:
        return pd.DataFrame(
            columns=["recency_days", "frequency", "monetary", "r_score", "f_score",
                     "m_score", "rfm_cell", "segment", "action"]
        )

    observed = pd.to_datetime(as_of) if as_of is not None else df[date_col].max() + pd.Timedelta(days=1)

    grouped = df.groupby(customer_col, dropna=True).agg(
        last_seen=(date_col, "max"),
        frequency=(date_col, "count"),
        monetary=(value_col, "sum"),
    )
    grouped["recency_days"] = (observed - grouped["last_seen"]).dt.days.astype("int64")
    grouped["monetary"] = grouped["monetary"].fillna(0.0)

    grouped["r_score"] = _score(grouped["recency_days"], bins, higher_is_better=False)
    grouped["f_score"] = _score(grouped["frequency"], bins, higher_is_better=True)
    grouped["m_score"] = _score(grouped["monetary"], bins, higher_is_better=True)
    grouped["rfm_cell"] = (
        grouped["r_score"].astype(str)
        + grouped["f_score"].astype(str)
        + grouped["m_score"].astype(str)
    )
    grouped["segment"] = [
        _segment(int(r), int(f), int(m), bins)
        for r, f, m in zip(grouped["r_score"], grouped["f_score"], grouped["m_score"])
    ]
    grouped["action"] = grouped["segment"].map(SEGMENT_ACTIONS)

    ordered = [
        "recency_days", "frequency", "monetary",
        "r_score", "f_score", "m_score", "rfm_cell", "segment", "action",
    ]
    return grouped[ordered]


def summarise_rfm(table: pd.DataFrame) -> RFMSummary:
    """Roll an :func:`rfm_table` up to the segment level with value shares."""
    if table.empty:
        return RFMSummary(as_of="n/a", customers=0)

    total_value = float(table["monetary"].sum())
    total_customers = int(len(table))
    rows: list[dict[str, Any]] = []
    for segment, chunk in table.groupby("segment"):
        value = float(chunk["monetary"].sum())
        rows.append(
            {
                "segment": str(segment),
                "customers": int(len(chunk)),
                "share_of_customers": len(chunk) / total_customers,
                "monetary_total": value,
                "monetary_share": value / total_value if total_value else 0.0,
                "average_value": value / len(chunk) if len(chunk) else 0.0,
                "median_recency_days": float(chunk["recency_days"].median()),
                "median_frequency": float(chunk["frequency"].median()),
                "action": SEGMENT_ACTIONS.get(str(segment), ""),
            }
        )
    rows.sort(
        key=lambda r: SEGMENT_ORDER.index(r["segment"])
        if r["segment"] in SEGMENT_ORDER
        else len(SEGMENT_ORDER)
    )
    return RFMSummary(as_of="latest transaction", customers=total_customers, segments=rows)
