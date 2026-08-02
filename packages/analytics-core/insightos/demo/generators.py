"""Synthetic-but-realistic demo datasets with *planted* business signals.

Each generator embeds a known ground truth - a regional collapse, a churn wave, a
creative-fatigue driven CTR decline - so the engine's output can be validated
against what actually happened rather than merely inspected for plausibility.
The ground truth is returned alongside the frame and is used by the test suite.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

__all__ = ["DemoDataset", "generate_banking", "generate_ecommerce", "generate_marketing",
           "GENERATORS", "generate"]


@dataclass
class DemoDataset:
    key: str
    name: str
    description: str
    domain_hint: str
    frame: pd.DataFrame
    ground_truth: dict[str, Any]
    story: str


def _month_end(end: "str | pd.Timestamp | None") -> pd.Timestamp:
    """Anchor a demo dataset to the end of the most recently completed month.

    Demo data that is two years stale scores badly on the timeliness dimension and
    makes the quality report look broken, so by default the datasets always end
    "last month" relative to whenever they are generated.  Tests pin ``end`` for
    reproducibility.
    """
    if end is not None:
        return pd.Timestamp(end).normalize()
    today = pd.Timestamp.today().normalize()
    return today.replace(day=1) - pd.Timedelta(days=1)


def _seasonal(index: np.ndarray, period: float, amplitude: float) -> np.ndarray:
    return 1.0 + amplitude * np.sin(2 * np.pi * index / period)


# --------------------------------------------------------------------------- #
def generate_banking(seed: int = 7, months: int = 18,
                     end: "str | pd.Timestamp | None" = None) -> DemoDataset:
    """Card-payments portfolio.

    Planted truth: in the final month the East region's Enterprise/SMB card spend
    collapses (a large acquirer outage), fraud rate spikes on one channel, while
    marketing spend and customer acquisition stay flat - so the engine must *rule
    those out* rather than blame them.
    """
    rng = np.random.default_rng(seed)
    end = _month_end(end)
    start = (end - pd.DateOffset(months=months - 1)).replace(day=1)
    days = pd.date_range(start, end, freq="D")

    regions = ["East", "West", "North", "South", "Central"]
    region_w = np.array([0.28, 0.24, 0.18, 0.16, 0.14])
    segments = ["Enterprise", "SMB", "Consumer", "Premium"]
    segment_w = np.array([0.22, 0.26, 0.40, 0.12])
    channels = ["POS", "Online", "Mobile App", "ATM", "Recurring"]
    channel_w = np.array([0.30, 0.28, 0.27, 0.08, 0.07])
    categories = ["Groceries", "Travel", "Fuel", "Dining", "Electronics",
                  "Healthcare", "Utilities", "Entertainment", "Apparel"]
    card_types = ["Platinum", "Gold", "Classic", "Business"]
    tenures = ["New", "0-1y", "1-3y", "3-5y", "5y+"]

    rows: list[dict[str, Any]] = []
    customer_ids = [f"CUST-{i:06d}" for i in range(1, 9001)]
    cust_region = rng.choice(regions, size=len(customer_ids), p=region_w)
    cust_segment = rng.choice(segments, size=len(customer_ids), p=segment_w)
    cust_tenure = rng.choice(tenures, size=len(customer_ids), p=[.08, .17, .30, .25, .20])
    cust_card = rng.choice(card_types, size=len(customer_ids), p=[.18, .27, .40, .15])

    last_month = pd.Period(end, freq="M")
    txn_id = 0
    for i, day in enumerate(days):
        is_last_month = pd.Period(day, freq="M") == last_month
        weekday_lift = 1.15 if day.dayofweek < 5 else 0.82
        month_seasonal = _seasonal(np.array([i]), 365.0, 0.10)[0]
        growth = 1.0 + 0.00055 * i
        base_txns = int(rng.poisson(300 * weekday_lift * month_seasonal * growth))
        for _ in range(base_txns):
            c = int(rng.integers(0, len(customer_ids)))
            region = cust_region[c]
            segment = cust_segment[c]
            channel = str(rng.choice(channels, p=channel_w))
            category = str(rng.choice(categories))

            amount = float(np.exp(rng.normal(3.55, 0.95)))
            amount *= {"Enterprise": 4.4, "SMB": 2.1, "Premium": 2.8, "Consumer": 1.0}[segment]
            amount *= {"Travel": 3.2, "Electronics": 2.6, "Healthcare": 1.8,
                       "Apparel": 1.3, "Dining": 0.9, "Groceries": 1.0,
                       "Fuel": 0.85, "Utilities": 1.1, "Entertainment": 0.8}[category]

            declined = rng.random() < 0.031
            fraud_p = 0.0022
            if is_last_month and channel == "Online":
                fraud_p = 0.0139                      # planted fraud spike
            is_fraud = rng.random() < fraud_p

            keep = True
            if is_last_month and region == "East":
                if segment in ("Enterprise", "SMB"):
                    keep = rng.random() > 0.46        # planted volume collapse
                    amount *= 0.78                    # and ticket-size compression
                else:
                    keep = rng.random() > 0.09
            if is_last_month and segment == "Premium":
                amount *= 1.06                        # planted offsetting growth
            if not keep:
                continue

            txn_id += 1
            interchange = amount * rng.uniform(0.0135, 0.0225)
            rows.append({
                "transaction_id": f"TXN-{txn_id:08d}",
                "transaction_date": day + pd.Timedelta(hours=int(rng.integers(6, 23)),
                                                       minutes=int(rng.integers(0, 60))),
                "customer_id": customer_ids[c],
                "region": region,
                "customer_segment": segment,
                "channel": channel,
                "merchant_category": category,
                "card_type": cust_card[c],
                "customer_tenure": cust_tenure[c],
                "transaction_amount": round(amount, 2),
                "interchange_revenue": round(interchange, 4),
                "is_fraud": bool(is_fraud),
                "is_declined": bool(declined),
                "merchant_id": f"MER-{int(rng.integers(1, 1400)):05d}",
                "acquirer": str(rng.choice(["Acquirer A", "Acquirer B", "Acquirer C"],
                                           p=[0.45, 0.35, 0.20])),
            })

    df = pd.DataFrame(rows)
    # realistic imperfection: a few missing categories and duplicated settlements
    missing_idx = df.sample(frac=0.012, random_state=seed).index
    df.loc[missing_idx, "merchant_category"] = None
    dupes = df.sample(frac=0.004, random_state=seed + 1)
    df = pd.concat([df, dupes], ignore_index=True)
    df = df.sort_values("transaction_date").reset_index(drop=True)

    return DemoDataset(
        key="banking",
        name="Global Card Payments Portfolio",
        description=("18 months of card transactions across five regions, four customer "
                     "segments and five channels, with interchange revenue, fraud and "
                     "decline flags."),
        domain_hint="banking",
        frame=df,
        ground_truth={
            "primary_metric": "transaction_volume",
            "expected_direction": "down",
            "expected_top_dimension": "region",
            "expected_top_segment": "East",
            "expected_secondary_dimension": "customer_segment",
            "expected_secondary_segments": ["Enterprise", "SMB"],
            "expected_offset_segment": "Premium",
            "expected_fraud_channel": "Online",
            "planted_effects": [
                "East region Enterprise/SMB transaction count reduced ~46% in the final month",
                "East region Enterprise/SMB ticket size reduced 22% in the final month",
                "Online channel fraud rate raised from 0.22% to ~1.39% in the final month",
                "Premium segment ticket size raised 6% (an offsetting positive)",
            ],
        },
        story=("Payment volume falls sharply in the final month. The decline is not "
               "portfolio-wide: it is concentrated in East-region Enterprise and SMB "
               "cardholders, while Premium spend actually grew. Fraud on the Online "
               "channel spikes at the same time."),
    )


# --------------------------------------------------------------------------- #
def generate_ecommerce(seed: int = 11, weeks: int = 78,
                       end: "str | pd.Timestamp | None" = None) -> DemoDataset:
    """Direct-to-consumer retail orders.

    Planted truth: a discount-led promotion lifts order volume but destroys margin;
    returning-customer revenue falls in the final month while acquisition holds.
    """
    rng = np.random.default_rng(seed)
    end = _month_end(end)
    start = end - pd.Timedelta(weeks=weeks - 1, days=6)
    days = pd.date_range(start, end, freq="D")

    channels = ["Organic Search", "Paid Search", "Email", "Social", "Affiliate", "Direct"]
    channel_w = np.array([0.24, 0.21, 0.15, 0.17, 0.09, 0.14])
    categories = ["Home & Kitchen", "Apparel", "Electronics", "Beauty", "Sports", "Toys"]
    countries = ["United States", "United Kingdom", "Germany", "India", "Canada", "Australia"]
    country_w = np.array([0.36, 0.16, 0.13, 0.14, 0.11, 0.10])
    devices = ["Desktop", "Mobile", "Tablet"]
    types = ["New", "Returning"]

    rows = []
    order_id = 0
    last_month = pd.Period(end, freq="M")
    for i, day in enumerate(days):
        is_last_month = pd.Period(day, freq="M") == last_month
        seasonal = _seasonal(np.array([i]), 365.0, 0.16)[0]
        weekend = 1.18 if day.dayofweek >= 5 else 1.0
        growth = 1.0 + 0.0009 * i
        n_orders = int(rng.poisson(150 * seasonal * weekend * growth))
        promo = bool(is_last_month and day.day <= 20)
        if promo:
            n_orders = int(n_orders * 1.22)          # promo lifts volume
        for _ in range(n_orders):
            ctype = str(rng.choice(types, p=[0.42, 0.58]))
            if is_last_month and ctype == "Returning" and rng.random() < 0.27:
                continue                              # planted retention weakness
            category = str(rng.choice(categories))
            channel = str(rng.choice(channels, p=channel_w))
            units = int(max(1, rng.poisson(1.7)))
            unit_price = float(np.exp(rng.normal(3.5, 0.62)))
            unit_price *= {"Electronics": 2.6, "Home & Kitchen": 1.3, "Apparel": 1.0,
                           "Beauty": 0.8, "Sports": 1.25, "Toys": 0.75}[category]
            discount = float(np.clip(rng.beta(2, 12), 0, 0.6))
            if promo:
                discount = float(np.clip(rng.beta(4, 10), 0, 0.6))  # planted margin damage
            gross = units * unit_price
            revenue = gross * (1 - discount)
            cogs = gross * rng.uniform(0.52, 0.68)
            shipping = rng.uniform(0, 9.5)
            order_id += 1
            rows.append({
                "order_id": f"ORD-{order_id:07d}",
                "order_date": day,
                "customer_id": f"C-{int(rng.integers(1, 26000)):06d}",
                "customer_type": ctype,
                "country": str(rng.choice(countries, p=country_w)),
                "marketing_channel": channel,
                "product_category": category,
                "device": str(rng.choice(devices, p=[0.34, 0.56, 0.10])),
                "quantity": units,
                "unit_price": round(unit_price, 2),
                "discount_rate": round(discount, 4),
                "revenue": round(revenue, 2),
                "cost_of_goods": round(cogs, 2),
                "shipping_cost": round(shipping, 2),
                "profit": round(revenue - cogs - shipping, 2),
                "is_returned": bool(rng.random() < (0.075 if promo else 0.045)),
            })

    df = pd.DataFrame(rows).sort_values("order_date").reset_index(drop=True)
    df.loc[df.sample(frac=0.008, random_state=seed).index, "device"] = None
    return DemoDataset(
        key="ecommerce",
        name="Direct-to-Consumer Retail Orders",
        description=("18 months of e-commerce orders with revenue, discount, COGS, "
                     "shipping and profit across six markets and six channels."),
        domain_hint="ecommerce",
        frame=df,
        ground_truth={
            "primary_metric": "revenue",
            "expected_top_dimension": "customer_type",
            "expected_top_segment": "Returning",
            "expected_margin_driver": "discount_rate",
            "planted_effects": [
                "Returning-customer orders reduced 27% in the final month",
                "Discount rate raised from ~14% to ~29% for the first 20 days of the final month",
                "Order volume raised 22% during the promotion while profit per order fell",
                "Return rate raised from 4.5% to 7.5% during the promotion",
            ],
        },
        story=("A deep discount campaign lifted order volume but crushed contribution "
               "margin, and returning-customer demand weakened at the same time - the "
               "classic 'we bought revenue we already owned' pattern."),
    )


# --------------------------------------------------------------------------- #
def generate_marketing(seed: int = 23, weeks: int = 60,
                       end: "str | pd.Timestamp | None" = None) -> DemoDataset:
    """Paid-media performance by campaign, creative and platform.

    Planted truth: creative fatigue on a major platform drives CTR and ROAS down in
    the final weeks while spend is *held constant*.
    """
    rng = np.random.default_rng(seed)
    end = _month_end(end)
    start = end - pd.Timedelta(weeks=weeks - 1, days=6)
    days = pd.date_range(start, end, freq="D")

    platforms = ["Google Ads", "Meta", "LinkedIn", "TikTok", "Display Network"]
    objectives = ["Prospecting", "Retargeting", "Brand", "Lifecycle"]
    creatives = ["Video-A", "Video-B", "Carousel-A", "Static-A", "Static-B", "UGC-A"]
    audiences = ["Lookalike 1%", "Interest", "Retarget 30d", "Broad", "Customer List"]
    regions = ["North America", "EMEA", "APAC", "LATAM"]

    rows = []
    last_month = pd.Period(end, freq="M")
    for day in days:
        is_last_month = pd.Period(day, freq="M") == last_month
        for platform in platforms:
            for objective in objectives:
                if rng.random() < 0.22:
                    continue
                creative = str(rng.choice(creatives))
                base_cpm = {"Google Ads": 9.5, "Meta": 7.2, "LinkedIn": 22.0,
                            "TikTok": 6.1, "Display Network": 3.4}[platform]
                spend = float(np.exp(rng.normal(6.4, 0.55)))
                spend *= {"Prospecting": 1.5, "Retargeting": 0.7,
                          "Brand": 1.1, "Lifecycle": 0.5}[objective]
                impressions = int(spend / base_cpm * 1000 * rng.uniform(0.85, 1.15))
                ctr = float(np.clip(rng.normal(
                    {"Google Ads": 0.041, "Meta": 0.019, "LinkedIn": 0.006,
                     "TikTok": 0.014, "Display Network": 0.0035}[platform], 0.0035),
                    0.0004, 0.2))
                ctr *= {"Retargeting": 1.9, "Prospecting": 1.0,
                        "Brand": 0.75, "Lifecycle": 1.5}[objective]
                if is_last_month and platform == "Meta":
                    ctr *= 0.58                       # planted creative fatigue
                clicks = int(rng.binomial(max(impressions, 1), min(ctr, 0.5)))
                cvr = float(np.clip(rng.normal(0.034, 0.009), 0.002, 0.25))
                cvr *= {"Retargeting": 1.7, "Prospecting": 0.85,
                        "Brand": 0.5, "Lifecycle": 1.4}[objective]
                conversions = int(rng.binomial(max(clicks, 1), min(cvr, 0.6)))
                aov = float(np.exp(rng.normal(4.55, 0.35)))
                revenue = conversions * aov
                rows.append({
                    "date": day,
                    "campaign_id": f"CMP-{platform[:3].upper()}-{objective[:4].upper()}",
                    "platform": platform,
                    "objective": objective,
                    "creative": creative,
                    "audience": str(rng.choice(audiences)),
                    "region": str(rng.choice(regions, p=[0.44, 0.27, 0.19, 0.10])),
                    "marketing_spend": round(spend, 2),
                    "impressions": impressions,
                    "clicks": clicks,
                    "conversions": conversions,
                    "revenue": round(revenue, 2),
                })

    df = pd.DataFrame(rows).sort_values("date").reset_index(drop=True)
    return DemoDataset(
        key="marketing",
        name="Paid Media Performance",
        description=("14 months of daily paid-media performance by platform, objective, "
                     "creative, audience and region with spend, impressions, clicks, "
                     "conversions and attributed revenue."),
        domain_hint="marketing",
        frame=df,
        ground_truth={
            "primary_metric": "roas",
            "expected_top_dimension": "platform",
            "expected_top_segment": "Meta",
            "planted_effects": [
                "Meta click-through rate reduced 42% in the final month (creative fatigue)",
                "Spend held constant across all platforms - spend is NOT the cause",
            ],
        },
        story=("Return on ad spend deteriorates while budget is unchanged. The engine "
               "must exonerate spend and locate the collapse in Meta click-through rate."),
    )


GENERATORS = {
    "banking": generate_banking,
    "ecommerce": generate_ecommerce,
    "marketing": generate_marketing,
}


def generate(key: str, **kwargs: Any) -> DemoDataset:
    if key not in GENERATORS:
        raise KeyError(f"unknown demo dataset '{key}'; choose from {sorted(GENERATORS)}")
    return GENERATORS[key](**kwargs)
