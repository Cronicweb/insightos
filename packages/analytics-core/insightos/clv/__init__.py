"""Customer value: who is worth keeping, and what keeping them is worth.

Three layers, each usable on its own:

* :mod:`insightos.clv.rfm` - recency / frequency / monetary scoring and the
  eleven-segment grid. Descriptive, non-parametric, and the fastest way to turn
  a transaction log into a targetable list.
* :mod:`insightos.clv.cohort` - acquisition cohorts and the retention curve,
  which is where the retention rate CLV depends on actually comes from.
* :mod:`insightos.clv.value` - the discounted-margin lifetime value identity,
  plus the concentration statistics that decide whether an average is worth
  quoting at all.

The ordering matters: segmentation says *who*, cohorts say *for how long*, and
value says *how much*. Skipping the middle layer is how teams end up asserting a
retention rate nobody measured.
"""

from __future__ import annotations

from .cohort import CohortRetention, cohort_retention, retention_curve
from .rfm import SEGMENT_ACTIONS, SEGMENT_ORDER, RFMSummary, rfm_table, summarise_rfm
from .value import (
    CLVResult,
    customer_lifetime_value,
    expected_remaining_lifetime,
    gini,
    predicted_clv,
    probability_alive,
    value_concentration,
)

__all__ = [
    "SEGMENT_ACTIONS",
    "SEGMENT_ORDER",
    "RFMSummary",
    "rfm_table",
    "summarise_rfm",
    "CohortRetention",
    "cohort_retention",
    "retention_curve",
    "CLVResult",
    "customer_lifetime_value",
    "expected_remaining_lifetime",
    "gini",
    "predicted_clv",
    "probability_alive",
    "value_concentration",
]
