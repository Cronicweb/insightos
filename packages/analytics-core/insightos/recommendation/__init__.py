"""Rule-based recommendation engine: evidence-linked, quantified business actions."""

from .engine import (
    RULES,
    Recommendation,
    RecommendationSet,
    RuleContext,
    generate_recommendations,
    rule,
)

__all__ = [
    "Recommendation",
    "RecommendationSet",
    "RuleContext",
    "generate_recommendations",
    "RULES",
    "rule",
]
