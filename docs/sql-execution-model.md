# What actually executes the SQL

One engine executes every query in this product: **DuckDB-WASM, running inside
your browser tab.** Nothing is uploaded, no warehouse is contacted, and there
is no server-side query path. The dataset you opened is registered as a table
in an in-memory DuckDB instance and the console runs against that.

**BigQuery and Hive are transpilation targets, not execution targets.** When
you switch the dialect toggle, the editor shows you the same analysis rewritten
into the SQL that warehouse would accept, together with the divergences a
rewrite cannot fix. It is never sent anywhere. The UI does not claim a
warehouse connection anywhere, and this file exists so that the claim cannot be
misread.

## Why translate at all, if execution is always DuckDB?

### The engine is a detail; the query is the asset

An analytical question - "what is month-over-month revenue by region, with the
prior period alongside it" - outlives the engine it was first written against.
The same question gets asked on BigQuery at one employer, Hive at another,
Postgres in a notebook, DuckDB in a laptop prototype. What transfers between
those jobs is the shape of the query: the date spine, the window function, the
cohort join. What does not transfer is roughly a dozen constructs.

So the interesting artifact is the analysis, and the interesting skill is
knowing precisely where it breaks when it moves. That is what
[`apps/web/lib/sql-dialect.ts`](../apps/web/lib/sql-dialect.ts) encodes, and
[`docs/sql-portability.md`](./sql-portability.md) tabulates.

### Dialect divergence is where analysis silently breaks

Syntax errors are harmless - the warehouse rejects the query and you fix it.
The dangerous divergences are the ones that *run* and return a different
number:

- **`DATE_DIFF` reverses its operands in BigQuery.** DuckDB reads
  `DATE_DIFF('day', start, end)`; BigQuery reads `DATE_DIFF(end, start, DAY)`.
  Port it literally and every tenure, latency and cohort-age figure flips sign.
  Nothing errors.
- **`QUALIFY` does not exist in Hive.** The idiomatic "top N per group" has to
  become a CTE plus an outer filter. Analysts under time pressure often drop
  the ranking filter instead, and quietly report a total where they meant a
  top-N.
- **`percentile_approx` is approximate; `QUANTILE_CONT` is exact.** A p90
  latency SLA computed in Hive and in DuckDB will not agree, and the gap widens
  with skew. If the SLA is a contractual number, the engine is part of the
  definition.

The console surfaces exactly these, and only when the query in the editor
actually contains the construct - a caveat that fires on every query, including
`SELECT * LIMIT 20`, teaches you to stop reading caveats.

## Where the SQL comes from

The recipes in the console are generated from the profiled schema of the
dataset you loaded: the detected date column, the detected measure, the
detected dimensions. They are the same aggregations the analytics engine runs
internally, written out as SQL so the numbers on the dashboard can be checked
by hand rather than taken on trust.
