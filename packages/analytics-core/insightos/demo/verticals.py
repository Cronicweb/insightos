"""Four more demo verticals, each with a planted business truth.

These follow the same contract as :mod:`insightos.demo.generators` - a frame, a
machine-checkable ``ground_truth`` and a one-line story - so the same validation
harness proves the engine recovers the cause it was never told about.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .generators import DemoDataset, _month_end, _seasonal

__all__ = [
    "generate_retail",
    "generate_healthcare",
    "generate_hr",
    "generate_manufacturing",
]


def _months(end: "str | pd.Timestamp | None", months: int) -> pd.DatetimeIndex:
    last = _month_end(end)
    return pd.date_range(end=last, periods=months, freq="ME")


# --------------------------------------------------------------------------- #
def generate_retail(seed: int = 11, months: int = 18,
                    end: "str | pd.Timestamp | None" = None) -> DemoDataset:
    """Omnichannel store network.

    Planted truth: gross margin collapses in the final month because the Home
    category was discounted far harder in the North stores. Units sold actually
    *rose*, so a revenue-only view hides the damage - the engine has to reach
    the discount depth, not the top line.
    """
    rng = np.random.default_rng(seed)
    periods = _months(end, months)
    stores = ["North", "South", "East", "West"]
    categories = ["Home", "Apparel", "Electronics", "Grocery"]
    channels = ["Store", "Online", "Marketplace"]

    rows = []
    for i, day in enumerate(periods):
        season = _seasonal(np.array([i]), 12.0, 0.12)[0]
        final = i == len(periods) - 1
        for store in stores:
            for category in categories:
                for channel in channels:
                    n = int(rng.integers(60, 130))
                    units = rng.poisson(9, n) + 1
                    unit_price = {
                        "Home": 88.0, "Apparel": 42.0,
                        "Electronics": 260.0, "Grocery": 18.0,
                    }[category] * rng.normal(1.0, 0.05, n)
                    unit_cost = unit_price * rng.normal(0.62, 0.03, n)

                    discount = rng.beta(2, 12, n) * 0.35
                    if final and category == "Home" and store == "North":
                        discount = np.clip(discount + rng.normal(0.28, 0.04, n), 0, 0.75)
                        units = units + rng.poisson(4, n)

                    gross = units * unit_price * season
                    revenue = gross * (1 - discount)
                    cost = units * unit_cost
                    returned = rng.random(n) < (0.03 + 0.05 * discount)

                    rows.append(pd.DataFrame({
                        "order_date": day,
                        "order_id": [f"RT-{i:02d}-{store[:1]}{category[:2]}{channel[:1]}-{k:05d}"
                                     for k in range(n)],
                        "customer_id": [f"CUST-{int(v):07d}"
                                        for v in rng.integers(1, 90_000, n)],
                        "region": store,
                        "category": category,
                        "channel": channel,
                        "quantity": units,
                        "unit_price": np.round(unit_price, 2),
                        "discount_rate": np.round(discount, 4),
                        "revenue": np.round(revenue, 2),
                        "cost_of_goods": np.round(cost, 2),
                        "gross_profit": np.round(revenue - cost, 2),
                        "return_flag": returned.astype(int),
                    }))

    frame = pd.concat(rows, ignore_index=True)
    return DemoDataset(
        key="retail",
        name="Retail store network",
        description=("18 months of omnichannel line items across four store regions, "
                     "four categories and three channels, with unit economics."),
        domain_hint="ecommerce",
        frame=frame,
        ground_truth={
            "expected_metric": "gross_margin_pct",
            "expected_direction": "down",
            "expected_top_dimension": "category",
            "expected_top_segment": "Home",
            "planted_effects": [
                "Home category discounted ~28pp deeper in North stores in the final month",
                "Units sold increased - volume is NOT the cause",
                "Revenue barely moves; the damage is in margin, not sales",
            ],
        },
        story=("Sales look healthy and units are up, yet profit falls. The engine must "
               "separate volume from margin and land on discount depth in one category."),
    )


# --------------------------------------------------------------------------- #
def generate_healthcare(seed: int = 13, months: int = 18,
                        end: "str | pd.Timestamp | None" = None) -> DemoDataset:
    """Hospital group admissions.

    Planted truth: 30-day readmissions spike in Cardiology at the Riverside site
    in the final month, alongside a shorter average length of stay - a discharge
    policy change, not a sicker cohort. Staffing ratios are unchanged.
    """
    rng = np.random.default_rng(seed)
    periods = _months(end, months)
    sites = ["Riverside", "Northgate", "Lakeview"]
    departments = ["Cardiology", "Orthopaedics", "Oncology", "General Medicine"]
    payers = ["Commercial", "Medicare", "Medicaid", "Self-pay"]

    # The discharge policy is rolled out over the final quarter, deepest at the
    # site that piloted it. A single-month, single-site jump would sit inside
    # sampling noise and would be an unfair test of the engine.
    ramp = {len(periods) - 3: 0.35, len(periods) - 2: 0.70, len(periods) - 1: 1.0}
    site_intensity = {"Riverside": 1.0, "Northgate": 0.7, "Lakeview": 0.55}

    rows = []
    for i, day in enumerate(periods):
        stage = ramp.get(i, 0.0)
        for site in sites:
            for dept in departments:
                n = int(rng.integers(70, 140))
                base_los = {"Cardiology": 5.2, "Orthopaedics": 3.4,
                            "Oncology": 6.8, "General Medicine": 4.1}[dept]
                los = np.clip(rng.gamma(4.0, base_los / 4.0, n), 0.5, 40)
                readmit_p = 0.085 + 0.004 * (los < 2.5)

                if stage and dept == "Cardiology":
                    force = stage * site_intensity[site]
                    los = np.clip(los * (1.0 - 0.40 * force), 0.5, 40)
                    readmit_p = 0.085 + 0.30 * force

                readmit = rng.random(n) < readmit_p
                cost = los * rng.normal(1850, 180, n)

                rows.append(pd.DataFrame({
                    "admission_date": day,
                    "encounter_id": [f"ENC-{i:02d}-{site[:2]}{dept[:2]}-{k:05d}"
                                     for k in range(n)],
                    "patient_id": [f"PAT-{int(v):07d}" for v in rng.integers(1, 60_000, n)],
                    "region": site,
                    "department": dept,
                    "payer": rng.choice(payers, n, p=[0.42, 0.31, 0.19, 0.08]),
                    "length_of_stay": np.round(los, 2),
                    "readmission_flag": readmit.astype(int),
                    "treatment_cost": np.round(cost, 2),
                    "satisfaction_score": np.round(
                        np.clip(rng.normal(8.4 - 1.6 * readmit, 0.9, n), 1, 10), 1),
                    "staffed_beds": int(rng.integers(40, 90)),
                }))

    frame = pd.concat(rows, ignore_index=True)
    return DemoDataset(
        key="healthcare",
        name="Hospital group operations",
        description=("18 months of inpatient encounters across three sites and four "
                     "departments, with length of stay, readmission and cost."),
        domain_hint="healthcare",
        frame=frame,
        ground_truth={
            "expected_metric": "readmission_rate",
            "expected_direction": "up",
            "expected_top_dimension": "department",
            "expected_top_segment": "Cardiology",
            "planted_effects": [
                "Cardiology readmissions climb from ~9% to ~35% over the final quarter",
                "The rollout is deepest at Riverside and shallowest at Lakeview",
                "Average length of stay falls ~40% in the same cells - early discharge",
                "Staffed beds unchanged - capacity is NOT the cause",
            ],
        },
        story=("Readmissions jump while length of stay falls. The engine must connect "
               "the two and localise the change to a single department at one site."),
    )


# --------------------------------------------------------------------------- #
def generate_hr(seed: int = 17, months: int = 18,
                end: "str | pd.Timestamp | None" = None) -> DemoDataset:
    """Workforce and attrition.

    Planted truth: regretted attrition spikes among early-tenure Engineering staff
    in the final month, concentrated in the lowest compensation quartile.
    Engagement scores had already softened a quarter earlier - a leading indicator.
    """
    rng = np.random.default_rng(seed)
    periods = _months(end, months)
    departments = ["Engineering", "Sales", "Operations", "Finance", "Support"]
    levels = ["Junior", "Mid", "Senior", "Lead"]
    regions = ["EMEA", "AMER", "APAC"]

    rows = []
    for i, day in enumerate(periods):
        final = i == len(periods) - 1
        late = i >= len(periods) - 4
        for dept in departments:
            for level in levels:
                n = int(rng.integers(45, 95))
                tenure = np.clip(rng.gamma(2.0, 1.4, n), 0.1, 18)
                base = {"Junior": 62_000, "Mid": 92_000,
                        "Senior": 128_000, "Lead": 168_000}[level]
                salary = base * rng.normal(1.0, 0.13, n)
                engagement = np.clip(rng.normal(7.6, 1.1, n), 1, 10)

                attrition_p = 0.018 + 0.02 * (tenure < 1.5)
                if late and dept == "Engineering":
                    engagement = np.clip(engagement - 1.4, 1, 10)
                if final and dept == "Engineering":
                    low_pay = salary < np.quantile(salary, 0.25)
                    attrition_p = np.where((tenure < 2.0) & low_pay, 0.31, attrition_p)

                left = rng.random(n) < attrition_p

                rows.append(pd.DataFrame({
                    "period": day,
                    "employee_id": [f"EMP-{i:02d}-{dept[:2]}{level[:1]}-{k:05d}"
                                    for k in range(n)],
                    "region": regions[int(rng.integers(0, 3))],
                    "department": dept,
                    "level": level,
                    "tenure_years": np.round(tenure, 2),
                    "salary": np.round(salary, 2),
                    "engagement_score": np.round(engagement, 2),
                    "training_hours": np.round(np.clip(rng.normal(14, 6, n), 0, 60), 1),
                    "churn_flag": left.astype(int),
                    "headcount": 1,
                }))

    frame = pd.concat(rows, ignore_index=True)
    return DemoDataset(
        key="hr",
        name="Workforce and attrition",
        description=("18 monthly workforce snapshots across five departments and four "
                     "levels, with tenure, compensation, engagement and exits."),
        domain_hint="hr",
        frame=frame,
        ground_truth={
            "expected_metric": "attrition_rate",
            "expected_direction": "up",
            "expected_top_dimension": "department",
            "expected_top_segment": "Engineering",
            "planted_effects": [
                "Engineering attrition rises sharply in the final month",
                "Concentrated in sub-2-year tenure, bottom compensation quartile",
                "Engagement had already fallen ~1.4 points a quarter earlier",
            ],
        },
        story=("Attrition spikes in one function. The engine must find the tenure and "
               "pay band it sits in, and surface the engagement decline that preceded it."),
    )


# --------------------------------------------------------------------------- #
def generate_manufacturing(seed: int = 19, months: int = 18,
                           end: "str | pd.Timestamp | None" = None) -> DemoDataset:
    """Plant throughput and quality.

    Planted truth: yield collapses on Line 3 at the Aurora plant in the final
    month because unplanned downtime and the scrap rate both jump after a
    supplier change. Shift pattern and headcount are unchanged.
    """
    rng = np.random.default_rng(seed)
    periods = _months(end, months)
    plants = ["Aurora", "Fairview", "Brookline"]
    lines = ["Line 1", "Line 2", "Line 3", "Line 4"]
    shifts = ["Day", "Night"]
    suppliers = ["Alloy Co", "Northmet", "Corex"]

    rows = []
    for i, day in enumerate(periods):
        final = i == len(periods) - 1
        for plant in plants:
            for line in lines:
                for shift in shifts:
                    n = int(rng.integers(40, 80))
                    planned = rng.normal(1_800, 120, n)
                    downtime = np.clip(rng.gamma(2.0, 1.6, n), 0, 40)
                    scrap = np.clip(rng.beta(2, 60, n), 0, 0.5)
                    supplier = rng.choice(suppliers, n, p=[0.5, 0.3, 0.2])

                    if final and plant == "Aurora" and line == "Line 3":
                        downtime = np.clip(downtime + rng.normal(14, 3, n), 0, 60)
                        scrap = np.clip(scrap + rng.normal(0.12, 0.02, n), 0, 0.6)
                        supplier = np.array(["Corex"] * n)

                    output = np.clip(planned * (1 - downtime / 160.0) * (1 - scrap), 0, None)

                    rows.append(pd.DataFrame({
                        "production_date": day,
                        "batch_id": [f"BAT-{i:02d}-{plant[:2]}{line[-1]}{shift[:1]}-{k:05d}"
                                     for k in range(n)],
                        "region": plant,
                        "line": line,
                        "shift": shift,
                        "supplier": supplier,
                        "planned_units": np.round(planned, 1),
                        "output_units": np.round(output, 1),
                        "downtime_minutes": np.round(downtime, 2),
                        "scrap_rate": np.round(scrap, 4),
                        "defect_flag": (rng.random(n) < (0.02 + scrap)).astype(int),
                        "unit_cost": np.round(rng.normal(11.4, 0.8, n), 2),
                    }))

    frame = pd.concat(rows, ignore_index=True)
    return DemoDataset(
        key="manufacturing",
        name="Plant throughput and quality",
        description=("18 months of batch-level production across three plants, four "
                     "lines and two shifts, with downtime, scrap and yield."),
        domain_hint="manufacturing",
        frame=frame,
        ground_truth={
            "expected_metric": "average_downtime",
            "expected_direction": "up",
            "expected_top_dimension": "line",
            "expected_top_segment": "Line 3",
            "planted_effects": [
                "Aurora Line 3 unplanned downtime rises ~14 minutes per batch",
                "Scrap rate rises ~12pp on the same line after a supplier switch to Corex",
                "Shift mix and planned units unchanged - scheduling is NOT the cause",
            ],
        },
        story=("Output falls at one plant. The engine must attribute the loss between "
               "downtime and scrap, and tie both to a single line and supplier."),
    )
