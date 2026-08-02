"""Retail / e-commerce domain pack."""

from __future__ import annotations

from ..kpi.registry import KPIDefinition
from ..types import Domain
from .aggregators import per_entity, rate_of, ratio_of
from .base import (
    DomainPlugin,
    ForecastSettings,
    PluginRule,
    RecommendationPlaybook,
    RootCauseHint,
)

D = Domain.ECOMMERCE

KPIS = (
    KPIDefinition(
        "return_rate", "Return Rate",
        "Share of orders returned, refunded or cancelled.",
        (D,), ("return_flag",), rate_of("return_flag"),
        unit="percent", higher_is_better=False, additive=False,
        formula="returned orders / orders", priority=26, tags=("quality",),
    ),
    KPIDefinition(
        "discount_depth", "Discount Depth",
        "Discount granted as a share of gross revenue.",
        (D,), ("discount", "revenue"), ratio_of("discount", "revenue", 100.0),
        unit="percent", higher_is_better=False, additive=False,
        formula="SUM(discount) / SUM(revenue)", priority=28, tags=("margin",),
    ),
    KPIDefinition(
        "revenue_per_customer", "Revenue per Customer",
        "Revenue divided by distinct purchasing customers.",
        (D,), ("revenue", "customer_id"), per_entity("revenue", "customer_id"),
        unit="currency", additive=False,
        formula="SUM(revenue) / COUNT(DISTINCT customer)", priority=20, tags=("growth",),
    ),
)

PLUGIN = DomainPlugin(
    key="retail",
    domain=D,
    label="Retail & E-commerce",
    description=(
        "Basket, catalogue and channel analytics. Built around the margin bridge - "
        "price, mix, discount and returns - rather than headline revenue alone."
    ),
    kpis=KPIS,
    priority_dimensions=("product_id", "channel", "region", "segment", "status"),
    root_cause_hints=(
        RootCauseHint(
            "revenue", ("product_id", "channel", "region", "segment"), ("return_flag",),
            "Revenue decomposes by catalogue and channel; returns are recognised later "
            "and distort period attribution if treated as a driver.",
        ),
        RootCauseHint("return_rate", ("product_id", "channel", "region")),
        RootCauseHint("discount_depth", ("product_id", "channel", "segment")),
    ),
    rules=(
        PluginRule(
            "retail.discount_creep", "discount_depth", "up", 10.0,
            "Investigate margin erosion from discounting",
            "Rank products by incremental discount spend and test whether the extra "
            "discount produced incremental units or simply subsidised demand that "
            "would have converted anyway.",
            category="margin", urgency=0.9, effort="medium",
            success_measure="Discount depth returns to plan without a fall in units.",
            rationale="Discount depth rising faster than volume is a direct margin transfer.",
        ),
        PluginRule(
            "retail.return_spike", "return_rate", "up", 12.0,
            "Investigate the increase in returns",
            "Group returns by product and reason code to separate a quality or sizing "
            "defect from a change in returns policy or customer mix.",
            category="quality", urgency=0.88, effort="medium",
            success_measure="Return rate falls back within its control limits.",
        ),
        PluginRule(
            "retail.basket_softening", "revenue_per_customer", "down", 7.0,
            "Investigate the fall in revenue per customer",
            "Decompose into basket size versus purchase frequency and check whether "
            "newly acquired customers are diluting the average.",
            category="growth", urgency=0.78, effort="medium",
        ),
    ),
    forecast=ForecastSettings(
        horizon=4, seasonal_period=52, min_history=16,
        note="Weekly retail series carry a strong annual promotional cycle.",
    ),
    playbook=RecommendationPlaybook(
        owners={
            "margin": "Head of Merchandising",
            "quality": "Head of Supply Quality",
            "growth": "Head of E-commerce",
            "retention": "CRM Lead",
        },
        approval_authority="Commercial Director",
        approval_impact_threshold=200_000.0,
        approval_categories=("margin",),
        review_cadence="weekly trade meeting",
    ),
    glossary={
        "basket size": "Average revenue per order.",
        "margin bridge": "Decomposition of a margin change into price, mix, cost and discount.",
        "mix effect": "Margin change caused by a shift in what sold, not how it was priced.",
    },
)
