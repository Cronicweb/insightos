# InsightOS warehouse (dbt)

Warehouse-mode analytics for InsightOS: raw operational telesales data is
modelled in PostgreSQL with [dbt](https://github.com/dbt-labs/dbt-core)
through the classic staging -> intermediate -> marts architecture, with
source definitions, schema tests and singular data tests.

This is **additive** to the existing browser mode (DuckDB-WASM over uploaded
files): the same synthetic telesales dataset - including its planted ground
truth (a carrier spam-flagging incident that collapses Pool C's connect rate
in the final month) - flows through both paths.

```
raw.telesales_call_blocks            (loaded by scripts/load_raw.py)
        |
stg_telesales__call_blocks           (rename / cast / round; 1:1 grain)
        |
int_telesales__monthly_funnel        (month x campaign x pool x agent type)
int_telesales__pool_monthly          (pool connect-rate series + MoM lag)
        |
fct_campaign_performance             (funnel rates, CPA, ROAS)
fct_caller_id_pool_health            (MoM connect-rate delta, spam_flag_risk)
dim_campaign / dim_caller_id_pool    (from seeds)
```

## Quickstart (local)

```bash
# 1. Postgres (or use `docker compose --profile warehouse up postgres`)
#    defaults: localhost:5432, user/password/db = insightos

# 2. Install
pip install dbt-postgres ./packages/analytics-core

# 3. Load the raw layer from the synthetic generator
python dbt/insightos_warehouse/scripts/load_raw.py

# 4. Build everything (seeds + models + tests)
cd dbt/insightos_warehouse
dbt build --profiles-dir .
```

Or with Docker only:

```bash
docker compose --profile warehouse up -d postgres
docker compose --profile warehouse run --rm dbt
```

Connection settings come from `INSIGHTOS_PG_HOST/PORT/USER/PASSWORD/DATABASE`
env vars (see `profiles.yml` for the defaults).

## Tests

- Schema tests: `unique` / `not_null` keys, `accepted_values` for agent
  types, `relationships` from facts to dimensions and from staging to seeds.
- `tests/assert_funnel_is_monotonic.sql` - dials >= connects >= qualified >=
  conversions on every call block.
- `tests/assert_planted_anomaly_is_detected.sql` - end-to-end: the final
  month must flag Pool C (and only Pool C) as a spam-flagging risk, matching
  the generator's ground truth.

`dbt docs generate` produces the lineage graph and column-level docs.

CI runs the whole pipeline (Postgres service -> load raw -> `dbt build`) on
every change under `dbt/` or `packages/analytics-core/` - see
`.github/workflows/dbt.yml`.
