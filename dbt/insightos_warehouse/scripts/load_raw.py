"""Load the synthetic telesales dataset into the Postgres `raw` schema.

Reuses the exact same generator that powers the browser demo
(`insightos.demo.verticals.generate_telesales`), so the warehouse path and the
DuckDB-WASM path analyse the same planted ground truth (Pool C spam-flag
collapse in the final month).

Usage:
    pip install psycopg2-binary ./packages/analytics-core
    python dbt/insightos_warehouse/scripts/load_raw.py
Connection comes from INSIGHTOS_PG_* env vars (same defaults as profiles.yml).
"""
from __future__ import annotations

import io
import os

import psycopg2

from insightos.demo.verticals import generate_telesales

DDL = """
create schema if not exists raw;
drop table if exists raw.telesales_call_blocks;
create table raw.telesales_call_blocks (
    call_date          date        not null,
    call_block_id      text        not null,
    campaign           text        not null,
    agent_type         text        not null,
    caller_id_pool     text        not null,
    region             text        not null,
    lead_source        text        not null,
    dials              integer     not null,
    connects           integer     not null,
    qualified_leads    integer     not null,
    conversions        integer     not null,
    talk_time_minutes  double precision not null,
    qa_score           double precision not null,
    campaign_spend     double precision not null,
    revenue            double precision not null
);
"""


def main() -> None:
    dataset = generate_telesales()
    frame = dataset.frame.copy()
    frame["call_date"] = frame["call_date"].dt.date

    buffer = io.StringIO()
    frame.to_csv(buffer, index=False, header=False)
    buffer.seek(0)

    conn = psycopg2.connect(
        host=os.environ.get("INSIGHTOS_PG_HOST", "localhost"),
        port=int(os.environ.get("INSIGHTOS_PG_PORT", "5432")),
        user=os.environ.get("INSIGHTOS_PG_USER", "insightos"),
        password=os.environ.get("INSIGHTOS_PG_PASSWORD", "insightos"),
        dbname=os.environ.get("INSIGHTOS_PG_DATABASE", "insightos"),
    )
    try:
        with conn, conn.cursor() as cur:
            cur.execute(DDL)
            cur.copy_expert(
                "copy raw.telesales_call_blocks from stdin with (format csv)",
                buffer,
            )
            cur.execute("select count(*) from raw.telesales_call_blocks")
            count = cur.fetchone()[0]
        print(f"loaded {count} rows into raw.telesales_call_blocks")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
