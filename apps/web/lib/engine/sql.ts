/**
 * Thin, safe helpers over a DuckDB-WASM connection.
 *
 * Everything the browser engine computes goes through here, so this is also
 * where Arrow values are normalised into plain JSON. Three Arrow shapes do not
 * survive `JSON.stringify` or React rendering unaided:
 *
 *  - 64-bit integers arrive as `bigint`;
 *  - 128-bit integers (DuckDB widens `sum()` over an integer column to HUGEINT)
 *    arrive as a little-endian `Uint32Array` whose `toJSON` returns a
 *    *quote-wrapped* string, so `SUM(units)` rendered as `"1070"`;
 *  - dates and timestamps arrive as bare epoch numbers whose unit depends on
 *    the Arrow type, so `order_date` rendered as `1,767,398,400,000`.
 *
 * Normalisation is type-aware: the Arrow field type decides whether a number is
 * a quantity or an instant.
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

export type FieldKind = 'date' | 'timestamp' | 'other';

/** Classify an Arrow field type without importing the Arrow type registry. */
export function fieldKind(type: unknown): FieldKind {
  const s = String(type ?? '').toLowerCase();
  if (s.startsWith('date')) return 'date';
  if (s.startsWith('timestamp')) return 'timestamp';
  return 'other';
}

const MS_PER_DAY = 86_400_000;

/**
 * Render an epoch value as a readable instant. The unit is inferred from the
 * magnitude because DuckDB-WASM emits days (DATE32), milliseconds (DATE64),
 * microseconds (the usual TIMESTAMP) or nanoseconds depending on the column.
 */
export function formatInstant(value: number, kind: 'date' | 'timestamp'): string | null {
  if (!Number.isFinite(value)) return null;
  const magnitude = Math.abs(value);
  let ms: number;
  if (magnitude > 1e16) ms = value / 1e6; // nanoseconds
  else if (magnitude > 1e14) ms = value / 1e3; // microseconds
  else if (magnitude > 1e11) ms = value; // milliseconds
  else if (kind === 'date') ms = value * MS_PER_DAY; // days since epoch
  else ms = value * 1000; // seconds
  const d = new Date(Math.round(ms));
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString();
  return kind === 'date' ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
}

/** Arrow's BigNum `toJSON` wraps the digits in literal quote characters. */
const QUOTED_NUMBER = /^"(-?\d+)"$/;

function fromWords(view: ArrayBufferView): number | null {
  const words = new Uint32Array(view.buffer, view.byteOffset, view.byteLength / 4);
  if (!words.length) return null;
  let acc = 0n;
  for (let i = words.length - 1; i >= 0; i -= 1) acc = (acc << 32n) | BigInt(words[i]);
  const bits = BigInt(words.length * 32);
  const signed = acc >= 1n << (bits - 1n) ? acc - (1n << bits) : acc;
  return Number(signed);
}

/**
 * Turn one Arrow scalar into something React can render and `JSON.stringify`
 * can serialise. Exported so the behaviour is testable without a browser.
 */
export function coerceSqlValue(value: unknown, kind: FieldKind = 'other'): unknown {
  if (value === null || value === undefined) return null;

  const instant = (n: number) =>
    kind === 'other' ? n : (formatInstant(n, kind) ?? n);

  if (typeof value === 'number') return instant(value);
  if (typeof value === 'bigint') return instant(Number(value));
  if (value instanceof Date) return instant(value.getTime());
  if (typeof value === 'boolean') return value;

  // HUGEINT / DECIMAL: a typed array of little-endian 32-bit words. Arrow swaps
  // the prototype on these, so `instanceof Uint32Array` is unreliable -
  // `ArrayBuffer.isView` reads the internal slot and always holds.
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const n = fromWords(value);
    if (n !== null && Number.isFinite(n)) return instant(n);
  }

  if (typeof value === 'string') {
    const quoted = QUOTED_NUMBER.exec(value);
    return quoted ? instant(Number(quoted[1])) : value;
  }

  if (typeof value === 'object') {
    const asAny = value as { toJSON?: () => unknown; toString?: () => string };
    if (typeof asAny.toJSON === 'function') return coerceSqlValue(asAny.toJSON(), kind);
    return String(asAny.toString ? asAny.toString() : value);
  }
  return value;
}

/** Run a query and materialise it as plain JS objects. */
export async function query<T extends Row = Row>(conn: AsyncDuckDBConnection, sql: string): Promise<T[]> {
  const table = await conn.query(sql);
  const fields = table.schema.fields.map((f: { name: string; type?: unknown }) => ({
    name: f.name,
    kind: fieldKind(f.type),
  }));
  const out: T[] = [];
  for (const record of table.toArray()) {
    const row: Row = {};
    for (const field of fields) {
      row[field.name] = coerceSqlValue((record as unknown as Row)[field.name], field.kind);
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
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  // DuckDB widens integer sums to HUGEINT; Arrow hands those back as
  // little-endian 32-bit words, which Number() turns into NaN.
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const decoded = fromWords(value);
    if (decoded !== null && Number.isFinite(decoded)) return decoded;
  }
  if (typeof value === 'string') {
    const quoted = QUOTED_NUMBER.exec(value);
    if (quoted) return Number(quoted[1]);
  }
  const n = Number(value);
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
