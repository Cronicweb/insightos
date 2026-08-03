# SQL portability: DuckDB, BigQuery and Hive

InsightOS runs its in-browser queries on DuckDB. That is an implementation
detail, not a dependency. The SQL the engine emits, and every recipe in the
SQL console, is deliberately written in the ANSI subset that ports to
BigQuery and to Hive with a bounded, enumerable set of substitutions.

This document is that enumeration, followed by the five analytical patterns
InsightOS actually computes, written out in all three dialects.

The reason to care: warehouse dialect is the least interesting part of an
analytics problem, and the part that most often blocks a piece of analysis
from moving between teams. Knowing exactly where the dialects diverge means
a query written once is a query that runs anywhere.

---

## 1. Construct translation table

| Construct | DuckDB | BigQuery (Standard SQL) | Hive (3.x) |
|---|---|---|---|
| Identifier quoting | `"col name"` | `` `col name` `` | `` `col name` `` |
| String literal | `'text'` | `'text'` or `"text"` | `'text'` |
| CTEs | `WITH x AS (...)` | same | same (0.13+) |
| Recursive CTE | `WITH RECURSIVE` | `WITH RECURSIVE` (2023+) | not supported - unroll manually |
| Window functions | full support | full support | full support |
| Named windows | `WINDOW w AS (...)` | `WINDOW w AS (...)` | `WINDOW w AS (...)` |
| `QUALIFY` | supported | supported | **not supported** - wrap in a CTE and filter |
| `GROUPING SETS` | supported | supported | supported |
| `ROLLUP` / `CUBE` | `GROUP BY ROLLUP(a, b)` | `GROUP BY ROLLUP(a, b)` | `GROUP BY a, b WITH ROLLUP` |
| `GROUPING()` flag | `GROUPING(a)` | `GROUPING(a)` | `GROUPING__ID` (bitmask, note the double underscore) |
| Truncate to month | `DATE_TRUNC('month', d)` | `DATE_TRUNC(d, MONTH)` | `TRUNC(d, 'MM')` |
| Truncate to week | `DATE_TRUNC('week', d)` | `DATE_TRUNC(d, WEEK(MONDAY))` | `DATE_SUB(d, PMOD(DATEDIFF(d, '1970-01-05'), 7))` |
| Difference in months | `DATE_DIFF('month', a, b)` | `DATE_DIFF(b, a, MONTH)` | `CAST(MONTHS_BETWEEN(b, a) AS INT)` |
| Difference in days | `DATE_DIFF('day', a, b)` | `DATE_DIFF(b, a, DAY)` | `DATEDIFF(b, a)` |
| Add an interval | `d + INTERVAL 7 DAY` | `DATE_ADD(d, INTERVAL 7 DAY)` | `DATE_ADD(d, 7)` |
| Current timestamp | `CURRENT_TIMESTAMP` | `CURRENT_TIMESTAMP()` | `CURRENT_TIMESTAMP()` |
| Exact median | `QUANTILE_CONT(x, 0.5)` | `PERCENTILE_CONT(x, 0.5) OVER ()` | not available - use the approximate form |
| Approximate quantile | `APPROX_QUANTILE(x, 0.9)` | `APPROX_QUANTILES(x, 100)[OFFSET(90)]` | `percentile_approx(x, 0.9)` |
| Distinct count (exact) | `COUNT(DISTINCT x)` | `COUNT(DISTINCT x)` | `COUNT(DISTINCT x)` |
| Distinct count (approx) | `APPROX_COUNT_DISTINCT(x)` | `APPROX_COUNT_DISTINCT(x)` | not built in - use `COUNT(DISTINCT ...)` |
| String aggregation | `STRING_AGG(x, ', ')` | `STRING_AGG(x, ', ')` | `concat_ws(', ', collect_list(x))` |
| Array from rows | `LIST(x)` / `ARRAY_AGG(x)` | `ARRAY_AGG(x)` | `collect_list(x)` |
| Explode an array | `UNNEST(arr)` | `CROSS JOIN UNNEST(arr)` | `LATERAL VIEW explode(arr) t AS x` |
| Null-safe divide | `x / NULLIF(y, 0)` | same | same |
| Cast | `CAST(x AS DOUBLE)` | `CAST(x AS FLOAT64)` | `CAST(x AS DOUBLE)` |
| Safe cast | `TRY_CAST(x AS INTEGER)` | `SAFE_CAST(x AS INT64)` | `CAST(x AS INT)` returns NULL on failure |
| Integer type name | `INTEGER` / `BIGINT` | `INT64` | `INT` / `BIGINT` |
| Float type name | `DOUBLE` | `FLOAT64` | `DOUBLE` |
| String type name | `VARCHAR` | `STRING` | `STRING` |
| Conditional aggregate | `SUM(CASE WHEN c THEN x END)` | `SUM(IF(c, x, NULL))` or `CASE` | `SUM(CASE WHEN c THEN x END)` |
| Sampling | `USING SAMPLE 10%` | `TABLESAMPLE SYSTEM (10 PERCENT)` | `TABLESAMPLE (10 PERCENT)` |
| `SELECT * EXCEPT` | `SELECT * EXCLUDE (a, b)` | `SELECT * EXCEPT (a, b)` | not supported - list columns |
| Filter clause | `SUM(x) FILTER (WHERE c)` | not supported - use `CASE` | not supported - use `CASE` |

