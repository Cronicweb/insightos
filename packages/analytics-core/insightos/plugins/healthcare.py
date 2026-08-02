"""Healthcare operations domain pack."""

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

D = Domain.HEALTHCARE

KPIS = (
    KPIDefinition(
        "readmission_rate", "30-Day Readmission Rate",
        "Share of encounters followed by an unplanned readmission.",
        (D,), ("readmission_flag",), rate_of("readmission_flag"),
        unit="percent", higher_is_better=False, additive=False,
        formula="readmissions / encounters", priority=12, tags=("quality", "regulated"),
    ),
    KPIDefinition(
        "average_length_of_stay", "Average Length of Stay",
        "Mean days between admission and discharge.",
        (D,), ("length_of_stay",), mean_of("length_of_stay"),
        unit="days", higher_is_better=False, additive=False,
        formula="AVG(length_of_stay)", priority=18, tags=("throughput",),
    ),
    KPIDefinition(
        "patients_treated", "Patients Treated",
        "Distinct patients with at least one encounter.",
        (D,), ("customer_id",), nunique_of("customer_id"),
        unit="number", additive=False, formula="COUNT(DISTINCT patient)",
        priority=26, tags=("volume",),
    ),
)

PLUGIN = DomainPlugin(
    key="healthcare",
    domain=D,
    label="Healthcare Operations",
    description=(
        "Encounter, throughput and outcome analytics. Every output is aggregate by "
        "default and patient identifiers are masked before anything is rendered."
    ),
    kpis=KPIS,
    priority_dimensions=("segment", "region", "status", "channel"),
    root_cause_hints=(
        RootCauseHint(
            "readmission_rate", ("segment", "region", "status"), ("length_of_stay",),
            "Readmission varies by service line and site. Length of stay correlates with "
            "readmission but is itself an outcome, so it is reported as supporting "
            "evidence rather than as a cause.",
        ),
        RootCauseHint("average_length_of_stay", ("segment", "region", "status")),
    ),
    rules=(
        PluginRule(
            "healthcare.readmission_rise", "readmission_rate", "up", 10.0,
            "Investigate the rise in readmissions",
            "Break the movement down by service line and discharge disposition, and "
            "confirm the denominator has not shifted because of a coding change.",
            category="quality", urgency=0.95, effort="medium", horizon="this month",
            success_measure="Readmission rate returns below the reporting threshold.",
            rationale="Readmission is a regulated quality measure with direct reimbursement impact.",
        ),
        PluginRule(
            "healthcare.los_drift", "average_length_of_stay", "up", 8.0,
            "Investigate lengthening stays",
            "Check whether the increase is clinical acuity or a discharge bottleneck; "
            "only the second is an operational fix.",
            category="throughput", urgency=0.84, effort="medium",
        ),
    ),
    forecast=ForecastSettings(
        horizon=3, seasonal_period=12, min_history=12,
        note="Admissions are seasonal; forecasts are indicative and never clinical advice.",
    ),
    playbook=RecommendationPlaybook(
        owners={
            "quality": "Chief Medical Officer",
            "throughput": "Director of Operations",
            "efficiency": "Service Line Manager",
        },
        approval_authority="Clinical Governance Board",
        approval_impact_threshold=0.0,
        approval_categories=("quality", "throughput", "risk"),
        review_cadence="clinical governance meeting",
    ),
    glossary={
        "encounter": "A single episode of care.",
        "acuity": "Clinical severity of a patient's condition.",
        "disposition": "Where a patient went after discharge.",
    },
)
