'use client';

import * as React from 'react';
import { Play, Database, TriangleAlert } from 'lucide-react';
import { SectionLabel } from '@/components/ui/primitives';
import type { Analysis, DatasetSchema } from '@/lib/types';

interface SqlResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
}

/**
 * Values reach here already normalised by the engine (dates as ISO strings,
 * HUGEINT aggregates as numbers), so this only has to handle presentation:
 * thousands separators for quantities, no scientific notation, no `[object]`.
 */
function cell(v: unknown): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'bigint') return v.toLocaleString('en-GB');
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '-';
    return v.toLocaleString('en-GB', { maximumFractionDigits: 4 });
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Quote an identifier only when it is not already a bare lowercase token. */
function q(name: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

interface Recipe {
  id: string;
  label: string;
  sql: string;
}

/**
 * Analytical SQL written against the columns the profiler actually detected.
 *
 * The point of the annotations is portability. The same warehouse question is
 * asked in DuckDB here, in BigQuery at one employer and in Hive at the next,
 * and the interesting part is precisely where the three diverge - QUALIFY,
 * date truncation, date differencing and approximate quantiles. Putting the
 * translation in the query header keeps it next to the code it applies to.
 */
function buildRecipes(table: string, schema: DatasetSchema | undefined): Recipe[] {
  const t = q(table);
  const dateCol = schema?.time_columns?.[0] ?? null;
  const measureCol = schema?.measures?.[0] ?? null;
  const dimCol = schema?.dimensions?.[0] ?? null;
  const idCol = schema?.identifiers?.[0] ?? schema?.primary_key?.[0] ?? null;

  const d = dateCol ? `CAST(${q(dateCol)} AS TIMESTAMP)` : null;
  const m = measureCol ? q(measureCol) : null;
  const g = dimCol ? q(dimCol) : null;
  const id = idCol ? q(idCol) : null;

  const recipes: Recipe[] = [];

  if (d && m) {
    recipes.push({
      id: 'pop',
      label: 'Period over period',
      sql: `-- Month-over-month growth with a window function.
-- Only the truncation call changes between engines:
--   BigQuery : DATE_TRUNC(${dateCol}, MONTH)
--   Hive     : TRUNC(${dateCol}, 'MM')
WITH monthly AS (
  SELECT DATE_TRUNC('month', ${d}) AS period,
         SUM(${m})                 AS total
  FROM ${t}
  GROUP BY 1
)
SELECT period,
       total,
       LAG(total) OVER (ORDER BY period) AS prior_period,
       ROUND(100.0 * (total - LAG(total) OVER (ORDER BY period))
             / NULLIF(LAG(total) OVER (ORDER BY period), 0), 2) AS growth_pct
FROM monthly
ORDER BY period;`,
    });

    recipes.push({
      id: 'running',
      label: 'Running total',
      sql: `-- Cumulative total and a trailing three-period average.
-- Window frame syntax is identical in DuckDB, BigQuery and Hive.
WITH monthly AS (
  SELECT DATE_TRUNC('month', ${d}) AS period,
         SUM(${m})                 AS total
  FROM ${t}
  GROUP BY 1
)
SELECT period,
       total,
       SUM(total) OVER (ORDER BY period
                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total,
       ROUND(AVG(total) OVER (ORDER BY period
                              ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 2) AS moving_avg_3
FROM monthly
ORDER BY period;`,
    });
  }

  if (d && m && g) {
    recipes.push({
      id: 'topn',
      label: 'Top N per period',
      sql: `-- Top three ${dimCol} values in every month.
-- DuckDB and BigQuery support QUALIFY, which deletes the wrapper CTE:
--   BigQuery : ... GROUP BY 1, 2 QUALIFY rn <= 3
--   Hive     : no QUALIFY - keep the CTE and filter outside, as written here
WITH ranked AS (
  SELECT DATE_TRUNC('month', ${d}) AS period,
         ${g}                      AS segment,
         SUM(${m})                 AS total,
         ROW_NUMBER() OVER (PARTITION BY DATE_TRUNC('month', ${d})
                            ORDER BY SUM(${m}) DESC) AS rn
  FROM ${t}
  GROUP BY 1, 2
)
SELECT period, segment, total, rn
FROM ranked
WHERE rn <= 3
ORDER BY period, rn;`,
    });
  }

  if (m && g) {
    recipes.push({
      id: 'pareto',
      label: 'Pareto concentration',
      sql: `-- Which ${dimCol} values carry the value, and how concentrated is it.
-- SUM(...) OVER () with an empty window is portable across all three engines.
WITH totals AS (
  SELECT ${g} AS segment,
         SUM(${m}) AS total
  FROM ${t}
  GROUP BY 1
)
SELECT segment,
       total,
       ROUND(100.0 * total / NULLIF(SUM(total) OVER (), 0), 2) AS share_pct,
       ROUND(100.0 * SUM(total) OVER (ORDER BY total DESC
                                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
             / NULLIF(SUM(total) OVER (), 0), 2) AS cumulative_pct
FROM totals
ORDER BY total DESC;`,
    });
  }

  if (d && id) {
    recipes.push({
      id: 'cohort',
      label: 'Cohort retention',
      sql: `-- Monthly cohort retention. Period 0 is 100% by construction.
-- Date differencing is the dialect-specific part:
--   BigQuery : DATE_DIFF(period, cohort, MONTH)
--   Hive     : CAST(MONTHS_BETWEEN(period, cohort) AS INT)
WITH firsts AS (
  SELECT ${id} AS entity,
         DATE_TRUNC('month', MIN(${d})) AS cohort
  FROM ${t}
  GROUP BY 1
),
activity AS (
  SELECT DISTINCT ${id} AS entity,
         DATE_TRUNC('month', ${d}) AS period
  FROM ${t}
),
joined AS (
  SELECT f.cohort,
         DATE_DIFF('month', f.cohort, a.period) AS period_index,
         a.entity
  FROM activity a
  JOIN firsts f ON f.entity = a.entity
)
SELECT cohort,
       period_index,
       COUNT(DISTINCT entity) AS active,
       ROUND(100.0 * COUNT(DISTINCT entity)
             / NULLIF(FIRST_VALUE(COUNT(DISTINCT entity))
                        OVER (PARTITION BY cohort ORDER BY period_index), 0), 1) AS retention_pct
FROM joined
WHERE period_index >= 0
GROUP BY 1, 2
ORDER BY cohort, period_index;`,
    });
  }

  if (m) {
    recipes.push({
      id: 'quantiles',
      label: 'Distribution',
      sql: `-- Percentiles beat averages on skewed business data.
--   DuckDB   : QUANTILE_CONT(${measureCol}, 0.9)
--   BigQuery : APPROX_QUANTILES(${measureCol}, 100)[OFFSET(90)]
--   Hive     : percentile_approx(${measureCol}, 0.9)
SELECT COUNT(*)                                AS n,
       ROUND(AVG(${m}), 2)                     AS mean,
       ROUND(QUANTILE_CONT(${m}, 0.50), 2)     AS p50,
       ROUND(QUANTILE_CONT(${m}, 0.90), 2)     AS p90,
       ROUND(QUANTILE_CONT(${m}, 0.99), 2)     AS p99,
       ROUND(MAX(${m}), 2)                     AS max_value,
       ROUND(AVG(${m}) - QUANTILE_CONT(${m}, 0.50), 2) AS mean_minus_median
FROM ${t}
WHERE ${m} IS NOT NULL;`,
    });
  }

  if (m && g && d) {
    recipes.push({
      id: 'groupingsets',
      label: 'Subtotals',
      sql: `-- Segment totals, yearly totals and the grand total in one pass
-- instead of three round trips. GROUPING SETS is spelled the same way in
-- DuckDB, BigQuery and Hive; only Hive additionally requires that every
-- grouping expression appear in the SELECT list.
SELECT COALESCE(CAST(${g} AS VARCHAR), '(all segments)') AS segment,
       COALESCE(CAST(DATE_TRUNC('year', ${d}) AS VARCHAR), '(all periods)') AS period,
       SUM(${m}) AS total,
       COUNT(*)  AS row_count
FROM ${t}
GROUP BY GROUPING SETS ((${g}, DATE_TRUNC('year', ${d})), (${g}), ())
ORDER BY segment, period;`,
    });
  }

  return recipes;
}

/**
 * A console over the very same DuckDB instance that produced the analysis, so
 * anything a reader disbelieves in a chart can be re-derived here in SQL.
 */
export function SqlPanel({ analysis }: { analysis: Analysis }) {
  const table = analysis.key?.startsWith('upload:') ? analysis.key.slice('upload:'.length) : null;
  const [sql, setSql] = React.useState('');
  const [result, setResult] = React.useState<SqlResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [activeRecipe, setActiveRecipe] = React.useState<string | null>(null);

  const recipes = React.useMemo(
    () => (table ? buildRecipes(table, analysis.schema) : []),
    [table, analysis.schema],
  );

  React.useEffect(() => {
    if (table) setSql(`SELECT *\nFROM ${q(table)}\nLIMIT 20;`);
  }, [table]);

  const run = React.useCallback(async () => {
    if (!sql.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { executeSql } = await import('@/lib/engine');
      setResult(await executeSql(sql));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [sql, busy]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void run();
    }
  };

  if (!table) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <SectionLabel>SQL console</SectionLabel>
        <h2 className="mt-1.5 text-base font-semibold tracking-tight">Upload a dataset to query it</h2>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted">
          Demo datasets ship as pre-computed analysis results, so there is no table behind them.
          Upload a CSV, JSON or Parquet file and it is loaded into DuckDB-WASM in this tab - then
          every figure on every panel becomes queryable here in SQL.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionLabel>SQL console</SectionLabel>
          <h2 className="mt-1.5 text-base font-semibold tracking-tight">Query the analysed table</h2>
          <p className="mt-1.5 text-[13px] text-muted">
            Running on DuckDB-WASM inside this tab against{' '}
            <code className="rounded bg-elevated px-1.5 py-0.5 text-[12px]">{table}</code>. Nothing
            leaves your device.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-accent px-4 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          <Play className="h-4 w-4" aria-hidden />
          {busy ? 'Running' : 'Run query'}
        </button>
      </div>

      {recipes.length ? (
        <div className="mt-4">
          <div className="flex flex-wrap gap-2">
            {recipes.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={activeRecipe === r.id}
                onClick={() => {
                  setSql(r.sql);
                  setActiveRecipe(r.id);
                }}
                className={
                  activeRecipe === r.id
                    ? 'rounded-lg border border-accent bg-accent/10 px-3 py-2 text-[12px] font-medium text-accent'
                    : 'rounded-lg border border-line bg-elevated px-3 py-2 text-[12px] text-muted transition-colors hover:border-accent/50 hover:text-fg'
                }
              >
                {r.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            Each recipe writes a portable analytical query against the columns the profiler
            detected, annotated with its BigQuery and Hive equivalent.
          </p>
        </div>
      ) : null}

      <label htmlFor="sql-input" className="sr-only">
        SQL query
      </label>
      <textarea
        id="sql-input"
        value={sql}
        spellCheck={false}
        onChange={(e) => {
          setSql(e.target.value);
          setActiveRecipe(null);
        }}
        onKeyDown={onKeyDown}
        rows={recipes.length ? 12 : 6}
        className="mt-4 w-full resize-y rounded-xl border border-line bg-elevated p-3 font-mono text-[13px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      <p className="mt-1.5 text-[12px] text-muted">Press Ctrl/Cmd + Enter to run.</p>

      {error ? (
        <div
          role="alert"
          className="mt-4 flex gap-2 rounded-xl border border-negative/40 bg-negative/10 p-3 text-[13px] text-negative"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span className="font-mono">{error}</span>
        </div>
      ) : null}

      {result ? (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <Database className="h-3.5 w-3.5" aria-hidden />
            <span>
              {result.rowCount.toLocaleString('en-GB')} row{result.rowCount === 1 ? '' : 's'} in{' '}
              {result.durationMs} ms
            </span>
            {result.truncated ? <span>- showing the first {result.rows.length}</span> : null}
          </div>
          <div className="mt-2 max-h-[420px] overflow-auto rounded-xl border border-line">
            <table className="w-full border-collapse text-[13px]">
              <caption className="sr-only">Query results</caption>
              <thead className="sticky top-0 bg-elevated">
                <tr>
                  {result.columns.map((c) => (
                    <th
                      key={c}
                      scope="col"
                      className="whitespace-nowrap border-b border-line px-3 py-2 text-left font-medium"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i} className="odd:bg-elevated/40">
                    {result.columns.map((c) => (
                      <td key={c} className="whitespace-nowrap px-3 py-1.5 font-mono text-muted">
                        {cell(row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
