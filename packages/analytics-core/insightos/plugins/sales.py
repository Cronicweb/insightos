"""Sales performance domain pack."""

from __future__ import annotations

from ..kpi.registry import KPIDefinition
from ..types import Domain
from .aggregators import per_entity, ratio_of
from .base import (
    DomainPlugin,
    ForecastSettings,
    PluginRule,
    RecommendationPlaybook,
    RootCauseHint,
)

D = Domain.SALES

KPIS = (
    KPIDefinition(
        "gross_margin_pct", "Gross Margin %",
        "Profit expressed as a share of revenue.",
        (D,), ("profit", "revenue"), ratio_of("profit", "revenue", 100.0),
        unit="percent", additive=False,
        formula="SUM(profit) / SUM(revenue)", priority=12, tags=("margin",),
    ),
    KPIDefinition(
        "revenue_per_account", "Revenue per Account",
        "Revenue divided by distinct accounts transacting in the period.",
        (D,), ("revenue", "customer_id"), per_entity("revenue", "customer_id"),
        unit="currency", additive=False,
        formula="SUM(revenue) / COUNT(DISTINCT account)", priority=21, tags=("growth",),
    ),
)

PLUGIN = DomainPlugin(
    key="sales",
    domain=D,
    label="Sales Performance",
    description=(
        "Pipeline, territory and account analytics. Revenue is always read alongside "
        "margin so volume bought with discount is never mistaken for growth."
    ),
    kpis=KPIS,
    priority_dimensions=("region", "segment", "product_id", "channel"),
    root_cause_hints=(
        RootCauseHint(
            "revenue", ("region", "segment", "product_id", "channel"), ("discount",),
            "Revenue decomposes by territory, segment and catalogue; discount is a "
            "margin driver and is analysed on the margin branch instead.",
        ),
        RootCauseHint("gross_margin_pct", ("product_id", "segment", "region")),
        RootCauseHint("average_order_value", ("segment", "product_id")),
    ),
    rules=(
        PluginRule(
            "sales.revenue_decline", "revenue", "down", 8.0,
            "Investigate the revenue decline",
            "Attribute the fall to territory, segment and product before acting, and "
            "confirm whether it is fewer accounts or smaller deals.",
            category="growth", urgency=0.92, effort="medium", horizon="this quarter",
            success_measure="Revenue returns to trend within two periods.",
            rationale="An 8% period-over-period fall exceeds normal sales variance.",
        ),
        PluginRule(
            "sales.margin_erosion", "gross_margin_pct", "down", 5.0,
            "Investigate gross margin erosion",
            "Separate price, mix and cost effects. Mix-driven erosion needs a different "
            "response from price-driven erosion.",
            category="margin", urgency=0.9, effort="medium",
            success_measure="Gross margin percentage recovers to plan.",
        ),
        PluginRule(
            "sales.account_softening", "revenue_per_account", "down", 6.0,
            "Investigate falling revenue per account",
            "Check whether existing accounts are buying less or whether newly won "
            "smaller accounts are diluting the average.",
            category="retention", urgency=0.8, effort="medium",
        ),
    ),
    forecast=ForecastSettings(
        horizon=3, seasonal_period=12, min_history=12,
        note="Quarter-end effects dominate; keep the horizon inside one planning cycle.",
    ),
    playbook=RecommendationPlaybook(
        owners={
            "growth": "VP Sales",
            "margin": "Head of Commercial Finance",
            "retention": "Head of Account Management",
            "efficiency": "Sales Operations Lead",
        },
        approval_authority="Chief Revenue Officer",
        approval_impact_threshold=250_000.0,
        approval_categories=("margin",),
        review_cadence="monthly business review",
    ),
    glossary={
        "AOV": "Average order value - revenue divided by orders.",
        "territory": "The geographic or account grouping a quota is set against.",
        "win rate": "Share of qualified opportunities that closed won.",
    },
)
