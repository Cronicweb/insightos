/**
 * Thin, safe helpers over a DuckDB-WASM connection.
 *
 * Everything the browser engine computes goes through here, so this is also
 * where Arrow values are normalised into plain JSON: DuckDB returns BigInt for
 * 64-bit integers and Arrow objects for dates, neither of which survive
 * `JSON.stringify` or React rendering.
 */
import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';

export type Row = Record<string, unknown>;

/** Quote an identifier so user column names can never break out into SQL. */
export function ident(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** Quote a string literal. */
export function lit(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function normalise(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const asAny = value as { toJSON?: () => unknown; toString?: () => string };
    if (typeof asAny.toJSON === 'function') return normalise(asAny.toJSON());
    return String(asAny.toString ? asAny.toString() : value);
  }
  return value;
}

/** Run a query and materialise it as plain JS objects. */
export async function query<T extends Row = Row>(conn: AsyncDuckDBConnection, sql: string): Promise<T[]> {
  const table = await conn.query(sql);
  const fields = table.schema.fields.map((f: { name: string }) => f.name);
  const out: T[] = [];
  for (const record of table.toArray()) {
    const row: Row = {};
    for (const field of fields) {
      row[field] = normalise((record as unknown as Row)[field]);
    }
    out.push(row as T);
  }
  return out;
}

/** Run a query expected to return exactly one row. */
export async function queryOne<T extends Row = Row>(conn: AsyncDuckDBConnection, sql: string): Promise<T> {
  const rows = await query<T>(conn, sql);
  return rows[0] ?? ({} as T);
}

/** Coerce a SQL scalar to a finite number, or null. */
export function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Coerce a SQL scalar to a number, substituting a fallback. */
export function numOr(value: unknown, fallback = 0): number {
  return num(value) ?? fallback;
}

export function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/** Round to a sane number of decimals so payloads stay small and readable. */
export function round(value: number | null, digits = 4): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
