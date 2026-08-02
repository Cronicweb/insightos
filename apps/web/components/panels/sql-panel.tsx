'use client';

import * as React from 'react';
import { Play, Database, TriangleAlert } from 'lucide-react';
import { SectionLabel } from '@/components/ui/primitives';
import type { Analysis } from '@/lib/types';

interface SqlResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('en-GB') : v.toFixed(4);
  return String(v);
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

  React.useEffect(() => {
    if (table) setSql(`SELECT *\nFROM ${table}\nLIMIT 20;`);
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

      <label htmlFor="sql-input" className="sr-only">
        SQL query
      </label>
      <textarea
        id="sql-input"
        value={sql}
        spellCheck={false}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={onKeyDown}
        rows={6}
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
