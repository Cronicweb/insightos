"""People analytics domain pack."""

from __future__ import annotations

from ..kpi.registry import KPIDefinition
from ..types import Domain
from .aggregators import mean_of, nunique_of, rate_of
from .base import (
    DomainPlugin,
    ForecastSettings,
    PluginRule,
    RecommendationPlaybook,
    RootCauseHint,
)

D = Domain.HR

KPIS = (
    KPIDefinition(
        "attrition_rate", "Attrition Rate",
        "Share of employees who left during the period.",
        (D,), ("churn_flag",), rate_of("churn_flag"),
        unit="percent", higher_is_better=False, additive=False,
        formula="leavers / headcount", priority=12, tags=("retention",),
    ),
    KPIDefinition(
        "headcount", "Headcount",
        "Distinct employees active in the period.",
        (D,), ("employee_id",), nunique_of("employee_id"),
        unit="number", additive=False, formula="COUNT(DISTINCT employee)",
        priority=16, tags=("volume",),
    ),
    KPIDefinition(
        "average_tenure", "Average Tenure",
        "Mean length of service across the active population.",
        (D,), ("tenure",), mean_of("tenure"),
        unit="number", additive=False, formula="AVG(tenure)",
        priority=24, tags=("retention",),
    ),
    KPIDefinition(
        "average_salary", "Average Compensation",
        "Mean compensation across the active population.",
        (D,), ("salary",), mean_of("salary"),
        unit="currency", additive=False, formula="AVG(salary)",
        priority=30, tags=("cost",),
    ),
)

PLUGIN = DomainPlugin(
    key="hr",
    domain=D,
    label="People Analytics",
    description=(
        "Workforce, retention and compensation analytics. Employee identifiers are "
        "masked and small groups are suppressed so no individual is re-identifiable."
    ),
    kpis=KPIS,
    priority_dimensions=("segment", "region", "status"),
    root_cause_hints=(
        RootCauseHint(
            "attrition_rate", ("segment", "region", "status"), ("salary",),
            "Attrition is analysed by department and location. Compensation is reported "
            "as supporting evidence because pay and exit are confounded by seniority.",
        ),
        RootCauseHint("headcount", ("segment", "region")),
    ),
    rules=(
        PluginRule(
            "hr.attrition_spike", "attrition_rate", "up", 12.0,
            "Investigate the increase in attrition",
            "Identify which departments and tenure bands are driving exits, then review "
            "exit interview themes for those groups specifically.",
            category="retention", urgency=0.9, effort="medium", horizon="this quarter",
            success_measure="Attrition returns to the trailing 12-month average.",
            rationale="Replacement cost typically exceeds six months of salary per exit.",
        ),
        PluginRule(
            "hr.tenure_erosion", "average_tenure", "down", 8.0,
            "Investigate falling average tenure",
            "Confirm whether experienced staff are leaving or rapid hiring is diluting "
            "the average - the two require opposite responses.",
            category="retention", urgency=0.75, effort="low",
        ),
    ),
    forecast=ForecastSettings(
        horizon=2, seasonal_period=12, min_history=12,
        note="Workforce series move slowly; short horizons avoid false precision.",
    ),
    playbook=RecommendationPlaybook(
        owners={
            "retention": "Head of People",
            "cost": "Head of Reward",
            "efficiency": "HR Business Partner",
        },
        approval_authority="Chief People Officer",
        approval_impact_threshold=150_000.0,
        approval_categories=("cost",),
        review_cadence="monthly people review",
    ),
    glossary={
        "regretted attrition": "Departures the organisation would have preferred to prevent.",
        "tenure band": "Grouping of employees by length of service.",
        "span of control": "Number of direct reports per manager.",
    },
)
