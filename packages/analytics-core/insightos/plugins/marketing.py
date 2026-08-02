"""Marketing performance domain pack."""

from __future__ import annotations

from ..kpi.registry import KPIDefinition
from ..types import Domain
from .aggregators import ratio_of
from .base import (
    DomainPlugin,
    ForecastSettings,
    PluginRule,
    RecommendationPlaybook,
    RootCauseHint,
)

D = Domain.MARKETING

KPIS = (
    KPIDefinition(
        "cost_per_click", "Cost per Click",
        "Media spend divided by clicks delivered.",
        (D,), ("marketing_spend", "clicks"), ratio_of("marketing_spend", "clicks"),
        unit="currency", higher_is_better=False, additive=False,
        formula="SUM(spend) / SUM(clicks)", priority=24, tags=("efficiency",),
    ),
    KPIDefinition(
        "click_to_conversion", "Click-to-Conversion Rate",
        "Share of clicks that became a conversion.",
        (D,), ("conversions", "clicks"), ratio_of("conversions", "clicks", 100.0),
        unit="percent", additive=False,
        formula="SUM(conversions) / SUM(clicks)", priority=18, tags=("funnel",),
    ),
)

PLUGIN = DomainPlugin(
    key="marketing",
    domain=D,
    label="Marketing Performance",
    description=(
        "Funnel and media-efficiency analytics. Every metric is read as a ratio of the "
        "stage above it, so a change is always attributed to the stage that caused it."
    ),
    kpis=KPIS,
    priority_dimensions=("campaign_id", "channel", "region", "segment"),
    root_cause_hints=(
        RootCauseHint(
            "roas", ("campaign_id", "channel", "region"), ("impressions",),
            "Return on ad spend moves with conversion value and spend; impressions are "
            "an upstream volume input, not an explanation.",
        ),
        RootCauseHint("conversion_rate", ("campaign_id", "channel", "segment")),
        RootCauseHint("cost_per_click", ("campaign_id", "channel")),
    ),
    rules=(
        PluginRule(
            "marketing.roas_decline", "roas", "down", 12.0,
            "Investigate the decline in return on ad spend",
            "Split the movement into a spend increase versus a conversion-value fall, "
            "then rank campaigns by contribution before any budget is moved.",
            category="efficiency", urgency=0.9, effort="low", horizon="this month",
            success_measure="ROAS recovers to at least the trailing 4-period average.",
            rationale="ROAS falling while spend holds means the marginal impression is unprofitable.",
        ),
        PluginRule(
            "marketing.cpc_inflation", "cost_per_click", "up", 15.0,
            "Investigate rising cost per click",
            "Check auction pressure by channel and whether creative fatigue has reduced "
            "click-through, which raises effective cost without any bid change.",
            category="efficiency", urgency=0.82, effort="low",
        ),
        PluginRule(
            "marketing.funnel_leak", "click_to_conversion", "down", 10.0,
            "Investigate the drop in click-to-conversion",
            "Traffic is arriving but not converting. Compare landing experience and "
            "audience mix between the two periods before adjusting bids.",
            category="funnel", urgency=0.86, effort="medium",
            success_measure="Click-to-conversion returns within its control band.",
        ),
    ),
    forecast=ForecastSettings(
        horizon=4, seasonal_period=52, min_history=12,
        note="Campaign series are bursty; short horizons only.",
    ),
    playbook=RecommendationPlaybook(
        owners={
            "efficiency": "Head of Performance Marketing",
            "funnel": "Growth Lead",
            "growth": "Head of Demand Generation",
            "retention": "Lifecycle Marketing Lead",
        },
        approval_authority="Marketing Director",
        approval_impact_threshold=100_000.0,
        approval_categories=(),
        review_cadence="weekly performance review",
    ),
    glossary={
        "ROAS": "Conversion value divided by media spend.",
        "creative fatigue": "Decline in response caused by repeated exposure to the same asset.",
        "incrementality": "Conversions that would not have occurred without the campaign.",
    },
)
