"""Semantic schema inference.

pandas tells you a column is ``float64``.  That is not enough to reason about a
business: ``discount_pct``, ``unit_price`` and ``customer_id`` are all
``float64`` yet require completely different treatment.  This module recovers
the *meaning* of each column from its name, its values and its distribution, and
that meaning is what every downstream engine keys off.
"""

from __future__ import annotations

import re
import warnings
from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from ..types import SemanticType, to_jsonable

__all__ = ["ColumnProfile", "TableSchema", "infer_schema", "detect_primary_key",
           "detect_foreign_keys", "ForeignKey"]


_ID_NAME = re.compile(r"(^|_)(id|key|code|no|num|number|uuid|guid|sk|pk)($|_)", re.I)
_CURRENCY_NAME = re.compile(
    r"(amount|amt|revenue|sales|price|cost|spend|profit|margin|value|balance|fee|"
    r"charge|payment|salary|income|expense|budget|gmv|arr|mrr|ltv|cac|aov|usd|inr|eur)", re.I
)
_PCT_NAME = re.compile(r"(pct|percent|percentage|rate|ratio|share|_pc$|ctr|cvr|roi|roas|margin_pct)", re.I)
_COUNT_NAME = re.compile(r"(count|qty|quantity|units|orders|clicks|impressions|visits|sessions|volume|n_)", re.I)
_DATE_NAME = re.compile(r"(date|time|timestamp|dt|day|month|year|week|created|updated|closed|posted)", re.I)
_GEO_NAME = re.compile(r"(country|region|state|province|city|zip|postal|district|territory|location|market|branch)", re.I)
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", re.I)
_URL_RE = re.compile(r"^(https?://|www\.)", re.I)
_PHONE_RE = re.compile(r"^\+?[\d\s().-]{7,20}$")
_BOOL_TOKENS = {
    frozenset({"true", "false"}), frozenset({"yes", "no"}), frozenset({"y", "n"}),
    frozenset({"0", "1"}), frozenset({"t", "f"}), frozenset({"active", "inactive"}),
}


@dataclass
class ColumnProfile:
    """Everything InsightOS knows about one column."""

    name: str
    dtype: str
    semantic_type: SemanticType
    count: int
    missing: int
    missing_pct: float
    unique: int
    unique_pct: float
    is_unique: bool
    is_constant: bool
    sample_values: list[Any] = field(default_factory=list)
    # numeric
    min: float | None = None
    max: float | None = None
    mean: float | None = None
    median: float | None = None
    std: float | None = None
    p05: float | None = None
    p25: float | None = None
    p75: float | None = None
    p95: float | None = None
    skewness: float | None = None
    kurtosis: float | None = None
    zeros: int = 0
    negatives: int = 0
    # categorical
    top_values: list[dict[str, Any]] = field(default_factory=list)
    entropy: float | None = None
    concentration_hhi: float | None = None
    # temporal
    min_date: str | None = None
    max_date: str | None = None
    inferred_granularity: str | None = None
    monotonic: bool | None = None
    gaps: int | None = None
    # roles
    candidate_key: bool = False
    candidate_measure: bool = False
    candidate_dimension: bool = False
    candidate_time: bool = False

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


@dataclass
class ForeignKey:
    from_table: str
    from_column: str
    to_table: str
    to_column: str
    match_ratio: float
    confidence: float

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


@dataclass
class TableSchema:
    name: str
    rows: int
    columns: list[ColumnProfile]
    primary_key: list[str] = field(default_factory=list)
    time_columns: list[str] = field(default_factory=list)
    measures: list[str] = field(default_factory=list)
    dimensions: list[str] = field(default_factory=list)
    identifiers: list[str] = field(default_factory=list)

    def column(self, name: str) -> ColumnProfile | None:
        return next((c for c in self.columns if c.name == name), None)

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


# --------------------------------------------------------------------------- #
_DATE_LIKE = re.compile(
    r"^\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?\s*$"
    r"|^\s*\d{1,2}[-/]\d{1,2}[-/]\d{2,4}([ T]\d{1,2}:\d{2}(:\d{2})?)?\s*$"
    r"|^\s*\d{8}\s*$"
    r"|^\s*\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}\s*$"
    r"|^\s*[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4}\s*$"
)

_DATE_FORMATS = ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M",
                 "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%m-%d-%Y", "%Y/%m/%d",
                 "%Y%m%d", "%d %b %Y", "%d %B %Y", "%b %d, %Y", "%B %d, %Y")


