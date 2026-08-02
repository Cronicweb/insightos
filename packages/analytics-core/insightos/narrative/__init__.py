"""Deterministic narrative generation with an optional, fact-verified LLM polish."""

from .polish import (
    CallableProvider,
    LLMProvider,
    NarrativePolisher,
    PolishResult,
    extract_facts,
    verify_polish,
)
from .writer import (
    ChartNarrative,
    describe_breakdown,
    describe_comparison,
    describe_correlation,
    describe_distribution,
    describe_series,
    format_value,
)

__all__ = [
    "ChartNarrative",
    "describe_series",
    "describe_breakdown",
    "describe_comparison",
    "describe_distribution",
    "describe_correlation",
    "format_value",
    "LLMProvider",
    "CallableProvider",
    "NarrativePolisher",
    "PolishResult",
    "extract_facts",
    "verify_polish",
]
