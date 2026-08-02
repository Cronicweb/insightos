"""Business-domain classification from schema evidence alone.

InsightOS never asks "what kind of data is this?".  It scores the column names,
the resolved roles and the categorical vocabulary of the dataset against a set
of weighted domain signatures, then reports the winning domain *with the
evidence that produced it* - so an analyst can disagree with a specific signal
rather than with an opaque label.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any

import pandas as pd

from ..profiling.schema import TableSchema
from ..types import Domain, SemanticType, to_jsonable
from .roles import RoleMap

__all__ = ["DomainSignal", "DomainDetection", "detect_domain", "DOMAIN_SIGNATURES"]


# domain -> {token: weight}.  Tokens are matched against normalised column names,
# resolved roles and (for a few high-signal tokens) categorical values.
DOMAIN_SIGNATURES: dict[Domain, dict[str, float]] = {
    Domain.SALES: {
        "revenue": 3.0, "sales": 3.0, "order": 2.5, "quantity": 2.0, "discount": 2.0,
        "profit": 2.0, "customer": 1.5, "product": 1.5, "region": 1.5, "sales_rep": 2.5,
        "pipeline": 2.0, "deal": 2.0, "quota": 2.5, "unit_price": 2.0,
    },
    Domain.MARKETING: {
        "campaign": 3.5, "impressions": 3.5, "clicks": 3.5, "ctr": 3.5, "cpc": 3.0,
        "cpa": 3.0, "roas": 3.5, "ad_spend": 3.0, "conversions": 2.5, "channel": 2.0,
        "utm": 3.0, "creative": 2.5, "audience": 2.0, "reach": 2.0, "lead": 2.0,
    },
    Domain.FINANCE: {
        "expense": 3.0, "budget": 2.5, "gl_account": 3.5, "ledger": 3.5, "cash_flow": 3.5,
        "ebitda": 3.5, "opex": 3.0, "capex": 3.0, "accrual": 3.0, "cost_center": 3.5,
        "fiscal": 2.5, "invoice": 2.0, "payable": 3.0, "receivable": 3.0, "margin": 2.0,
    },
    Domain.BANKING: {
        "transaction": 2.5, "merchant": 3.0, "card": 3.0, "account_balance": 3.0,
        "credit_limit": 3.5, "fraud": 3.5, "chargeback": 3.5, "mcc": 3.5, "swipe": 3.0,
        "atm": 3.0, "interchange": 3.5, "cardholder": 3.5, "authorization": 3.0,
        "delinquency": 3.5, "loan": 2.5, "interest_rate": 2.5, "branch": 2.0,
    },
    Domain.ECOMMERCE: {
        "cart": 3.5, "checkout": 3.5, "sku": 2.5, "basket": 3.0, "shipping": 2.5,
        "delivery": 2.0, "return": 2.0, "wishlist": 3.0, "session": 2.0, "browse": 2.5,
        "coupon": 2.5, "fulfilment": 2.5, "fulfillment": 2.5, "marketplace": 2.5,
    },
    Domain.HR: {
        "employee": 3.5, "salary": 3.0, "attrition": 3.5, "hire": 3.0, "termination": 3.5,
        "department": 2.0, "manager": 2.0, "performance_rating": 3.0, "tenure": 3.0,
        "headcount": 3.5, "recruit": 3.0, "leave": 2.0, "payroll": 3.5, "promotion": 2.5,
    },
    Domain.HEALTHCARE: {
        "patient": 3.5, "diagnosis": 3.5, "admission": 3.0, "discharge": 3.0,
        "readmission": 3.5, "icd": 3.5, "procedure": 2.5, "provider": 2.5, "claim": 2.5,
        "length_of_stay": 3.5, "ward": 3.0, "physician": 3.5, "treatment": 3.0,
    },
    Domain.MANUFACTURING: {
        "production": 3.0, "defect": 3.5, "yield": 3.0, "downtime": 3.5, "machine": 3.0,
        "batch": 2.5, "shift": 2.5, "scrap": 3.5, "oee": 3.5, "throughput": 3.0,
        "plant": 2.5, "line": 1.5, "maintenance": 2.5, "cycle_time": 3.0,
    },
    Domain.SUPPLY_CHAIN: {
        "inventory": 3.5, "warehouse": 3.0, "stock": 2.5, "supplier": 3.0, "lead_time": 3.0,
        "shipment": 3.0, "logistics": 3.0, "backorder": 3.5, "reorder": 3.0,
        "fill_rate": 3.5, "freight": 3.0, "carrier": 2.5,
    },
    Domain.SAAS: {
        "mrr": 3.5, "arr": 3.5, "subscription": 3.5, "churn": 3.0, "trial": 3.0,
        "seat": 2.5, "plan": 2.0, "renewal": 3.0, "activation": 2.5, "dau": 3.5,
        "mau": 3.5, "feature_usage": 3.0, "onboarding": 2.5,
    },
}

# Roles that raise a domain's prior when they are present.
ROLE_EVIDENCE: dict[Domain, dict[str, float]] = {
    Domain.SALES: {"revenue": 2.0, "quantity": 1.5, "order_id": 1.5, "product_id": 1.0},
    Domain.MARKETING: {"impressions": 3.0, "clicks": 3.0, "campaign_id": 2.5,
                       "marketing_spend": 2.0, "conversions": 1.5},
    Domain.FINANCE: {"cost": 2.0, "profit": 2.0, "revenue": 0.5},
    Domain.BANKING: {"merchant_id": 3.0, "fraud_flag": 3.0, "order_id": 0.5},
    Domain.ECOMMERCE: {"return_flag": 2.0, "sessions": 1.5, "product_id": 1.0},
    Domain.HR: {"employee_id": 3.0, "salary": 3.0, "tenure": 2.0, "churn_flag": 1.0},
    Domain.HEALTHCARE: {"length_of_stay": 3.0, "readmission_flag": 3.0},
    Domain.MANUFACTURING: {"defect_flag": 3.0, "downtime": 3.0, "output": 2.0},
    Domain.SUPPLY_CHAIN: {},
    Domain.SAAS: {"churn_flag": 2.0},
}

# High-signal values that appear *inside* categorical columns.
VALUE_EVIDENCE: dict[Domain, set[str]] = {
    Domain.BANKING: {"debit", "credit", "atm", "pos", "wire", "upi", "ach", "visa",
                     "mastercard", "chargeback", "declined", "authorized"},
    Domain.MARKETING: {"google ads", "meta", "facebook", "instagram", "email",
                       "display", "search", "affiliate", "programmatic"},
    Domain.ECOMMERCE: {"delivered", "shipped", "returned", "cart", "checkout", "cod"},
    Domain.HR: {"resigned", "terminated", "promoted", "full-time", "part-time", "intern"},
    Domain.HEALTHCARE: {"inpatient", "outpatient", "emergency", "icu", "discharged"},
    Domain.MANUFACTURING: {"shift a", "shift b", "night shift", "scrap", "rework"},
    Domain.SAAS: {"trial", "monthly", "annual", "enterprise plan", "freemium"},
}


@dataclass
class DomainSignal:
    token: str
    source: str          # column_name | role | value
    weight: float
    matched_in: str

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


@dataclass
class DomainDetection:
    domain: Domain
    confidence: float
    scores: dict[str, float]
    signals: list[DomainSignal] = field(default_factory=list)
    runner_up: Domain | None = None
    rationale: str = ""

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


def _normalise(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(text).strip().lower()).strip("_")


def detect_domain(
    df: pd.DataFrame, schema: TableSchema, roles: RoleMap | None = None
) -> DomainDetection:
    """Classify the business domain of a dataset and explain the decision."""
    scores: dict[Domain, float] = dict.fromkeys(DOMAIN_SIGNATURES, 0.0)
    signals: list[DomainSignal] = []

    normalised_columns = {c.name: _normalise(c.name) for c in schema.columns}

    # 1. column-name evidence
    for domain, tokens in DOMAIN_SIGNATURES.items():
        for token, weight in tokens.items():
            for original, norm in normalised_columns.items():
                if token in norm:
                    scores[domain] += weight
                    signals.append(DomainSignal(token, "column_name", weight, original))

    # 2. resolved-role evidence
    if roles is not None:
        for domain, role_weights in ROLE_EVIDENCE.items():
            for role, weight in role_weights.items():
                if role in roles:
                    scores[domain] += weight
                    signals.append(DomainSignal(role, "role", weight, roles[role]))

    # 3. categorical-value evidence (sampled, cheap)
    cat_cols = [c.name for c in schema.columns
                if c.semantic_type in {SemanticType.CATEGORICAL, SemanticType.GEO}][:12]
    vocabulary: set[str] = set()
    for col in cat_cols:
        try:
            vals = df[col].dropna().astype(str).str.lower().str.strip().unique()[:60]
        except Exception:  # pragma: no cover - defensive on exotic dtypes
            continue
        vocabulary.update(vals.tolist())
    for domain, tokens in VALUE_EVIDENCE.items():
        for token in tokens:
            if any(token in v for v in vocabulary):
                scores[domain] += 1.5
                signals.append(DomainSignal(token, "value", 1.5, "categorical values"))

    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    top, top_score = ranked[0]
    second, second_score = ranked[1] if len(ranked) > 1 else (None, 0.0)

    if top_score < 4.0:
        return DomainDetection(
            Domain.GENERIC, 0.35, {d.value: round(s, 2) for d, s in scores.items()},
            signals[:25], top if top_score > 0 else None,
            "No domain signature reached the evidence threshold; using generic KPIs.",
        )

    total = sum(max(s, 0) for s in scores.values()) or 1.0
    share = top_score / total
    separation = (top_score - second_score) / top_score if top_score else 0.0
    confidence = round(min(0.99, 0.45 * share * 2.2 + 0.55 * separation + 0.15), 3)
    top_signals = sorted(signals, key=lambda s: -s.weight)[:8]
    rationale = (
        f"Classified as {top.value} (score {top_score:.1f} vs "
        f"{second.value if second else 'n/a'} {second_score:.1f}); strongest evidence: "
        + ", ".join(f"{s.token} ({s.source})" for s in top_signals[:5]) + "."
    )
    return DomainDetection(top, confidence, {d.value: round(s, 2) for d, s in scores.items()},
                           top_signals, second, rationale)