def _try_datetime(s: pd.Series) -> pd.Series | None:
    """Parse a text/number column as datetimes - cheaply, and without raising.

    Format discovery runs on a 300-row sample; only a format that parses the
    sample is applied to the full column.  This avoids the pathological case of
    dateutil parsing millions of identifier strings element by element, which is
    both very slow and prone to false positives ("TXN-00000001" is not a date).
    """
    non_null = s.dropna()
    if non_null.empty:
        return None
    sample = non_null.head(300).astype(str)
    if sample.str.fullmatch(r"\d{1,9}").mean() > 0.8:      # order ids are not dates
        return None
    if sample.str.match(_DATE_LIKE).mean() < 0.9:
        return None
    for fmt in _DATE_FORMATS:
        try:
            probe = pd.to_datetime(sample, format=fmt, errors="coerce")
        except (ValueError, TypeError):
            continue
        if probe.notna().mean() >= 0.95:
            try:
                parsed = pd.to_datetime(s, format=fmt, errors="coerce")
            except (ValueError, TypeError):
                continue
            if parsed.notna().mean() >= 0.9:
                return parsed
    with warnings.catch_warnings():                        # last-resort inference
        warnings.simplefilter("ignore")
        try:
            probe = pd.to_datetime(sample, errors="coerce")
        except (ValueError, TypeError):
            return None
        if probe.notna().mean() < 0.95:
            return None
        try:
            parsed = pd.to_datetime(s, errors="coerce")
        except (ValueError, TypeError):
            return None
    return parsed if parsed.notna().mean() >= 0.9 else None


def _entropy(counts: np.ndarray) -> float:
    p = counts / counts.sum()
    p = p[p > 0]
    return float(-(p * np.log2(p)).sum())


def _granularity(dt: pd.Series) -> tuple[str | None, int | None]:
    """Infer whether a date column is hourly / daily / weekly / monthly, and count gaps."""
    vals = dt.dropna().sort_values().drop_duplicates()
    if vals.size < 3:
        return None, None
    diffs = vals.diff().dropna().dt.total_seconds()
    if diffs.empty:
        return None, None
    med = float(diffs.median())
    table = [
        (60, "minute"), (3600, "hourly"), (86400, "daily"),
        (604800, "weekly"), (2592000, "monthly"), (7776000, "quarterly"),
        (31536000, "yearly"),
    ]
    gran = "irregular"
    for seconds, label in table:
        if med <= seconds * 1.35:
            gran = label
            break
    expected = {"minute": 60, "hourly": 3600, "daily": 86400, "weekly": 604800,
                "monthly": 2592000, "quarterly": 7776000, "yearly": 31536000}.get(gran)
    gaps = int((diffs > expected * 1.6).sum()) if expected else None
    return gran, gaps


