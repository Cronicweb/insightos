"""The KPI catalogue.

Each KPI is declared once, as data: the roles it needs, how to aggregate it over
*any* subset of rows, how to format it and which direction is good.  Because the
aggregator is a pure function of a DataFrame slice, the same definition powers
the KPI cards, the time series, the segment breakdowns and the root-cause
engine - there is no second implementation to drift out of sync.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

import pandas as pd

from ..types import Domain
from .roles import RoleMap

__all__ = ["KPIDefinition", "KPI_REGISTRY", "kpis_for_domain", "get_kpi"]

Aggregator = Callable[[pd.DataFrame, RoleMap], "float | None"]


@dataclass
class KPIDefinition:
    id: str
    label: str
    description: str
    domains: tuple[Domain, ...]
    required_roles: tuple[str, ...]
    aggregate: Aggregator
    unit: str = "number"                 # currency | number | percent | ratio | days
    higher_is_better: bool = True
    additive: bool = True                # can be summed across segments (drives RCA maths)
    formula: str = ""
    priority: int = 50                   # lower = shown first
    tags: tuple[str, ...] = field(default_factory=tuple)

    def available(self, roles: RoleMap) -> bool:
        return roles.has(*self.required_roles)


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _num(frame: pd.DataFrame, col: str) -> pd.Series:
    return pd.to_numeric(frame[col], errors="coerce")


def _sum(role: str) -> Aggregator:
    def agg(frame: pd.DataFrame, roles: RoleMap) -> float | None:
        col = roles.get(role)
        if col is None or col not in frame:
            return None
        v = _num(frame, col).sum()
        return float(v) if pd.notna(v) else None
    return agg


def _mean(role: str) -> Aggregator:
    def agg(frame: pd.DataFrame, roles: RoleMap) -> float | None:
        col = roles.get(role)
        if col is None or col not in frame or frame.empty:
            return None
        v = _num(frame, col).mean()
        return float(v) if pd.notna(v) else None
    return agg


def _nunique(role: str) -> Aggregator:
    def agg(frame: pd.DataFrame, roles: RoleMap) -> float | None:
        col = roles.get(role)
        if col is None or col not in frame:
            return None
        return float(frame[col].nunique())
    return agg


def _rows(frame: pd.DataFrame, roles: RoleMap) -> float | None:
    return float(len(frame))


def _ratio(num_role: str, den_role: str, scale: float = 1.0) -> Aggregator:
    def agg(frame: pd.DataFrame, roles: RoleMap) -> float | None:
        n_col, d_col = roles.get(num_role), roles.get(den_role)
        if not n_col or not d_col or n_col not in frame or d_col not in frame:
            return None
        den = _num(frame, d_col).sum()
        if not den:
            return None
        return float(_num(frame, n_col).sum() / den * scale)
    return agg


def _flag_rate(role: str) -> Aggregator:
    """Share of rows where a boolean-ish flag is truthy."""
    def agg(frame: pd.DataFrame, roles: RoleMap) -> float | None:
        col = roles.get(role)
        if col is None or col not in frame or frame.empty:
            return None
        s = frame[col]
        if s.dtype == bool:
            truthy = s.fillna(False)
        elif pd.api.types.is_numeric_dtype(s):
            truthy = _num(frame, col).fillna(0) > 0
        else:
            truthy = s.astype(str).str.strip().str.lower().isin(
                {"1", "true", "yes", "y", "t", "fraud", "churned", "returned", "defect"}
            )
        return float(truthy.mean() * 100.0)
    return agg


def _order_count(frame: pd.DataFrame, roles: RoleMap) -> float | None:
    col = roles.get("order_id")
    return float(frame[col].nunique()) if col and col in frame else float(len(frame))


def _aov(frame: pd.DataFrame, roles: RoleMap) -> float | None:
    rev = _sum("revenue")(frame, roles)
    orders = _order_count(frame, roles)
    if rev is None or not orders:
        return None
    return float(rev / orders)


def _revenue_per_customer(frame: pd.DataFrame, roles: RoleMap) -> float | None:
    rev = _sum("revenue")(frame, roles)
    col = roles.get("customer_id")
    if rev is None or not col or col not in frame:
        return None
    n = frame[col].nunique()
    return float(rev / n) if n else None


def _repeat_rate(frame: pd.DataFrame, roles: RoleMap) -> float | None:
    col = roles.get("customer_id")
    if not col or col not in frame or frame.empty:
        return None
    order_col = roles.get("order_id")
    counts = (frame.groupby(col)[order_col].nunique() if order_col and order_col in frame
              else frame.groupby(col).size())
    if counts.empty:
        return None
    return float((counts > 1).mean() * 100.0)


def _purchase_frequency(frame: pd.DataFrame, roles: RoleMap) -> float | None:
    col = roles.get("customer_id")
    if not col or col not in frame or frame.empty:
        return None
    customers = frame[col].nunique()
    orders = _order_count(frame, roles) or 0
    return float(orders / customers) if customers else None


def _clv(frame: pd.DataFrame, roles: RoleMap) -> float | None:
    """Simple historic CLV proxy: AOV x purchase frequency x assumed 3-period horizon."""
    aov = _aov(frame, roles)
    freq = _purchase_frequency(frame, roles)
    if aov is None or freq is None:
        return None
    return float(aov * freq * 3.0)


def _gross_margin_pct(frame: pd.DataFrame, roles: RoleMap) -> float | None:
    rev = _sum("revenue")(frame, roles)
    if not rev:
        return None
    profit = _sum("profit")(frame, roles)
    if profit is None:
        cost = _sum("cost")(frame, roles)
        if cost is None:
            return None
        profit = rev - cost
    return float(profit / rev * 100.0)


def _merchant_concentration(frame: pd.DataFrame, roles: RoleMap) -> float | None:
    """Top-5 share of spend - the standard portfolio concentration read."""
    col = roles.get("merchant_id") or roles.get("product_id")
    rev = roles.get("revenue")
    if not col or not rev or col not in frame or rev not in frame or frame.empty:
        return None
    grouped = _num(frame, rev).groupby(frame[col]).sum().sort_values(ascending=False)
    total = grouped.sum()
    if not total:
        return None
    return float(grouped.head(5).sum() / total * 100.0)


def _hhi(frame: pd.DataFrame, roles: RoleMap) -> float | None:
    col = roles.get("merchant_id") or roles.get("segment") or roles.get("region")
    rev = roles.get("revenue")
    if not col or not rev or col not in frame or rev not in frame or frame.empty:
        return None
    grouped = _num(frame, rev).groupby(frame[col]).sum()
    total = grouped.sum()
    if not total:
        return None
    shares = grouped / total
    return float((shares ** 2).sum() * 10000.0)


def _high_value_share(frame: pd.DataFrame, roles: RoleMap) -> float | None:
    """Share of revenue from the top decile of customers (Pareto read)."""
    col, rev = roles.get("customer_id"), roles.get("revenue")
    if not col or not rev or col not in frame or rev not in frame or frame.empty:
        return None
    per_customer = _num(frame, rev).groupby(frame[col]).sum().sort_values(ascending=False)
    if per_customer.empty or per_customer.sum() == 0:
        return None
    top_n = max(1, int(len(per_customer) * 0.10))
    return float(per_customer.head(top_n).sum() / per_customer.sum() * 100.0)


def _discount_depth(frame: pd.DataFrame, roles: RoleMap) -> float | None:
    disc, rev = roles.get("discount"), roles.get("revenue")
    if not disc or not rev or disc not in frame or rev not in frame:
        return None
    d = _num(frame, disc)
    r = _num(frame, rev).sum()
    if not r:
        return None
    if d.max() is not None and d.max() <= 1.5:      # stored as a fraction
        return float(d.mean() * 100.0)
    return float(d.sum() / (r + d.sum()) * 100.0)


def _revenue_per_employee(frame: pd.DataFrame, roles: RoleMap) -> float | None:
    rev = _sum("revenue")(frame, roles)
    col = roles.get("employee_id")
    if rev is None or not col or col not in frame:
        return None
    n = frame[col].nunique()
    return float(rev / n) if n else None


def _fraud_amount_rate(frame: pd.DataFrame, roles: RoleMap) -> float | None:
    flag, rev = roles.get("fraud_flag"), roles.get("revenue")
    if not flag or not rev or flag not in frame or rev not in frame:
        return None
    s = frame[flag]
    truthy = (s.fillna(False) if s.dtype == bool
              else _num(frame, flag).fillna(0) > 0 if pd.api.types.is_numeric_dtype(s)
              else s.astype(str).str.lower().isin({"1", "true", "yes", "fraud"}))
    total = _num(frame, rev).sum()
    if not total:
        return None
    return float(_num(frame, rev)[truthy].sum() / total * 100.0)


# --------------------------------------------------------------------------- #
# registry
# --------------------------------------------------------------------------- #
D = Domain
KPI_REGISTRY: list[KPIDefinition] = [
    # ---------------- universal / sales ---------------- #
    KPIDefinition("revenue", "Revenue", "Total monetary value transacted in the period.",
                  (D.SALES, D.ECOMMERCE, D.FINANCE, D.BANKING, D.MARKETING, D.SAAS, D.GENERIC),
                  ("revenue",), _sum("revenue"), "currency", True, True,
                  "SUM(revenue)", 1, ("north-star",)),
    KPIDefinition("orders", "Orders", "Distinct transactions completed.",
                  (D.SALES, D.ECOMMERCE, D.BANKING, D.GENERIC), ("order_id",),
                  _order_count, "number", True, True, "COUNT(DISTINCT order_id)", 5),
    KPIDefinition("transaction_volume", "Transaction Volume", "Number of transactions processed.",
                  (D.BANKING,), (), _rows, "number", True, True, "COUNT(*)", 4),
    KPIDefinition("units_sold", "Units Sold", "Total quantity of items sold.",
                  (D.SALES, D.ECOMMERCE, D.MANUFACTURING), ("quantity",), _sum("quantity"),
                  "number", True, True, "SUM(quantity)", 12),
    KPIDefinition("aov", "Average Order Value", "Revenue divided by number of orders.",
                  (D.SALES, D.ECOMMERCE, D.BANKING), ("revenue",), _aov, "currency", True,
                  False, "SUM(revenue) / COUNT(DISTINCT order_id)", 6),
    KPIDefinition("gross_profit", "Gross Profit", "Revenue net of cost of goods sold.",
                  (D.SALES, D.FINANCE, D.ECOMMERCE), ("profit",), _sum("profit"),
                  "currency", True, True, "SUM(profit)", 3),
    KPIDefinition("gross_margin_pct", "Gross Margin %", "Profit as a share of revenue.",
                  (D.SALES, D.FINANCE, D.ECOMMERCE), ("revenue",), _gross_margin_pct,
                  "percent", True, False, "SUM(profit) / SUM(revenue)", 7),
    KPIDefinition("customers", "Active Customers", "Distinct customers transacting.",
                  (D.SALES, D.ECOMMERCE, D.BANKING, D.SAAS), ("customer_id",),
                  _nunique("customer_id"), "number", True, False,
                  "COUNT(DISTINCT customer_id)", 8),
    KPIDefinition("revenue_per_customer", "Revenue per Customer",
                  "Average revenue contributed by each active customer.",
                  (D.SALES, D.ECOMMERCE, D.BANKING, D.SAAS), ("revenue", "customer_id"),
                  _revenue_per_customer, "currency", True, False,
                  "SUM(revenue) / COUNT(DISTINCT customer_id)", 9),
    KPIDefinition("repeat_customer_rate", "Repeat Customer Rate",
                  "Share of customers with more than one purchase.",
                  (D.SALES, D.ECOMMERCE, D.BANKING), ("customer_id",), _repeat_rate,
                  "percent", True, False, "customers with >1 order / customers", 10),
    KPIDefinition("purchase_frequency", "Purchase Frequency",
                  "Average number of orders per customer in the period.",
                  (D.SALES, D.ECOMMERCE, D.BANKING), ("customer_id",), _purchase_frequency,
                  "ratio", True, False, "orders / customers", 14),
    KPIDefinition("clv", "Customer Lifetime Value",
                  "Historic CLV proxy: AOV x purchase frequency x 3 periods.",
                  (D.SALES, D.ECOMMERCE, D.SAAS, D.BANKING), ("revenue", "customer_id"),
                  _clv, "currency", True, False, "AOV x frequency x 3", 15),
    KPIDefinition("discount_depth", "Discount Depth",
                  "Average discount as a share of gross value.",
                  (D.SALES, D.ECOMMERCE), ("discount", "revenue"), _discount_depth,
                  "percent", False, False, "SUM(discount) / SUM(gross)", 18),
    KPIDefinition("high_value_customer_share", "Top-Decile Customer Share",
                  "Revenue share held by the top 10% of customers.",
                  (D.SALES, D.BANKING, D.ECOMMERCE), ("revenue", "customer_id"),
                  _high_value_share, "percent", False, False,
                  "revenue(top 10% customers) / revenue", 20),

    # ---------------- marketing ---------------- #
    KPIDefinition("impressions", "Impressions", "Total ad impressions delivered.",
                  (D.MARKETING,), ("impressions",), _sum("impressions"), "number", True,
                  True, "SUM(impressions)", 4),
    KPIDefinition("clicks", "Clicks", "Total clicks generated.",
                  (D.MARKETING,), ("clicks",), _sum("clicks"), "number", True, True,
                  "SUM(clicks)", 5),
    KPIDefinition("ctr", "Click-Through Rate", "Clicks divided by impressions.",
                  (D.MARKETING,), ("clicks", "impressions"),
                  _ratio("clicks", "impressions", 100.0), "percent", True, False,
                  "SUM(clicks) / SUM(impressions)", 2),
    KPIDefinition("conversion_rate", "Conversion Rate", "Conversions divided by clicks.",
                  (D.MARKETING, D.ECOMMERCE), ("conversions", "clicks"),
                  _ratio("conversions", "clicks", 100.0), "percent", True, False,
                  "SUM(conversions) / SUM(clicks)", 3),
    KPIDefinition("marketing_spend", "Marketing Spend", "Total media investment.",
                  (D.MARKETING,), ("marketing_spend",), _sum("marketing_spend"),
                  "currency", False, True, "SUM(spend)", 6),
    KPIDefinition("cpa", "Cost per Acquisition", "Spend divided by conversions.",
                  (D.MARKETING,), ("marketing_spend", "conversions"),
                  _ratio("marketing_spend", "conversions"), "currency", False, False,
                  "SUM(spend) / SUM(conversions)", 7),
    KPIDefinition("cpc", "Cost per Click", "Spend divided by clicks.",
                  (D.MARKETING,), ("marketing_spend", "clicks"),
                  _ratio("marketing_spend", "clicks"), "currency", False, False,
                  "SUM(spend) / SUM(clicks)", 11),
    KPIDefinition("cpm", "Cost per Mille", "Spend per thousand impressions.",
                  (D.MARKETING,), ("marketing_spend", "impressions"),
                  _ratio("marketing_spend", "impressions", 1000.0), "currency", False,
                  False, "SUM(spend) / SUM(impressions) x 1000", 13),
    KPIDefinition("roas", "Return on Ad Spend", "Revenue generated per unit of spend.",
                  (D.MARKETING,), ("revenue", "marketing_spend"),
                  _ratio("revenue", "marketing_spend"), "ratio", True, False,
                  "SUM(revenue) / SUM(spend)", 1, ("north-star",)),

    # ---------------- banking ---------------- #
    KPIDefinition("average_spend", "Average Transaction Value",
                  "Mean value of a single transaction.",
                  (D.BANKING, D.FINANCE), ("revenue",), _mean("revenue"), "currency",
                  True, False, "AVG(amount)", 6),
    KPIDefinition("fraud_rate", "Fraud Rate", "Share of transactions flagged as fraudulent.",
                  (D.BANKING,), ("fraud_flag",), _flag_rate("fraud_flag"), "percent",
                  False, False, "fraud transactions / transactions", 2),
    KPIDefinition("fraud_value_rate", "Fraud Value Rate",
                  "Share of monetary value flagged as fraudulent.",
                  (D.BANKING,), ("fraud_flag", "revenue"), _fraud_amount_rate, "percent",
                  False, False, "fraud amount / total amount", 3),
    KPIDefinition("merchant_concentration", "Merchant Concentration (Top 5)",
                  "Share of spend captured by the five largest merchants.",
                  (D.BANKING,), ("merchant_id", "revenue"), _merchant_concentration,
                  "percent", False, False, "top-5 merchant spend / total spend", 12),
    KPIDefinition("portfolio_hhi", "Portfolio HHI",
                  "Herfindahl-Hirschman index of spend concentration (0-10,000).",
                  (D.BANKING, D.FINANCE), ("revenue",), _hhi, "number", False, False,
                  "SUM(share^2) x 10000", 22),

    # ---------------- retention / churn ---------------- #
    KPIDefinition("churn_rate", "Churn Rate", "Share of customers flagged as churned.",
                  (D.SAAS, D.BANKING, D.ECOMMERCE, D.SALES), ("churn_flag",),
                  _flag_rate("churn_flag"), "percent", False, False,
                  "churned / total", 4),
    KPIDefinition("return_rate", "Return Rate", "Share of orders returned or refunded.",
                  (D.ECOMMERCE, D.SALES), ("return_flag",), _flag_rate("return_flag"),
                  "percent", False, False, "returned orders / orders", 9),

    # ---------------- HR ---------------- #
    KPIDefinition("headcount", "Headcount", "Distinct employees in scope.",
                  (D.HR,), ("employee_id",), _nunique("employee_id"), "number", True,
                  False, "COUNT(DISTINCT employee_id)", 1),
    KPIDefinition("attrition_rate", "Attrition Rate", "Share of employees who left.",
                  (D.HR,), ("churn_flag",), _flag_rate("churn_flag"), "percent", False,
                  False, "leavers / headcount", 2),
    KPIDefinition("average_salary", "Average Salary", "Mean compensation across employees.",
                  (D.HR,), ("salary",), _mean("salary"), "currency", True, False,
                  "AVG(salary)", 5),
    KPIDefinition("average_tenure", "Average Tenure", "Mean length of service.",
                  (D.HR,), ("tenure",), _mean("tenure"), "number", True, False,
                  "AVG(tenure)", 6),
    KPIDefinition("revenue_per_employee", "Revenue per Employee",
                  "Revenue generated per employee.", (D.HR, D.FINANCE),
                  ("revenue", "employee_id"), _revenue_per_employee, "currency", True,
                  False, "SUM(revenue) / headcount", 8),

    # ---------------- healthcare ---------------- #
    KPIDefinition("avg_length_of_stay", "Average Length of Stay",
                  "Mean inpatient days per admission.", (D.HEALTHCARE,),
                  ("length_of_stay",), _mean("length_of_stay"), "days", False, False,
                  "AVG(length_of_stay)", 2),
    KPIDefinition("readmission_rate", "Readmission Rate",
                  "Share of patients readmitted.", (D.HEALTHCARE,), ("readmission_flag",),
                  _flag_rate("readmission_flag"), "percent", False, False,
                  "readmitted / discharged", 1),

    # ---------------- manufacturing ---------------- #
    KPIDefinition("output_units", "Output", "Total units produced.",
                  (D.MANUFACTURING,), ("output",), _sum("output"), "number", True, True,
                  "SUM(output)", 1),
    KPIDefinition("defect_rate", "Defect Rate", "Share of units failing quality control.",
                  (D.MANUFACTURING,), ("defect_flag",), _flag_rate("defect_flag"),
                  "percent", False, False, "defects / units", 2),
    KPIDefinition("downtime", "Downtime", "Total unplanned stoppage time.",
                  (D.MANUFACTURING,), ("downtime",), _sum("downtime"), "number", False,
                  True, "SUM(downtime)", 3),

    # ---------------- experience ---------------- #
    KPIDefinition("satisfaction", "Customer Satisfaction",
                  "Mean satisfaction / rating score.",
                  (D.SALES, D.ECOMMERCE, D.SAAS, D.HEALTHCARE, D.GENERIC),
                  ("satisfaction",), _mean("satisfaction"), "number", True, False,
                  "AVG(score)", 25),

    # ---------------- generic fallback ---------------- #
    KPIDefinition("record_count", "Records", "Number of rows in scope.",
                  (D.GENERIC,), (), _rows, "number", True, True, "COUNT(*)", 90),
]

_BY_ID = {k.id: k for k in KPI_REGISTRY}


def get_kpi(kpi_id: str) -> KPIDefinition | None:
    return _BY_ID.get(kpi_id)


def kpis_for_domain(domain: Domain, roles: RoleMap) -> list[KPIDefinition]:
    """Return the KPIs that are both relevant to the domain and computable here.

    Domain-specific KPIs rank ahead of universal ones; if the domain yields fewer
    than three computable KPIs we fall back to whatever the schema supports so the
    user is never shown an empty dashboard.
    """
    primary = [k for k in KPI_REGISTRY if domain in k.domains and k.available(roles)]
    if len(primary) >= 3:
        return sorted(primary, key=lambda k: (k.priority, k.label))
    extra = [k for k in KPI_REGISTRY
             if k not in primary and k.available(roles) and k.id != "record_count"]
    combined = primary + sorted(extra, key=lambda k: (k.priority, k.label))
    if not combined:
        combined = [_BY_ID["record_count"]]
    return combined[:12]
