"""Shared vocabulary for the InsightOS analytics core.

Every module speaks in these types, which is what allows the profiler, the KPI
engine, the root-cause engine and the report generator to be composed in any
order without adapters.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, is_dataclass
from datetime import date, datetime
from enum import Enum
from typing import Any

import numpy as np
import pandas as pd

__all__ = [
    "SemanticType",
    "Domain",
    "Severity",
    "Evidence",
    "Insight",
    "InsightOSJSONEncoder",
    "to_jsonable",
]


class SemanticType(str, Enum):
    """What a column *means*, as opposed to how pandas stores it."""

    IDENTIFIER = "identifier"
    CATEGORICAL = "categorical"
    ORDINAL = "ordinal"
    NUMERIC = "numeric"
    CURRENCY = "currency"
    PERCENTAGE = "percentage"
    COUNT = "count"
    BOOLEAN = "boolean"
    DATETIME = "datetime"
    DATE = "date"
    TEXT = "text"
    GEO = "geo"
    EMAIL = "email"
    PHONE = "phone"
    URL = "url"
    CONSTANT = "constant"
    EMPTY = "empty"
    UNKNOWN = "unknown"


class Domain(str, Enum):
    """Business domains InsightOS can recognise from a schema alone."""

    SALES = "sales"
    MARKETING = "marketing"
    FINANCE = "finance"
    BANKING = "banking"
    ECOMMERCE = "ecommerce"
    HR = "hr"
    HEALTHCARE = "healthcare"
    MANUFACTURING = "manufacturing"
    SUPPLY_CHAIN = "supply_chain"
    SAAS = "saas"
    GENERIC = "generic"


class Severity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"

    @property
    def rank(self) -> int:
        return {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}[self.value]


@dataclass
class Evidence:
    """A single auditable fact backing an insight or recommendation.

    ``method`` records *how* the number was produced so a reviewer can reproduce
    it; ``p_value`` is populated whenever the fact came from a hypothesis test.
    """

    label: str
    value: Any
    method: str = "descriptive"
    p_value: float | None = None
    effect_size: float | None = None
    sample_size: int | None = None
    comparison: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


@dataclass
class Insight:
    """A finding produced by any engine module.

    ``narrative`` is deterministic text generated from ``evidence``; an LLM may
    later rewrite it for tone but may never alter the underlying numbers.
    """

    id: str
    title: str
    narrative: str
    severity: Severity = Severity.INFO
    category: str = "general"
    confidence: float = 1.0
    evidence: list[Evidence] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    metric: str | None = None
    dimension: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


class InsightOSJSONEncoder(json.JSONEncoder):
    """Serialises dataclasses, enums, numpy scalars, timestamps and NaN safely."""

    def default(self, o: Any) -> Any:  # noqa: D102
        if is_dataclass(o) and not isinstance(o, type):
            return to_jsonable(asdict(o))
        if isinstance(o, Enum):
            return o.value
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, (np.floating,)):
            v = float(o)
            return None if (np.isnan(v) or np.isinf(v)) else v
        if isinstance(o, np.bool_):
            return bool(o)
        if isinstance(o, np.ndarray):
            return [to_jsonable(v) for v in o.tolist()]
        if isinstance(o, (pd.Timestamp, datetime, date)):
            return o.isoformat()
        if isinstance(o, pd.Series):
            return to_jsonable(o.to_dict())
        if o is pd.NaT:
            return None
        return super().default(o)


def to_jsonable(obj: Any) -> Any:
    """Recursively convert an object graph into plain JSON-safe python."""
    if obj is None:
        return None
    if is_dataclass(obj) and not isinstance(obj, type):
        return to_jsonable(asdict(obj))
    if isinstance(obj, Enum):
        return obj.value
    if isinstance(obj, dict):
        return {str(k): to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [to_jsonable(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        v = float(obj)
        return None if (np.isnan(v) or np.isinf(v)) else v
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        return [to_jsonable(v) for v in obj.tolist()]
    if isinstance(obj, (pd.Timestamp, datetime, date)):
        return obj.isoformat()
    if obj is pd.NaT:
        return None
    if isinstance(obj, pd.Series):
        return to_jsonable(obj.to_dict())
    if isinstance(obj, pd.DataFrame):
        return to_jsonable(obj.to_dict(orient="records"))
    return obj