def profile_column(series: pd.Series, name: str) -> ColumnProfile:
    """Profile a single column, inferring its semantic type and analytical role."""
    n = int(series.size)
    missing = int(series.isna().sum())
    non_null = series.dropna()
    unique = int(non_null.nunique())
    unique_pct = (unique / len(non_null) * 100.0) if len(non_null) else 0.0
    prof = ColumnProfile(
        name=name,
        dtype=str(series.dtype),
        semantic_type=SemanticType.UNKNOWN,
        count=n,
        missing=missing,
        missing_pct=round(missing / n * 100.0, 4) if n else 0.0,
        unique=unique,
        unique_pct=round(unique_pct, 4),
        is_unique=bool(len(non_null) > 0 and unique == len(non_null)),
        is_constant=bool(unique <= 1 and len(non_null) > 0),
        sample_values=[to_jsonable(v) for v in non_null.head(5).tolist()],
    )

    if len(non_null) == 0:
        prof.semantic_type = SemanticType.EMPTY
        return prof
    if prof.is_constant:
        prof.semantic_type = SemanticType.CONSTANT
        prof.top_values = [{"value": to_jsonable(non_null.iloc[0]), "count": len(non_null),
                            "pct": 100.0}]
        return prof

    parsed_dt: pd.Series | None = None
    if pd.api.types.is_datetime64_any_dtype(series):
        parsed_dt = series
    elif not pd.api.types.is_numeric_dtype(series) or _DATE_NAME.search(name):
        parsed_dt = _try_datetime(series)

    if parsed_dt is not None and parsed_dt.notna().any():
        prof.semantic_type = SemanticType.DATETIME
        valid = parsed_dt.dropna()
        prof.min_date = valid.min().isoformat()
        prof.max_date = valid.max().isoformat()
        gran, gaps = _granularity(parsed_dt)
        prof.inferred_granularity = gran
        prof.gaps = gaps
        prof.monotonic = bool(valid.is_monotonic_increasing)
        if gran in {"daily", "weekly", "monthly", "quarterly", "yearly"} and (
            valid.dt.normalize() == valid
        ).all():
            prof.semantic_type = SemanticType.DATE
        prof.candidate_time = True
        return prof

    if pd.api.types.is_bool_dtype(series):
        prof.semantic_type = SemanticType.BOOLEAN
        prof.candidate_dimension = True
        vc = non_null.value_counts()
        prof.top_values = [{"value": to_jsonable(k), "count": int(v),
                            "pct": round(v / len(non_null) * 100, 3)} for k, v in vc.items()]
        return prof

    if pd.api.types.is_numeric_dtype(series):
        arr = pd.to_numeric(non_null, errors="coerce").dropna().astype("float64")
        prof.min, prof.max = float(arr.min()), float(arr.max())
        prof.mean, prof.median = float(arr.mean()), float(arr.median())
        prof.std = float(arr.std(ddof=1)) if arr.size > 1 else 0.0
        q = arr.quantile([0.05, 0.25, 0.75, 0.95])
        prof.p05, prof.p25, prof.p75, prof.p95 = (float(q.iloc[0]), float(q.iloc[1]),
                                                  float(q.iloc[2]), float(q.iloc[3]))
        prof.zeros = int((arr == 0).sum())
        prof.negatives = int((arr < 0).sum())
        if arr.size > 2 and prof.std:
            z = (arr - prof.mean) / prof.std
            prof.skewness = float((z ** 3).mean())
            prof.kurtosis = float((z ** 4).mean() - 3.0)

        integral = bool(np.all(np.isclose(arr % 1, 0)))
        if _ID_NAME.search(name) and (prof.is_unique or unique_pct > 90) and integral:
            prof.semantic_type = SemanticType.IDENTIFIER
            prof.candidate_key = prof.is_unique
        elif _PCT_NAME.search(name):
            prof.semantic_type = SemanticType.PERCENTAGE
            prof.candidate_measure = True
        elif _CURRENCY_NAME.search(name):
            prof.semantic_type = SemanticType.CURRENCY
            prof.candidate_measure = True
        elif _COUNT_NAME.search(name) and integral and prof.min >= 0:
            prof.semantic_type = SemanticType.COUNT
            prof.candidate_measure = True
        elif integral and unique <= max(20, 0.02 * len(non_null)) and unique < 50:
            # low-cardinality integers behave like categories (ratings, flags, tiers)
            prof.semantic_type = SemanticType.ORDINAL
            prof.candidate_dimension = True
        else:
            prof.semantic_type = SemanticType.NUMERIC
            prof.candidate_measure = True
        if prof.semantic_type in {SemanticType.NUMERIC, SemanticType.CURRENCY,
                                  SemanticType.COUNT, SemanticType.PERCENTAGE}:
            counts = non_null.value_counts().to_numpy(dtype="float64")
            prof.concentration_hhi = float(((counts / counts.sum()) ** 2).sum())
        return prof

    # object / string
    as_str = non_null.astype(str).str.strip()
    lowered = set(as_str.str.lower().unique()[:10])
    vc = as_str.value_counts()
    prof.top_values = [
        {"value": to_jsonable(k), "count": int(v), "pct": round(v / len(as_str) * 100, 3)}
        for k, v in vc.head(15).items()
    ]
    prof.entropy = _entropy(vc.to_numpy(dtype="float64"))
    shares = vc.to_numpy(dtype="float64") / len(as_str)
    prof.concentration_hhi = float((shares ** 2).sum())

    if unique <= 2 and any(lowered <= s for s in _BOOL_TOKENS):
        prof.semantic_type = SemanticType.BOOLEAN
        prof.candidate_dimension = True
    elif as_str.head(200).str.match(_EMAIL_RE).mean() > 0.8:
        prof.semantic_type = SemanticType.EMAIL
    elif as_str.head(200).str.match(_URL_RE).mean() > 0.8:
        prof.semantic_type = SemanticType.URL
    elif as_str.head(200).str.match(_PHONE_RE).mean() > 0.9 and unique_pct > 50:
        prof.semantic_type = SemanticType.PHONE
    elif prof.is_unique or (unique_pct > 92 and _ID_NAME.search(name)):
        prof.semantic_type = SemanticType.IDENTIFIER
        prof.candidate_key = prof.is_unique
    elif _GEO_NAME.search(name) and unique < len(as_str) * 0.6:
        prof.semantic_type = SemanticType.GEO
        prof.candidate_dimension = True
    elif as_str.str.len().mean() > 45 or unique_pct > 70:
        prof.semantic_type = SemanticType.TEXT
    else:
        prof.semantic_type = SemanticType.CATEGORICAL
        prof.candidate_dimension = True
    return prof