### The portable-by-default rules

Writing to the intersection is cheap if you adopt five habits:

1. **Never use `QUALIFY`.** Put the window function in a CTE and filter in
   the outer query. Costs one extra CTE, works in all three.
2. **Never use `FILTER (WHERE ...)`.** `SUM(CASE WHEN c THEN x END)` is
   universal and just as readable.
3. **Always `NULLIF` a denominator.** Division by zero is an error in some
   engines and a NULL in others; make it explicit.
4. **Alias every derived column.** Hive is stricter than the others about
   referencing unaliased expressions.
5. **Group by ordinal (`GROUP BY 1, 2`) for grouped expressions.** It avoids
   repeating a date-truncation call whose spelling is the one thing that
   differs, so porting is a single-line edit.

---

## 2. Period-over-period growth

The engine's KPI deltas. A window function beats a self-join here in every
engine, and `LAG` is spelled identically in all three.

**DuckDB**

```sql
WITH monthly AS (
  SELECT DATE_TRUNC('month', order_date) AS period,
         SUM(revenue)                    AS total
  FROM orders
  GROUP BY 1
)
SELECT period,
       total,
       LAG(total) OVER (ORDER BY period) AS prior_period,
       ROUND(100.0 * (total - LAG(total) OVER (ORDER BY period))
             / NULLIF(LAG(total) OVER (ORDER BY period), 0), 2) AS growth_pct
FROM monthly
ORDER BY period;
```

**BigQuery** - only line 2 changes.

```sql
  SELECT DATE_TRUNC(order_date, MONTH) AS period,
```

**Hive** - only line 2 changes.

```sql
  SELECT TRUNC(order_date, 'MM') AS period,
```

---

## 3. Cohort retention matrix

Backs `insightos.clv.cohort`. Three CTEs: first-seen date per entity,
distinct activity periods, then the join that produces the period index.

**DuckDB**

```sql
WITH firsts AS (
  SELECT customer_id,
         DATE_TRUNC('month', MIN(order_date)) AS cohort
  FROM orders
  GROUP BY 1
),
activity AS (
  SELECT DISTINCT customer_id,
         DATE_TRUNC('month', order_date) AS period
  FROM orders
),
joined AS (
  SELECT f.cohort,
         DATE_DIFF('month', f.cohort, a.period) AS period_index,
         a.customer_id
  FROM activity a
  JOIN firsts  f ON f.customer_id = a.customer_id
)
SELECT cohort,
       period_index,
       COUNT(DISTINCT customer_id) AS active,
       ROUND(100.0 * COUNT(DISTINCT customer_id)
             / NULLIF(FIRST_VALUE(COUNT(DISTINCT customer_id))
                        OVER (PARTITION BY cohort ORDER BY period_index), 0), 1) AS retention_pct
FROM joined
WHERE period_index >= 0
GROUP BY 1, 2
ORDER BY cohort, period_index;
```

