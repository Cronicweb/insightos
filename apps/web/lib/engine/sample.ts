/**
 * Loading a demo dataset's published sample into the browser database.
 *
 * A demo analysis is pre-computed: the Python engine ran over the full dataset
 * at build time and only its conclusions are shipped as JSON, which is why the
 * SQL console historically had no table to execute against. It is not the case
 * that no rows exist, though - `insightos demo build --with-data` publishes a
 * sample of the *real* rows next to each analysis, carrying the real schema.
 *
 * Loading that sample into the same DuckDB instance an upload would use keeps
 * one execution path in the codebase: the console is the engine either way, and
 * the only difference is how many rows are behind it. That difference is real
 * and is stated in the UI rather than papered over - aggregates over a sample
 * will not reconcile with the dashboard, which was computed over everything.
 */
import { getDuckDb } from '@/lib/duckdb/client';
import { ident, lit, query } from './sql';

export interface SampleTable {
  table: string;
  /** Rows actually loaded, which is the sample size, not the dataset size. */
  rows: number;
  columns: string[];
}

export async function loadSampleTable(
  table: string,
  rows: Record<string, unknown>[],
): Promise<SampleTable> {
  if (!rows.length) {
    throw new Error('This dataset publishes no sample rows, so there is nothing to query.');
  }

  const { db, conn } = await getDuckDb();

  // The sample is already in memory as parsed JSON; handing DuckDB the bytes
  // rather than a stream of INSERTs reuses read_json_auto, the same sniffer an
  // uploaded .json file goes through.
  const virtualPath = `sample_${table}_${Date.now()}.json`;
  await db.registerFileBuffer(virtualPath, new TextEncoder().encode(JSON.stringify(rows)));

  await conn.query(`DROP TABLE IF EXISTS ${ident(table)}`);
  await conn.query(
    `CREATE TABLE ${ident(table)} AS SELECT * FROM read_json_auto(${lit(virtualPath)})`,
  );

  // JSON has no date type, so ISO timestamps arrive as text and DATE_TRUNC
  // would fail on them. The generated recipes cast defensively, but repairing
  // the columns means a hand-written query behaves exactly as it would against
  // an uploaded file. A sample that resists coercion is still queryable as text.
  try {
    const { coerceTemporalColumns } = await import('./coerce');
    await coerceTemporalColumns(conn, table);
  } catch {
    // Non-fatal by design: worse types, not a broken console.
  }

  const probe = await query(conn, `SELECT * FROM ${ident(table)} LIMIT 1`);
  return {
    table,
    rows: rows.length,
    columns: probe.length ? Object.keys(probe[0]) : [],
  };
}