def infer_schema(df: pd.DataFrame, name: str = "dataset") -> TableSchema:
    """Profile every column and assign analytical roles for the whole table."""
    columns = [profile_column(df[c], str(c)) for c in df.columns]
    schema = TableSchema(name=name, rows=int(len(df)), columns=columns)
    schema.time_columns = [c.name for c in columns if c.candidate_time]
    schema.measures = [c.name for c in columns if c.candidate_measure]
    schema.dimensions = [c.name for c in columns if c.candidate_dimension]
    schema.identifiers = [c.name for c in columns
                          if c.semantic_type == SemanticType.IDENTIFIER]
    schema.primary_key = detect_primary_key(df, schema)
    return schema


def detect_primary_key(df: pd.DataFrame, schema: TableSchema, max_composite: int = 2) -> list[str]:
    """Find a single-column key, else search for a minimal composite key.

    Single columns are scored on uniqueness, absence of nulls and how key-like the
    name is, so ``order_id`` beats a coincidentally unique ``email``.
    """
    best: tuple[float, list[str]] | None = None
    for col in schema.columns:
        if col.missing > 0 or not col.is_unique or col.count == 0:
            continue
        score = 1.0
        if _ID_NAME.search(col.name):
            score += 1.0
        if col.semantic_type == SemanticType.IDENTIFIER:
            score += 0.75
        if col.name.lower().startswith(schema.name.lower().rstrip("s")):
            score += 0.5
        if best is None or score > best[0]:
            best = (score, [col.name])
    if best:
        return best[1]

    if max_composite >= 2 and len(df) > 0:
        candidates = [c.name for c in schema.columns
                      if c.missing == 0 and not c.is_constant
                      and c.semantic_type in {SemanticType.IDENTIFIER, SemanticType.CATEGORICAL,
                                              SemanticType.DATE, SemanticType.DATETIME,
                                              SemanticType.ORDINAL, SemanticType.GEO}][:12]
        for i, a in enumerate(candidates):
            for b in candidates[i + 1 :]:
                if not df.duplicated(subset=[a, b]).any():
                    return [a, b]
    return []


def detect_foreign_keys(
    tables: dict[str, pd.DataFrame],
    schemas: dict[str, TableSchema],
    min_match: float = 0.95,
) -> list[ForeignKey]:
    """Infer referential links by value-set containment.

    A column in table A is a foreign key into table B when (almost) all of its
    values appear in B's primary key and the name/type profile is compatible.
    """
    out: list[ForeignKey] = []
    for to_name, to_schema in schemas.items():
        pk = to_schema.primary_key
        if len(pk) != 1:
            continue
        pk_col = pk[0]
        pk_values = set(tables[to_name][pk_col].dropna().unique().tolist())
        if not pk_values:
            continue
        for from_name, from_schema in schemas.items():
            if from_name == to_name:
                continue
            for col in from_schema.columns:
                if col.is_constant or col.semantic_type in {
                    SemanticType.TEXT, SemanticType.EMPTY, SemanticType.DATETIME,
                    SemanticType.DATE, SemanticType.PERCENTAGE,
                }:
                    continue
                if col.unique > len(pk_values) or col.unique < 2:
                    continue
                values = set(tables[from_name][col.name].dropna().unique().tolist())
                if not values:
                    continue
                ratio = len(values & pk_values) / len(values)
                if ratio < min_match:
                    continue
                confidence = ratio
                if col.name == pk_col:
                    confidence = min(1.0, confidence + 0.05)
                elif _ID_NAME.search(col.name):
                    confidence = min(1.0, confidence + 0.02)
                else:
                    confidence -= 0.10
                if confidence >= min_match:
                    out.append(ForeignKey(from_name, col.name, to_name, pk_col,
                                          round(ratio, 4), round(confidence, 4)))
    return sorted(out, key=lambda f: -f.confidence)
