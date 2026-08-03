"""Regression tests for validity masks that are built from a filtered column.

The email and categorical-casing checks derive their boolean mask from
``series.dropna()``.  That mask carries a *subset* index, and pandas refuses to
use it as an indexer on the full column.  Before the fix this raised
``IndexingError`` and took the entire quality stage down with it, so a single
null in a categorical column was enough to lose the whole data-quality report.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from insightos.profiling import infer_schema
from insightos.quality import assess_quality


def _frame(index: pd.Index | None = None) -> pd.DataFrame:
    rows = 60
    region = ["East", "west ", "East", None, "WEST", "east"] * (rows // 6)
    email = ["a@b.com", "not-an-email", None, "c@d.org", "e@f.io", "g@h.net"] * (rows // 6)
    df = pd.DataFrame(
        {
            "order_date": pd.date_range("2024-01-01", periods=rows, freq="D"),
            "region": region,
            "email": email,
            "revenue": np.linspace(10.0, 500.0, rows),
        }
    )
    if index is not None:
        df.index = index
    return df


def test_quality_survives_nulls_in_categorical_and_email_columns() -> None:
    df = _frame()
    report = assess_quality(df, infer_schema(df))

    assert 0.0 <= report.score <= 100.0
    assert report.rows == len(df)


def test_casing_check_reports_rows_from_the_original_column() -> None:
    df = _frame()
    report = assess_quality(df, infer_schema(df))

    casing = [v for v in report.invalid_values
              if v["column"] == "region" and v["check"] == "inconsistent_casing"]
    assert casing, "the mixed-case region column should trip the casing check"
    entry = casing[0]
    assert entry["count"] > 0
    assert entry["count"] <= int(df["region"].notna().sum())
    assert None not in entry["examples"]


def test_non_contiguous_index_does_not_break_validity_checks() -> None:
    """A frame that has already been filtered keeps its original labels."""
    df = _frame()
    filtered = df[df["revenue"] > 100.0]
    assert not filtered.index.equals(pd.RangeIndex(len(filtered)))

    report = assess_quality(filtered, infer_schema(filtered))
    assert report.rows == len(filtered)
    for entry in report.invalid_values:
        assert entry["count"] <= len(filtered)
