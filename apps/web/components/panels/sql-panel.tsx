'use client';

import * as React from 'react';
import { Play, Database, TriangleAlert, Copy, Check, Languages, Download, TableProperties } from 'lucide-react';
import { SectionLabel } from '@/components/ui/primitives';
import type { Analysis, DatasetSchema } from '@/lib/types';
import { DIALECTS, translate, type Dialect } from '@/lib/sql-dialect';
import { downloadRowsCsv } from '@/lib/export/report-export';

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
 *
 * The dialect switch is not decoration: it runs a real translator over the
 * query text. The same question is asked in DuckDB here, in BigQuery at one
 * employer and in Hive at the next, and porting it - date truncation, date
 * differencing, quantiles, QUALIFY - is the actual work.
 */
export function SqlPanel({ analysis }: { analysis: Analysis }) {
  const uploaded = analysis.key?.startsWith('upload:') ? analysis.key.slice('upload:'.length) : null;
  // A demo dataset has no table behind it *yet*: its analysis was pre-computed
  // over the full source, but a sample of the real rows is published alongside
  // it. Loading that sample gives the console a genuine table, so the Run
  // button is dead only until the sample is fetched - not permanently.
  const table = uploaded ?? (analysis.key ?? 'dataset').replace(/[^A-Za-z0-9_]/g, '_');
  const demoKey = uploaded === null ? analysis.key ?? null : null;
  const [sample, setSample] = React.useState<{ rows: number; columns: number } | null>(null);
  const [loadingSample, setLoadingSample] = React.useState(false);
  const [sampleError, setSampleError] = React.useState<string | null>(null);
  const runnable = uploaded !== null || sample !== null;

  const [sql, setSql] = React.useState('');
  const [dialect, setDialect] = React.useState<Dialect>('duckdb');
  const [result, setResult] = React.useState<SqlResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [activeRecipe, setActiveRecipe] = React.useState<string | null>(null);

  const recipes = React.useMemo(
    () => buildRecipes(table, analysis.schema),
    [table, analysis.schema],
  );

  React.useEffect(() => {
    // Open on a real analytical query rather than SELECT *. A star query looks
    // identical in all three dialects, which makes the translator read as
    // decoration; the first recipe uses date truncation and a window function,
    // so switching dialect visibly rewrites the text.
    const opening = recipes[0];
    setSql(opening ? opening.sql : `SELECT *\nFROM ${q(table)}\nLIMIT 20;`);
    setResult(null);
    setError(null);
    setActiveRecipe(opening ? opening.id : null);
    setSample(null);
    setSampleError(null);
  }, [table, recipes]);

  const ported = React.useMemo(() => translate(sql, dialect), [sql, dialect]);

  const run = React.useCallback(async () => {
    if (!runnable || !sql.trim() || busy) return;
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
  }, [runnable, sql, busy]);

  const loadSample = React.useCallback(async () => {
    if (!demoKey || loadingSample) return;
    setLoadingSample(true);
    setSampleError(null);
    try {
      const [{ fetchSample }, { loadSampleTable }] = await Promise.all([
        import('@/lib/data'),
        import('@/lib/engine/sample'),
      ]);
      const rows = await fetchSample(demoKey);
      if (!rows.length) {
        throw new Error(
          'No sample rows were published for this dataset. Upload a CSV to run SQL here.',
        );
      }
      const loaded = await loadSampleTable(table, rows);
      setSample({ rows: loaded.rows, columns: loaded.columns.length });
      setResult(null);
      setError(null);
    } catch (e) {
      setSample(null);
      setSampleError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingSample(false);
    }
  }, [demoKey, loadingSample, table]);

  const copy = React.useCallback(() => {
    const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clip) return;
    clip.writeText(ported.sql).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => undefined,
    );
  }, [ported.sql]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void run();
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionLabel>SQL console</SectionLabel>
          <h2 className="mt-1.5 text-base font-semibold tracking-tight">
            {runnable ? 'Query the analysed table' : 'Warehouse SQL for this dataset'}
          </h2>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted">
            {sample !== null ? (
              <>
                Executed by DuckDB-WASM inside this tab against a{' '}
                <strong className="font-medium text-fg">
                  {sample.rows.toLocaleString('en-GB')}-row sample
                </strong>{' '}
                of <code className="rounded bg-elevated px-1.5 py-0.5 text-[12px]">{table}</code>.
                The dashboard above was computed over all{' '}
                {analysis.rows ? analysis.rows.toLocaleString('en-GB') : 'source'} rows, so totals
                here are smaller by construction - shares and shapes still hold. Upload the full
                file to reconcile exactly.
              </>
            ) : runnable ? (
              <>
                Executed by DuckDB-WASM inside this tab against{' '}
                <code className="rounded bg-elevated px-1.5 py-0.5 text-[12px]">{table}</code>, so
                nothing leaves your device. BigQuery and Hive below are transpilation targets for
                copy-paste into a warehouse - they are never executed here.
              </>
            ) : (
              <>
                This analysis was pre-computed over all{' '}
                {analysis.rows ? analysis.rows.toLocaleString('en-GB') : 'source'} rows, which are
                never shipped to your browser - but a sample of the real rows is. Load it to run
                the query below on DuckDB-WASM, switch dialect to port it, or upload your own file.
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {demoKey && sample === null ? (
            <button
              type="button"
              onClick={() => void loadSample()}
              disabled={loadingSample}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line px-4 text-[13px] font-medium transition-colors hover:bg-elevated disabled:opacity-60"
            >
              <TableProperties className="h-4 w-4" aria-hidden />
              {loadingSample ? 'Loading sample' : 'Load sample to run'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || !runnable}
            title={runnable ? undefined : 'Load the sample, or upload a file, to execute SQL'}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-accent px-4 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <Play className="h-4 w-4" aria-hidden />
            {busy ? 'Running' : 'Run query'}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="SQL dialect"
          className="inline-flex rounded-xl border border-line bg-elevated p-1"
        >
          {DIALECTS.map((d) => (
            <button
              key={d.id}
              type="button"
              aria-pressed={dialect === d.id}
              onClick={() => setDialect(d.id)}
              className={
                dialect === d.id
                  ? 'rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white'
                  : 'rounded-lg px-3 py-1.5 text-[12px] text-muted transition-colors hover:text-fg'
              }
            >
              {d.label}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-muted">
          {dialect === 'duckdb'
            ? 'Switch to BigQuery or Hive to port the query below, with the caveats a regex cannot fix.'
            : `Transpiled for ${DIALECTS.find((d) => d.id === dialect)?.label} - copy it into the warehouse. Execution here stays on DuckDB.`}
        </p>
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
            detected. The full construct-by-construct mapping is in{' '}
            <a
              href="https://github.com/Cronicweb/insightos/blob/main/docs/sql-portability.md"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline underline-offset-2"
            >
              docs/sql-portability.md
            </a>
            ; why a dialect toggle exists when execution is DuckDB is answered in{' '}
            <a
              href="https://github.com/Cronicweb/insightos/blob/main/docs/sql-execution-model.md"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline underline-offset-2"
            >
              docs/sql-execution-model.md
            </a>
            .
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
      <p className="mt-1.5 text-[12px] text-muted">
        {runnable
          ? 'Press Ctrl/Cmd + Enter to run.'
          : 'Editable - the translation below updates as you type.'}
      </p>
      {sampleError ? (
        <p role="alert" className="mt-1.5 text-[12px] text-negative">
          {sampleError}
        </p>
      ) : null}

      {dialect !== 'duckdb' ? (
        <div className="mt-4 rounded-xl border border-line bg-elevated/50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[12px] font-medium">
              <Languages className="h-3.5 w-3.5 text-accent" aria-hidden />
              <span>{DIALECTS.find((d) => d.id === dialect)?.label} equivalent</span>
            </div>
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-muted transition-colors hover:text-fg"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden />
              )}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="mt-2 overflow-auto rounded-lg bg-surface p-3 font-mono text-[12.5px] leading-relaxed">
            <code>{ported.sql}</code>
          </pre>
          {ported.notes.length ? (
            <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-muted">
              {ported.notes.map((n) => (
                <li key={n} className="flex gap-1.5">
                  <span aria-hidden className="text-accent">
                    -
                  </span>
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

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
            <button
              type="button"
              onClick={() =>
                downloadRowsCsv(`${table}-query`, result.columns, result.rows)
              }
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-muted transition-colors hover:text-fg"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Download results as CSV
            </button>
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