**BigQuery** - two substitutions.

```sql
  DATE_TRUNC(order_date, MONTH)             -- instead of DATE_TRUNC('month', order_date)
  DATE_DIFF(a.period, f.cohort, MONTH)      -- argument order is reversed
```

**Hive** - two substitutions.

```sql
  TRUNC(order_date, 'MM')
  CAST(MONTHS_BETWEEN(a.period, f.cohort) AS INT)
```

Note the denominator. Using `FIRST_VALUE(...) OVER (PARTITION BY cohort
ORDER BY period_index)` rather than `MAX(...)` is deliberate: the cohort
base must be period 0 specifically, not the largest period, because a
cohort can legitimately be more active in period 2 than in period 0 and
`MAX` would silently produce retention figures capped at 100%.

---

## 4. RFM scoring

Backs `insightos.clv.rfm`. `NTILE` is portable; the trap is that `NTILE`
assigns 1 to the *lowest* value, so recency has to be inverted because low
recency is good.

**DuckDB / BigQuery / Hive** - identical apart from the date functions.

```sql
WITH bounds AS (
  SELECT MAX(order_date) AS as_of FROM orders
),
per_customer AS (
  SELECT o.customer_id,
         DATE_DIFF('day', MAX(o.order_date), b.as_of) AS recency_days,
         COUNT(*)                                     AS frequency,
         SUM(o.revenue)                               AS monetary
  FROM orders o
  CROSS JOIN bounds b
  GROUP BY o.customer_id, b.as_of
),
scored AS (
  SELECT customer_id,
         recency_days,
         frequency,
         monetary,
         NTILE(5) OVER (ORDER BY recency_days DESC) AS r_score,
         NTILE(5) OVER (ORDER BY frequency)         AS f_score,
         NTILE(5) OVER (ORDER BY monetary)          AS m_score
  FROM per_customer
)
SELECT customer_id,
       recency_days, frequency, monetary,
       r_score, f_score, m_score,
       CASE
         WHEN r_score >= 4 AND f_score >= 4 THEN 'champion'
         WHEN r_score >= 4 AND f_score <= 2 THEN 'new'
         WHEN r_score <= 2 AND f_score >= 4 THEN 'at risk'
         WHEN r_score <= 2 AND f_score <= 2 THEN 'lapsed'
         ELSE 'core'
       END AS segment
FROM scored
ORDER BY monetary DESC;
```

BigQuery: `DATE_DIFF(b.as_of, MAX(o.order_date), DAY)`.
Hive: `DATEDIFF(b.as_of, MAX(o.order_date))`.

The production implementation in `insightos.clv.rfm` uses rank percentiles
rather than `NTILE`, because real transaction data has a mode at
frequency = 1 that spans several quintile boundaries and makes tile
assignment arbitrary. `NTILE` is shown here because it is the portable
SQL idiom; the caveat applies in every dialect equally.

---

## 5. Mix-shift decomposition

Backs the root-cause engine's central question: did the metric move because
each segment moved, or because the mix of segments moved?

