"""Rule-based recommendation engine: evidence-linked, quantified business actions."""

from .engine import (
    RULES,
    Recommendation,
    RecommendationSet,
    RuleContext,
    generate_recommendations,
    rule,
)
from .governance import apply_governance, explain_recommendation

__all__ = [
    "Recommendation",
    "RecommendationSet",
    "RuleContext",
    "generate_recommendations",
    "RULES",
    "rule",
    "apply_governance",
    "explain_recommendation",
]
