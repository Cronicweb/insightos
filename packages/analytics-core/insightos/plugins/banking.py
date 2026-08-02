"""Banking / payments domain pack."""

from __future__ import annotations

from ..kpi.registry import KPIDefinition
from ..types import Domain
from .aggregators import per_entity, rate_of
from .base import (
    DomainPlugin,
    ForecastSettings,
    PluginRule,
    RecommendationPlaybook,
    RootCauseHint,
)

D = Domain.BANKING

KPIS = (
    KPIDefinition(
        "fraud_rate", "Fraud Rate",
        "Share of transactions flagged as fraudulent or disputed.",
        (D,), ("fraud_flag",), rate_of("fraud_flag"),
        unit="percent", higher_is_better=False, additive=False,
        formula="fraudulent transactions / transactions", priority=14, tags=("risk",),
    ),
    KPIDefinition(
        "spend_per_cardholder", "Spend per Cardholder",
        "Transacted value divided by distinct cardholders in the period.",
        (D,), ("revenue", "customer_id"), per_entity("revenue", "customer_id"),
        unit="currency", additive=False,
        formula="SUM(amount) / COUNT(DISTINCT cardholder)", priority=22, tags=("engagement",),
    ),
    KPIDefinition(
        "merchant_reach", "Active Merchants",
        "Distinct merchants receiving at least one transaction.",
        (D,), ("merchant_id",),
        lambda frame, roles: (
            float(frame[roles["merchant_id"]].nunique())
            if roles.get("merchant_id") in frame else None
        ),
        unit="number", additive=False, formula="COUNT(DISTINCT merchant)",
        priority=34, tags=("network",),
    ),
)

PLUGIN = DomainPlugin(
    key="banking",
    domain=D,
    label="Banking & Payments",
    description=(
        "Card, account and transaction analytics. Optimised for interchange economics, "
        "merchant concentration and fraud loss - the metrics a payments P&L is run on."
    ),
    kpis=KPIS,
    priority_dimensions=("merchant_id", "segment", "region", "channel", "status"),
    root_cause_hints=(
        RootCauseHint(
            "revenue", ("merchant_id", "segment", "region", "channel"),
            ("fraud_flag",),
            "Transacted value decomposes cleanly by merchant and cardholder segment; "
            "fraud is a loss line, not a driver of gross volume.",
        ),
        RootCauseHint(
            "fraud_rate", ("merchant_id", "channel", "region"), ("segment",),
            "Fraud concentrates in acquiring channels and specific merchants far more "
            "than in cardholder segments.",
        ),
        RootCauseHint("transaction_count", ("merchant_id", "channel", "region")),
    ),
    rules=(
        PluginRule(
            "banking.fraud_spike", "fraud_rate", "up", 15.0,
            "Investigate the rise in fraud rate",
            "Pull the flagged transactions for the affected merchants and channels and "
            "confirm whether the increase is a genuine attack pattern or a change in "
            "how disputes are being coded.",
            category="risk", urgency=0.96, effort="low", horizon="this week",
            success_measure="Fraud rate returns to the trailing 8-period median.",
            rationale="Fraud loss compounds daily; a 15% relative move is outside normal noise.",
        ),
        PluginRule(
            "banking.merchant_concentration", "merchant_reach", "down", 8.0,
            "Investigate merchant attrition",
            "Identify merchants that transacted last period but not this one, and check "
            "whether the loss is seasonal, a pricing change, or competitive displacement.",
            category="retention", urgency=0.85, effort="medium",
            success_measure="Active merchant count recovers to prior-period level.",
        ),
        PluginRule(
            "banking.spend_softening", "spend_per_cardholder", "down", 6.0,
            "Investigate falling spend per cardholder",
            "Separate the fall into fewer transactions per cardholder versus smaller "
            "ticket sizes; the two have different commercial responses.",
            category="growth", urgency=0.8, effort="medium",
        ),
    ),
    forecast=ForecastSettings(
        horizon=3, seasonal_period=12, min_history=12,
        note="Card volume is strongly seasonal; monthly history with a 12-period cycle.",
    ),
    playbook=RecommendationPlaybook(
        owners={
            "risk": "Head of Fraud Risk",
            "retention": "Head of Merchant Relationships",
            "growth": "Head of Cards Portfolio",
            "efficiency": "Payments Operations Lead",
        },
        approval_authority="Chief Risk Officer",
        approval_impact_threshold=500_000.0,
        approval_categories=("risk",),
        review_cadence="weekly risk committee",
    ),
    glossary={
        "merchant concentration": "Share of transacted value flowing through the top merchants.",
        "interchange": "Fee paid by the acquirer to the issuer on each transaction.",
        "chargeback": "A transaction reversed after a cardholder dispute.",
    },
)
