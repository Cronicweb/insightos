"""Aggregator builders shared by the bundled domain packs.

A KPI aggregator is a pure function of ``(DataFrame slice, RoleMap)``. Because it
is pure, the *same* function computes the KPI card, the time series, the segment
breakdown and every node of the root-cause tree - there is no second
implementation that can drift.
"""

from __future__ import annotations

from collections.abc import Callable

import pandas as pd

from ..kpi.roles import RoleMap

__all__ = ["numeric", "sum_of", "mean_of", "nunique_of", "rate_of", "ratio_of", "per_entity"]

Aggregator = Callable[[pd.DataFrame, RoleMap], "float | None"]


def numeric(frame: pd.DataFrame, column: str) -> pd.Series:
    return pd.to_numeric(frame[column], errors="coerce")


def _column(frame: pd.DataFrame, roles: RoleMap, role: str) -> str | None:
    col = roles.get(role)
    return col if col and col in frame.columns else None


def sum_of(role: str) -> Aggregator:
    def agg(frame: pd.DataFrame, roles: RoleMap) -> float | None:
        col = _column(frame, roles, role)
        if col is None:
            return None
        value = numeric(frame, col).sum()
        return float(value) if pd.notna(value) else None
    return agg


def mean_of(role: str) -> Aggregator:
    def agg(frame: pd.DataFrame, roles: RoleMap) -> float | None:
        col = _column(frame, roles, role)
        if col is None or frame.empty:
            return None
        value = numeric(frame, col).mean()
        return float(value) if pd.notna(value) else None
    return agg


def nunique_of(role: str) -> Aggregator:
    def agg(frame: pd.DataFrame, roles: RoleMap) -> float | None:
        col = _column(frame, roles, role)
        return float(frame[col].nunique()) if col else None
    return agg


def rate_of(role: str, scale: float = 100.0) -> Aggregator:
    """Share of rows where a flag column is truthy, as a percentage by default."""
    def agg(frame: pd.DataFrame, roles: RoleMap) -> float | None:
        col = _column(frame, roles, role)
        if col is None or frame.empty:
            return None
        series = frame[col]
        if series.dtype == object:
            truthy = series.astype(str).str.strip().str.lower().isin(
                {"1", "true", "yes", "y", "t"})
        else:
            truthy = numeric(frame, col).fillna(0) > 0
        return float(truthy.mean() * scale)
    return agg


def ratio_of(numerator: str, denominator: str, scale: float = 1.0) -> Aggregator:
    def agg(frame: pd.DataFrame, roles: RoleMap) -> float | None:
        num_col = _column(frame, roles, numerator)
        den_col = _column(frame, roles, denominator)
        if num_col is None or den_col is None:
            return None
        den = numeric(frame, den_col).sum()
        if not den or pd.isna(den):
            return None
        num = numeric(frame, num_col).sum()
        return float(num / den * scale) if pd.notna(num) else None
    return agg


def per_entity(measure_role: str, entity_role: str) -> Aggregator:
    """A measure divided by the number of distinct entities that produced it."""
    def agg(frame: pd.DataFrame, roles: RoleMap) -> float | None:
        measure_col = _column(frame, roles, measure_role)
        entity_col = _column(frame, roles, entity_role)
        if measure_col is None or entity_col is None:
            return None
        entities = frame[entity_col].nunique()
        if not entities:
            return None
        total = numeric(frame, measure_col).sum()
        return float(total / entities) if pd.notna(total) else None
    return agg
