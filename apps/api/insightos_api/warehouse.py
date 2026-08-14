"""Warehouse mode: read-only endpoints over the dbt marts in PostgreSQL.

Design notes
------------
* Additive. The existing engine endpoints are untouched; this router only
  reads the tables that ``dbt build`` (dbt/insightos_warehouse) materialises.
* No business logic beyond SELECTs - funnel rates, ROAS and spam_flag_risk
  are computed (and tested) in the dbt models. Duplicating them here would
  create a second place where rules live, and the two would drift.
* Postgres is optional. If psycopg2 is missing or the database is not
  reachable, every endpoint answers 503 with a reason instead of crashing the
  service, so the default (browser-only) deployment is unaffected.
* Connection settings come from the same INSIGHTOS_PG_* variables the dbt
  profile uses, so one .env configures both sides.
"""
from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, HTTPException, Query

try:  # psycopg2 is only needed for warehouse mode
    import psycopg2
    import psycopg2.extras
except Exception:  # pragma: no cover - import guard
    psycopg2 = None  # type: ignore[assignment]

router = APIRouter(prefix="/warehouse", tags=["warehouse"])

# Marts land in <schema>_marts because dbt_project.yml adds `+schema: marts`
# to the profile's target schema (default `analytics`).
_MARTS = os.getenv("INSIGHTOS_PG_MARTS_SCHEMA", "analytics_marts")