```sql
WITH periods AS (
  SELECT region,
         SUM(CASE WHEN order_date >= DATE '2026-07-01' THEN revenue END) AS current_value,
         SUM(CASE WHEN order_date <  DATE '2026-07-01'
                  AND  order_date >= DATE '2026-06-01' THEN revenue END) AS baseline_value
  FROM orders
  WHERE order_date >= DATE '2026-06-01'
  GROUP BY region
),
totals AS (
  SELECT SUM(current_value) AS cur_total,
         SUM(baseline_value) AS base_total
  FROM periods
)
SELECT p.region,
       p.baseline_value,
       p.current_value,
       p.current_value - p.baseline_value AS delta,
       ROUND(100.0 * (p.current_value - p.baseline_value)
             / NULLIF(t.cur_total - t.base_total, 0), 1) AS contribution_pct,
       ROUND(100.0 * p.baseline_value / NULLIF(t.base_total, 0), 1) AS share_baseline_pct,
       ROUND(100.0 * p.current_value  / NULLIF(t.cur_total, 0), 1)  AS share_current_pct,
       ROUND(100.0 * p.current_value  / NULLIF(t.cur_total, 0)
           - 100.0 * p.baseline_value / NULLIF(t.base_total, 0), 1) AS mix_shift_pp,
       ROUND(p.baseline_value * (t.cur_total / NULLIF(t.base_total, 0) - 1), 2) AS expected_delta,
       ROUND((p.current_value - p.baseline_value)
           - p.baseline_value * (t.cur_total / NULLIF(t.base_total, 0) - 1), 2) AS excess_delta
FROM periods p
CROSS JOIN totals t
ORDER BY ABS(p.current_value - p.baseline_value) DESC;
```

`expected_delta` is what the segment would have done had it simply grown at
the overall rate; `excess_delta` is what it did beyond that. A segment with
a large delta but a near-zero excess is not a cause, it is a passenger.
This distinction is the difference between "East fell the most" and "East
fell more than the business as a whole did", and it is the reason the
root-cause engine does not simply rank by delta.

Portability: the entire query is ANSI. Only `DATE '2026-07-01'` needs
attention - BigQuery accepts it as written, Hive prefers the bare string
literal `'2026-07-01'`.

---

## 6. Funnel conversion

Step-to-step conversion with a bounded look-forward window.

```sql
WITH steps AS (
  SELECT session_id,
         MIN(CASE WHEN event = 'view'     THEN event_ts END) AS t_view,
         MIN(CASE WHEN event = 'add_cart' THEN event_ts END) AS t_cart,
         MIN(CASE WHEN event = 'checkout' THEN event_ts END) AS t_checkout,
         MIN(CASE WHEN event = 'purchase' THEN event_ts END) AS t_purchase
  FROM events
  GROUP BY session_id
)
SELECT COUNT(*)                                                    AS sessions,
       COUNT(t_view)                                               AS viewed,
       COUNT(CASE WHEN t_cart     > t_view     THEN 1 END)         AS carted,
       COUNT(CASE WHEN t_checkout > t_cart     THEN 1 END)         AS checked_out,
       COUNT(CASE WHEN t_purchase > t_checkout THEN 1 END)         AS purchased,
       ROUND(100.0 * COUNT(CASE WHEN t_cart > t_view THEN 1 END)
             / NULLIF(COUNT(t_view), 0), 2)                        AS view_to_cart_pct,
       ROUND(100.0 * COUNT(CASE WHEN t_purchase > t_checkout THEN 1 END)
             / NULLIF(COUNT(t_view), 0), 2)                        AS end_to_end_pct
FROM steps;
```

The ordering comparisons (`t_cart > t_view`) matter: without them a session
that added to cart *before* the tracked view would be counted as a
conversion. Fully portable across all three engines.

---

## 7. Where this shows up in the product

- **SQL console** (`apps/web/components/panels/sql-panel.tsx`) - seven recipes
  built against whichever columns the profiler detected in the uploaded file,
  each annotated inline with its BigQuery and Hive equivalent.
- **`insightos.clv.cohort`** - the retention matrix of section 3, in pandas,
  with the additional rule that cells beyond a cohort's observable horizon
  stay `NaN` rather than 0.
- **`insightos.clv.rfm`** - the segmentation of section 4.
- **`insightos.root_cause`** - the decomposition of section 5, plus the
  significance testing that SQL alone cannot do.

The Python engines exist because the analysis does not stop at SQL: it
continues into hypothesis tests, multiple-comparison correction and effect
sizes. But the aggregation layer underneath them is deliberately expressible
in portable SQL, which is what makes the numbers checkable by anyone with
access to the warehouse and no access to this codebase.
