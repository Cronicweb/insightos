"""Column -> business role resolution.

A KPI definition should never hard-code column names.  Instead it declares the
*roles* it needs ("revenue", "customer_id", "date") and this resolver maps the
actual columns of an arbitrary dataset onto those roles using name evidence,
semantic type and distributional sanity checks.  That indirection is what makes
the KPI engine work on a dataset it has never seen.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any

import pandas as pd

from ..profiling.schema import TableSchema
from ..types import SemanticType, to_jsonable

__all__ = ["Role", "ResolvedRole", "RoleMap", "resolve_roles", "ROLE_PATTERNS"]


class Role(str):
    """Namespace of canonical roles (a plain str subclass keeps JSON simple)."""


# role -> (regex, allowed semantic types, weight boost)
ROLE_PATTERNS: dict[str, tuple[str, set[SemanticType], float]] = {
    # money
    "revenue": (r"^(revenue|sales|net_?sales|gross_?sales|total_?amount|amount|sales_?amount|"
                r"order_?value|gmv|turnover|billing|invoice_?amount|transaction_?amount|line_?total)$",
                {SemanticType.CURRENCY, SemanticType.NUMERIC}, 1.0),
    "profit": (r"^(profit|net_?profit|gross_?profit|margin_?amount|contribution|earnings|net_?income)$",
               {SemanticType.CURRENCY, SemanticType.NUMERIC}, 1.0),
    "cost": (r"^(cost|cogs|cost_?of_?goods|total_?cost|unit_?cost|expense|expenses|spend|opex)$",
             {SemanticType.CURRENCY, SemanticType.NUMERIC}, 1.0),
    "discount": (r"^(discount|discount_?amount|discount_?pct|promo_?discount|markdown)$",
                 {SemanticType.CURRENCY, SemanticType.NUMERIC, SemanticType.PERCENTAGE}, 1.0),
    "price": (r"^(price|unit_?price|list_?price|selling_?price|rate)$",
              {SemanticType.CURRENCY, SemanticType.NUMERIC}, 1.0),
    "quantity": (r"^(quantity|qty|units|units_?sold|volume|item_?count|line_?qty)$",
                 {SemanticType.COUNT, SemanticType.NUMERIC}, 1.0),
    "marketing_spend": (r"^(marketing_?spend|ad_?spend|campaign_?spend|media_?spend|budget|spend|cost)$",
                        {SemanticType.CURRENCY, SemanticType.NUMERIC}, 1.0),
    # marketing funnel
    "impressions": (r"^(impressions|views|reach|displays)$",
                    {SemanticType.COUNT, SemanticType.NUMERIC}, 1.0),
    "clicks": (r"^(clicks|link_?clicks|taps)$", {SemanticType.COUNT, SemanticType.NUMERIC}, 1.0),
    "conversions": (r"^(conversions|conversion|purchases|signups|sign_?ups|leads|installs|orders)$",
                    {SemanticType.COUNT, SemanticType.NUMERIC}, 1.0),
    "sessions": (r"^(sessions|visits|traffic|users|unique_?visitors)$",
                 {SemanticType.COUNT, SemanticType.NUMERIC}, 1.0),
    # entities
    "customer_id": (r"^(customer_?id|cust_?id|client_?id|account_?id|user_?id|member_?id|"
                    r"cardholder_?id|patient_?id|employee_?id)$",
                    {SemanticType.IDENTIFIER, SemanticType.CATEGORICAL, SemanticType.NUMERIC,
                     SemanticType.ORDINAL}, 1.0),
    "order_id": (r"^(order_?id|transaction_?id|txn_?id|invoice_?id|receipt_?id|sale_?id|"
                 r"payment_?id|booking_?id)$",
                 {SemanticType.IDENTIFIER, SemanticType.CATEGORICAL, SemanticType.NUMERIC}, 1.0),
    "product_id": (r"^(product_?id|sku|item_?id|product|item|product_?name)$",
                   {SemanticType.IDENTIFIER, SemanticType.CATEGORICAL}, 1.0),
    "merchant_id": (r"^(merchant_?id|merchant|vendor_?id|supplier_?id|store_?id|seller_?id)$",
                    {SemanticType.IDENTIFIER, SemanticType.CATEGORICAL}, 1.0),
    "campaign_id": (r"^(campaign_?id|campaign|campaign_?name|ad_?group|creative)$",
                    {SemanticType.IDENTIFIER, SemanticType.CATEGORICAL}, 1.0),
    "employee_id": (r"^(employee_?id|emp_?id|staff_?id|worker_?id)$",
                    {SemanticType.IDENTIFIER, SemanticType.CATEGORICAL, SemanticType.NUMERIC}, 1.0),
    # dimensions
    "region": (r"^(region|territory|zone|area|market|geo|country|state|city|branch|location)$",
               {SemanticType.CATEGORICAL, SemanticType.GEO}, 1.0),
    "segment": (r"^(segment|customer_?segment|tier|plan|category|customer_?type|class|"
                r"cohort|persona|department|dept|division|business_?unit|team|"
                r"specialty|speciality|ward|line|production_?line|work_?center)$",
                {SemanticType.CATEGORICAL, SemanticType.ORDINAL}, 1.0),
    "channel": (r"^(channel|source|medium|acquisition_?channel|platform|device|sales_?channel)$",
                {SemanticType.CATEGORICAL}, 1.0),
    "status": (r"^(status|state|order_?status|payment_?status|stage|outcome|result|disposition)$",
               {SemanticType.CATEGORICAL, SemanticType.BOOLEAN}, 1.0),
    # flags / rates
    "churn_flag": (r"^(churn|churned|is_?churn|churn_?flag|attrition|attrition_?flag|left|exited|terminated)$",
                   {SemanticType.BOOLEAN, SemanticType.ORDINAL, SemanticType.CATEGORICAL,
                    SemanticType.NUMERIC, SemanticType.COUNT}, 1.0),
    "fraud_flag": (r"^(fraud|is_?fraud|fraud_?flag|fraudulent|chargeback|dispute)$",
                   {SemanticType.BOOLEAN, SemanticType.ORDINAL, SemanticType.CATEGORICAL,
                    SemanticType.NUMERIC, SemanticType.COUNT}, 1.0),
    "return_flag": (r"^(returned|is_?return|return_?flag|refund|refunded|cancelled|canceled)$",
                    {SemanticType.BOOLEAN, SemanticType.ORDINAL, SemanticType.CATEGORICAL,
                    SemanticType.NUMERIC, SemanticType.COUNT}, 1.0),
    "defect_flag": (r"^(defect|is_?defect|defect_?flag|failed|rejected|scrap|ng)$",
                    {SemanticType.BOOLEAN, SemanticType.ORDINAL, SemanticType.CATEGORICAL,
                    SemanticType.NUMERIC, SemanticType.COUNT}, 1.0),
    "new_customer_flag": (r"^(is_?new|new_?customer|first_?purchase|acquisition_?flag)$",
                          {SemanticType.BOOLEAN, SemanticType.ORDINAL, SemanticType.CATEGORICAL,
                    SemanticType.NUMERIC, SemanticType.COUNT}, 1.0),
    "satisfaction": (r"^(satisfaction|nps|csat|rating|score|review_?score|feedback)$",
                     {SemanticType.NUMERIC, SemanticType.ORDINAL}, 1.0),
    # hr / healthcare / manufacturing
    "salary": (r"^(salary|compensation|pay|wage|ctc|annual_?salary)$",
               {SemanticType.CURRENCY, SemanticType.NUMERIC}, 1.0),
    "tenure": (r"^(tenure|years_?of_?service|months_?employed|seniority)$",
               {SemanticType.NUMERIC, SemanticType.COUNT}, 1.0),
    "length_of_stay": (r"^(length_?of_?stay|los|days_?admitted|stay_?days)$",
                       {SemanticType.NUMERIC, SemanticType.COUNT}, 1.0),
    "readmission_flag": (r"^(readmitted|readmission|readmission_?flag|is_?readmit)$",
                         {SemanticType.BOOLEAN, SemanticType.ORDINAL, SemanticType.CATEGORICAL,
                    SemanticType.NUMERIC, SemanticType.COUNT}, 1.0),
    "downtime": (r"^(downtime|downtime_?minutes|stoppage|idle_?time)$",
                 {SemanticType.NUMERIC, SemanticType.COUNT}, 1.0),
    "output": (r"^(output|produced|production|units_?produced|throughput)$",
               {SemanticType.NUMERIC, SemanticType.COUNT}, 1.0),
    # time
    "date": (r"^(date|order_?date|transaction_?date|txn_?date|created_?at|timestamp|"
             r"event_?date|invoice_?date|posting_?date|day|period|month)$",
             {SemanticType.DATE, SemanticType.DATETIME}, 1.0),
}

_FUZZY_BOOST = 0.55   # score when the role name merely appears inside the column name


@dataclass
class ResolvedRole:
    role: str
    column: str
    confidence: float
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


class RoleMap(dict):
    """Mapping of role -> column name with the resolution audit trail attached."""

    def __init__(self, resolved: list[ResolvedRole]):
        super().__init__({r.role: r.column for r in resolved})
        self.resolved = resolved

    def has(self, *roles: str) -> bool:
        return all(r in self for r in roles)

    def explain(self) -> list[dict[str, Any]]:
        return [r.to_dict() for r in self.resolved]


def _normalise(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")


def resolve_roles(df: pd.DataFrame, schema: TableSchema) -> RoleMap:
    """Assign at most one column per role, best match wins.

    Confidence combines: exact-vs-fuzzy name match, semantic type agreement and
    value sanity (e.g. a "revenue" column must not be mostly negative, a flag
    role must be near-binary).
    """
    candidates: dict[str, list[ResolvedRole]] = {}
    for col in schema.columns:
        norm = _normalise(col.name)
        for role, (pattern, allowed_types, weight) in ROLE_PATTERNS.items():
            exact = re.fullmatch(pattern, norm) is not None
            fuzzy = bool(re.search(pattern.strip("^$"), norm)) if not exact else False
            if not exact and not fuzzy:
                continue
            if col.semantic_type not in allowed_types:
                continue
            score = (1.0 if exact else _FUZZY_BOOST) * weight
            reason = f"name {'exactly matches' if exact else 'contains'} the {role} pattern"

            # value-level sanity checks
            if role in {"revenue", "price", "quantity", "cost", "marketing_spend"}:
                if col.negatives and col.count and col.negatives / col.count > 0.4:
                    score -= 0.35
                    reason += "; penalised: mostly negative values"
                if col.is_constant:
                    continue
            if role.endswith("_flag"):
                if col.unique > 2:
                    score -= 0.5
                    reason += "; penalised: not binary"
                else:
                    score += 0.15
            if role in {"customer_id", "order_id", "product_id", "merchant_id"}:
                if col.unique <= 1:
                    continue
                if role == "order_id" and col.is_unique:
                    score += 0.2
                if role == "customer_id" and 0 < col.unique_pct < 95:
                    score += 0.1
            if role == "date" and not col.candidate_time:
                continue
            if score <= 0.2:
                continue
            candidates.setdefault(role, []).append(
                ResolvedRole(role, col.name, round(min(score, 1.0), 3), reason)
            )

    resolved: list[ResolvedRole] = []
    taken: set[str] = set()
    # roles with the single strongest candidate are assigned first
    ordered = sorted(candidates.items(), key=lambda kv: -max(c.confidence for c in kv[1]))
    for role, cands in ordered:
        cands.sort(key=lambda c: -c.confidence)
        for cand in cands:
            # a column may serve two roles only when they are compatible
            if cand.column in taken and role not in {"marketing_spend", "cost", "conversions"}:
                continue
            resolved.append(cand)
            taken.add(cand.column)
            break

    # fallbacks: if no explicit date/revenue role matched, use the profiler's opinion
    if not any(r.role == "date" for r in resolved) and schema.time_columns:
        resolved.append(ResolvedRole("date", schema.time_columns[0], 0.5,
                                     "fallback: only datetime column in the table"))
    if not any(r.role == "revenue" for r in resolved):
        # A column that already answered to a more specific role is not also the
        # top line. Without this, an HR table reports "revenue fell 19%" when what
        # actually moved was the salary bill, which destroys the report's credibility.
        claimed = {r.column for r in resolved}
        currency_cols = [c for c in schema.columns
                         if c.semantic_type == SemanticType.CURRENCY
                         and not c.is_constant and c.name not in claimed]
        if currency_cols:
            best = max(currency_cols, key=lambda c: (c.mean or 0) * (1 - c.missing_pct / 100))
            resolved.append(ResolvedRole("revenue", best.name, 0.45,
                                         "fallback: largest currency-typed column"))
    return RoleMap(resolved)