def _conn():
    if psycopg2 is None:
        raise HTTPException(503, "warehouse mode unavailable: psycopg2 is not installed")
    try:
        return psycopg2.connect(
            host=os.getenv("INSIGHTOS_PG_HOST", "localhost"),
            port=int(os.getenv("INSIGHTOS_PG_PORT", "5432")),
            dbname=os.getenv("INSIGHTOS_PG_DBNAME", "insightos"),
            user=os.getenv("INSIGHTOS_PG_USER", "insightos"),
            password=os.getenv("INSIGHTOS_PG_PASSWORD", "insightos"),
            connect_timeout=3,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - surfaced verbatim
        raise HTTPException(503, f"warehouse database not reachable: {exc}") from exc


def _rows(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        try:
            cur.execute(sql, params)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                503,
                "warehouse marts missing - run `dbt build` (or `docker compose --profile "
                f"warehouse up`) first: {exc}",
            ) from exc
        out: list[dict[str, Any]] = []
        for row in cur.fetchall():
            clean: dict[str, Any] = {}
            for k, v in row.items():
                if hasattr(v, "isoformat"):
                    clean[k] = v.isoformat()
                elif v is not None and type(v).__name__ == "Decimal":
                    clean[k] = float(v)
                else:
                    clean[k] = v
            out.append(clean)
        return out


@router.get("/health", summary="Warehouse liveness + mart freshness")
def warehouse_health() -> dict[str, Any]:
    counts = _rows(
        f"""
        select
          (select count(*) from {_MARTS}.fct_campaign_performance)  as campaign_month_rows,
          (select count(*) from {_MARTS}.fct_caller_id_pool_health) as pool_month_rows,
          (select max(call_month) from {_MARTS}.fct_campaign_performance) as latest_month
        """
    )[0]
    return {"status": "ok", "marts_schema": _MARTS, **counts}


@router.get("/summary", summary="Latest-month KPI rollup from the marts")
def warehouse_summary() -> dict[str, Any]:
    kpi = _rows(
        f"""
        with latest as (select max(call_month) as m from {_MARTS}.fct_campaign_performance)
        select
          f.call_month,
          sum(f.dials)           as dials,
          sum(f.connects)        as connects,
          sum(f.qualified_leads) as qualified_leads,
          sum(f.conversions)     as conversions,
          sum(f.spend)           as spend,
          sum(f.revenue)         as revenue,
          round(sum(f.connects)::numeric    / nullif(sum(f.dials), 0),    4) as connect_rate,
          round(sum(f.conversions)::numeric / nullif(sum(f.connects), 0), 4) as conversion_rate,
          round(sum(f.revenue)::numeric     / nullif(sum(f.spend), 0),    2) as roas
        from {_MARTS}.fct_campaign_performance f, latest
        where f.call_month = latest.m
        group by f.call_month
        """
    )
    flagged = _rows(
        f"""
        with latest as (select max(call_month) as m from {_MARTS}.fct_caller_id_pool_health)
        select p.caller_id_pool, d.pool_description, p.connect_rate, p.connect_rate_mom_change
        from {_MARTS}.fct_caller_id_pool_health p
        join latest on p.call_month = latest.m
        left join {_MARTS}.dim_caller_id_pool d using (caller_id_pool)
        where p.spam_flag_risk
        order by p.connect_rate_mom_change asc
        """
    )
    return {"latest_month": kpi[0] if kpi else None, "spam_flag_risks": flagged}


@router.get("/trends", summary="Monthly KPI rollup across campaigns (trend charts + funnel)")
def warehouse_trends(
    months: int = Query(18, ge=1, le=24, description="How many trailing months to return"),
) -> dict[str, Any]:
    """One row per month, aggregated in SQL from fct_campaign_performance.

    Powers the month selector, trend charts and the funnel view. Rates and
    ROAS are recomputed here at the monthly grain with the exact formulas the
    dbt mart uses per campaign - still SELECT-side, never in the browser.
    """
    rows = _rows(
        f"""
        select
          f.call_month,
          sum(f.dials)           as dials,
          sum(f.connects)        as connects,
          sum(f.qualified_leads) as qualified_leads,
          sum(f.conversions)     as conversions,
          sum(f.spend)           as spend,
          sum(f.revenue)         as revenue,
          round(sum(f.connects)::numeric        / nullif(sum(f.dials), 0),           4) as connect_rate,
          round(sum(f.qualified_leads)::numeric / nullif(sum(f.connects), 0),        4) as qualification_rate,
          round(sum(f.conversions)::numeric     / nullif(sum(f.qualified_leads), 0), 4) as close_rate,
          round(sum(f.conversions)::numeric     / nullif(sum(f.connects), 0),        4) as conversion_rate,
          round(sum(f.revenue)::numeric         / nullif(sum(f.spend), 0),           2) as roas
        from {_MARTS}.fct_campaign_performance f
        where f.call_month >= (
          select max(call_month) from {_MARTS}.fct_campaign_performance
        ) - make_interval(months => %s - 1)
        group by f.call_month
        order by f.call_month
        """,
        (months,),
    )
    return {"rows": rows}


@router.get("/campaign-performance", summary="fct_campaign_performance rows (joined to dim_campaign)")
def campaign_performance(
    months: int = Query(6, ge=1, le=24, description="How many trailing months to return"),
) -> dict[str, Any]:
    rows = _rows(
        f"""
        select f.call_month, f.campaign, d.business_line, d.offering,
               f.dials, f.connects, f.qualified_leads, f.conversions,
               f.connect_rate, f.qualification_rate, f.conversion_rate,
               f.spend, f.revenue, f.cpa, f.roas, f.revenue_per_connect
        from {_MARTS}.fct_campaign_performance f
        left join {_MARTS}.dim_campaign d using (campaign)
        where f.call_month >= (
          select max(call_month) from {_MARTS}.fct_campaign_performance
        ) - make_interval(months => %s - 1)
        order by f.call_month desc, f.campaign
        """,
        (months,),
    )
    return {"rows": rows}


@router.get("/pool-health", summary="fct_caller_id_pool_health rows (joined to dim_caller_id_pool)")
def pool_health(
    months: int = Query(6, ge=1, le=24, description="How many trailing months to return"),
) -> dict[str, Any]:
    rows = _rows(
        f"""
        select p.call_month, p.caller_id_pool, d.pool_description,
               p.dials, p.connects, p.connect_rate,
               p.prev_connect_rate, p.connect_rate_mom_change, p.spam_flag_risk
        from {_MARTS}.fct_caller_id_pool_health p
        left join {_MARTS}.dim_caller_id_pool d using (caller_id_pool)
        where p.call_month >= (
          select max(call_month) from {_MARTS}.fct_caller_id_pool_health
        ) - make_interval(months => %s - 1)
        order by p.call_month desc, p.caller_id_pool
        """,
        (months,),
    )
    return {"rows": rows}
