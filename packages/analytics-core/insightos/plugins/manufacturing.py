"""Manufacturing operations domain pack."""

from __future__ import annotations

from ..kpi.registry import KPIDefinition
from ..types import Domain
from .aggregators import mean_of, rate_of, sum_of
from .base import (
    DomainPlugin,
    ForecastSettings,
    PluginRule,
    RecommendationPlaybook,
    RootCauseHint,
)

D = Domain.MANUFACTURING

KPIS = (
    KPIDefinition(
        "defect_rate", "Defect Rate",
        "Share of units failing inspection.",
        (D,), ("defect_flag",), rate_of("defect_flag"),
        unit="percent", higher_is_better=False, additive=False,
        formula="defective units / units produced", priority=12, tags=("quality",),
    ),
    KPIDefinition(
        "total_output", "Units Produced",
        "Total units completed in the period.",
        (D,), ("output",), sum_of("output"),
        unit="number", additive=True, formula="SUM(output)",
        priority=14, tags=("throughput",),
    ),
    KPIDefinition(
        "average_downtime", "Average Downtime",
        "Mean unplanned stoppage per production record.",
        (D,), ("downtime",), mean_of("downtime"),
        unit="number", higher_is_better=False, additive=False,
        formula="AVG(downtime)", priority=20, tags=("reliability",),
    ),
)

PLUGIN = DomainPlugin(
    key="manufacturing",
    domain=D,
    label="Manufacturing Operations",
    description=(
        "Line, shift and supplier analytics. Yield is read against downtime so a "
        "throughput fall is always separated into capacity lost and quality lost."
    ),
    kpis=KPIS,
    priority_dimensions=("product_id", "region", "segment", "status"),
    root_cause_hints=(
        RootCauseHint(
            "total_output", ("product_id", "region", "segment"), ("defect_flag",),
            "Output decomposes by line and site. Defects reduce sellable yield but are "
            "analysed on the quality branch to keep the two effects separable.",
        ),
        RootCauseHint("defect_rate", ("product_id", "region", "status")),
        RootCauseHint("average_downtime", ("product_id", "region")),
    ),
    rules=(
        PluginRule(
            "manufacturing.defect_spike", "defect_rate", "up", 10.0,
            "Investigate the increase in defects",
            "Isolate the affected line, shift and supplier lot, and check whether the "
            "change coincides with a material or tooling change.",
            category="quality", urgency=0.93, effort="medium", horizon="this week",
            success_measure="Defect rate returns inside its statistical control limits.",
            rationale="Defect cost compounds through rework, scrap and warranty.",
        ),
        PluginRule(
            "manufacturing.downtime_growth", "average_downtime", "up", 12.0,
            "Investigate rising unplanned downtime",
            "Rank stoppages by asset and cause code to separate a maintenance backlog "
            "from a single failing asset.",
            category="reliability", urgency=0.87, effort="medium",
            success_measure="Unplanned downtime returns to the maintenance plan baseline.",
        ),
        PluginRule(
            "manufacturing.output_shortfall", "total_output", "down", 7.0,
            "Investigate the production shortfall",
            "Split the shortfall into hours lost and yield lost before adjusting the "
            "schedule; only one of the two is recoverable with overtime.",
            category="throughput", urgency=0.85, effort="medium",
        ),
    ),
    forecast=ForecastSettings(
        horizon=4, seasonal_period=12, min_history=12,
        note="Production plans are set monthly; a four-period horizon covers the cycle.",
    ),
    playbook=RecommendationPlaybook(
        owners={
            "quality": "Head of Quality Assurance",
            "reliability": "Maintenance Manager",
            "throughput": "Plant Manager",
            "efficiency": "Continuous Improvement Lead",
        },
        approval_authority="Operations Director",
        approval_impact_threshold=200_000.0,
        approval_categories=("quality",),
        review_cadence="daily production stand-up",
    ),
    glossary={
        "yield": "Share of started units that pass inspection.",
        "OEE": "Overall equipment effectiveness - availability x performance x quality.",
        "cause code": "Standardised reason recorded against a stoppage.",
    },
)
