/**
 * Post-ingest column repair.
 *
 * DuckDB's CSV sniffer resolves ISO-8601 dates well, but it gives up on the
 * regional formats that dominate real exports - `12/01/2010 08:26:00`
 * (MM/DD/YYYY) from a UK retail system, `01.12.2010` from a German ERP - and
 * silently hands the column back as VARCHAR. Downstream that is fatal rather
 * than cosmetic: a dataset with no temporal column has no period-over-period
 * deltas, no trend charts and no forecast, so the analysis quietly degrades to
 * a pile of totals.
 *
 * This module runs immediately after the table is built and repairs two
 * classes of defect that would otherwise be invisible:
 *
 *   1. Text columns that are really timestamps, recovered by scoring a list of
 *      candidate `strptime` formats and adopting the one that parses.
 *   2. A missing revenue measure on transaction-grain data, where the money is
 *      stored as unit price and has to be multiplied by quantity before any
 *      total means anything. Summing a price column is arithmetic on an
 *      intensive quantity - it produces a number, but never a meaningful one.
 *
 * Both repairs are conservative: a format must parse essentially every
 * non-null value before it is adopted, and the derived measure is only added
 * when the dataset has no revenue-like column of its own.
 */
import type * as duckdb from '@duckdb/duckdb-wasm';
import { ident, lit, query, queryOne, numOr } from './sql';

/**
 * Candidate timestamp formats, most specific first.
 *
 * Ordering matters for genuinely ambiguous data. `03/04/2011` is valid under
 * both MM/DD and DD/MM, so whichever is tried first wins a tie - we prefer
 * MM/DD because it is what Excel emits on a US locale, which is the single
 * most common source of regional CSV exports. Unambiguous files settle
 * themselves: a column containing `13/05/2011` scores 100% on DD/MM and fails
 * MM/DD outright, so the correct format is chosen on evidence, not on the
 * ordering here.
 */
export const TIMESTAMP_FORMATS: string[] = [
  '%Y-%m-%d %H:%M:%S',
  '%Y-%m-%dT%H:%M:%S',
  '%Y-%m-%d %H:%M',
  '%Y-%m-%d',
  '%Y/%m/%d %H:%M:%S',
  '%Y/%m/%d',
  '%m/%d/%Y %H:%M:%S',
  '%m/%d/%Y %H:%M',
  '%m/%d/%Y',
  '%d/%m/%Y %H:%M:%S',
  '%d/%m/%Y %H:%M',
  '%d/%m/%Y',
  '%d-%m-%Y %H:%M:%S',
  '%d-%m-%Y',
  '%m-%d-%Y %H:%M:%S',
  '%m-%d-%Y',
  '%d.%m.%Y %H:%M:%S',
  '%d.%m.%Y',
  '%d-%b-%Y',
  '%d %b %Y',
  '%b %d, %Y',
  '%d-%B-%Y',
  '%Y%m%d',
];

/** Column names that promise a date even when the values are stored as text. */
export const DATE_NAME_RE = /(date|day|month|week|year|time|timestamp|period|_at$|_on$|dt$|^dt)/i;

/**
 * Shape of a value that could plausibly be a date: digits separated by
 * `/`, `-` or `.`, optionally followed by a clock. Used to catch date columns
 * whose names give nothing away (`created`, `col_4`).
 */
export const DATE_VALUE_RE = /^\s*\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}([ T]\d{1,2}:\d{2}(:\d{2})?)?\s*$/;

/** A fraction this high means the format explains the column, not a subset. */
const ADOPT_THRESHOLD = 0.98;

export interface Coercion {
  column: string;
  from: string;
  to: string;
  format: string | null;
  parsed: number;
  total: number;
  note: string;
}

// `query<T>` constrains T to an indexable row shape, so the index signature is
// what makes this a legal type argument rather than cosmetic.
interface ColumnRow {
  [key: string]: unknown;
  column_name: unknown;
  data_type: unknown;
}

async function tableColumns(
  conn: duckdb.AsyncDuckDBConnection,
  table: string,
): Promise<{ name: string; type: string }[]> {
  const rows = await query<ColumnRow>(
    conn,
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = ${lit(table)} ORDER BY ordinal_position`,
  );
  return rows.map((r) => ({ name: String(r.column_name), type: String(r.data_type).toUpperCase() }));
}

/**
 * Does this text column look like it holds dates? Cheap pre-filter so we never
 * run twenty `strptime` passes over a description column.
 */
async function looksTemporal(
  conn: duckdb.AsyncDuckDBConnection,
  table: string,
  column: string,
): Promise<boolean> {
  if (DATE_NAME_RE.test(column)) return true;
  const sample = await query<{ v: unknown }>(
    conn,
    `SELECT CAST(${ident(column)} AS VARCHAR) AS v FROM ${ident(table)}
      WHERE ${ident(column)} IS NOT NULL LIMIT 25`,
  );
  return looksLikeDateColumn(column, sample.map((r) => String(r.v)));
}

/**
 * Shared by the name check and the value sniff so both stay in step, and
 * exported so the decision can be tested without a WASM database.
 */
export function looksLikeDateColumn(name: string, values: string[]): boolean {
  if (DATE_NAME_RE.test(name)) return true;
  if (!values.length) return false;
  const hits = values.filter((v) => DATE_VALUE_RE.test(v)).length;
  return hits / values.length >= 0.9;
}

/**
 * Score every candidate format against the column and return the best one.
 *
 * `try_strptime` returns NULL instead of raising, so a single pass over the
 * column yields an exact parse count - no sampling error, no guessing.
 */
async function bestFormat(
  conn: duckdb.AsyncDuckDBConnection,
  table: string,
  column: string,
): Promise<{ format: string; parsed: number; total: number } | null> {
  const totalRow = await queryOne<{ n: unknown }>(
    conn,
    `SELECT count(*) AS n FROM ${ident(table)}
      WHERE ${ident(column)} IS NOT NULL AND trim(CAST(${ident(column)} AS VARCHAR)) <> ''`,
  );
  const total = numOr(totalRow.n);
  if (total === 0) return null;

  // One scan, one column per candidate: twenty cheap predicates beat twenty
  // full table scans on a half-million-row upload.
  const selects = TIMESTAMP_FORMATS.map(
    (fmt, i) =>
      `count(*) FILTER (WHERE try_strptime(trim(CAST(${ident(column)} AS VARCHAR)), ${lit(fmt)}) IS NOT NULL) AS f${i}`,
  ).join(', ');
  const row = await queryOne<Record<string, unknown>>(
    conn,
    `SELECT ${selects} FROM ${ident(table)}
      WHERE ${ident(column)} IS NOT NULL AND trim(CAST(${ident(column)} AS VARCHAR)) <> ''`,
  );

  const counts: Record<string, number> = {};
  TIMESTAMP_FORMATS.forEach((fmt, i) => {
    counts[fmt] = numOr(row[`f${i}`]);
  });
  return pickBestFormat(counts, total);
}

/**
 * Choose the format that explains the column.
 *
 * Pure and exported, because this decision is the part that is easy to get
 * wrong and expensive to debug through a browser. Ties go to the earlier
 * entry in `TIMESTAMP_FORMATS` - the documented MM/DD-before-DD/MM preference
 * for data that is genuinely ambiguous.
 */
export function pickBestFormat(
  counts: Record<string, number>,
  total: number,
): { format: string; parsed: number; total: number } | null {
  if (total <= 0) return null;
  let best: { format: string; parsed: number; total: number } | null = null;
  for (const fmt of TIMESTAMP_FORMATS) {
    const parsed = counts[fmt] ?? 0;
    if (parsed / total >= ADOPT_THRESHOLD && (!best || parsed > best.parsed)) {
      best = { format: fmt, parsed, total };
    }
  }
  return best;
}

/**
 * Convert text columns that are really timestamps.
 *
 * Values that do not match the adopted format become NULL rather than failing
 * the run - the quality report already counts nulls, so a stray malformed row
 * shows up as a data-quality issue instead of taking the whole analysis down.
 */
export async function coerceTemporalColumns(
  conn: duckdb.AsyncDuckDBConnection,
  table: string,
): Promise<Coercion[]> {
  const coercions: Coercion[] = [];
  const columns = await tableColumns(conn, table);

  for (const col of columns) {
    if (!col.type.startsWith('VARCHAR')) continue;
    if (!(await looksTemporal(conn, table, col.name))) continue;

    const match = await bestFormat(conn, table, col.name);
    if (!match) continue;

    try {
      await conn.query(
        `ALTER TABLE ${ident(table)} ALTER ${ident(col.name)} TYPE TIMESTAMP
           USING try_strptime(trim(CAST(${ident(col.name)} AS VARCHAR)), ${lit(match.format)})`,
      );
    } catch {
      // A column that refuses to convert stays text; the analysis simply runs
      // without that time axis, exactly as it did before this repair existed.
      continue;
    }

    coercions.push({
      column: col.name,
      from: col.type,
      to: 'TIMESTAMP',
      format: match.format,
      parsed: match.parsed,
      total: match.total,
      note: `${col.name} was stored as text; parsed as ${match.format} (${match.parsed.toLocaleString('en-GB')} of ${match.total.toLocaleString('en-GB')} values).`,
    });
  }

  return coercions;
}

const REVENUE_NAME_RE =
  /(revenue|sales_amount|net_sales|gross_sales|turnover|billings|gmv|total_amount|line_total|extended_price|amount$|transaction_amount)/i;
const QUANTITY_NAME_RE = /(quantity|qty|units|item_count|no_of_items)/i;
const UNIT_PRICE_NAME_RE = /(unit_?price|unit_?cost|price_?per|rate_?per|list_price|^price$|_price$)/i;
const NUMERIC_TYPES = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|FLOAT|DOUBLE|REAL|DECIMAL|NUMERIC)/;

export interface DerivedMeasure {
  column: string;
  expression: string;
  note: string;
}

/**
 * Add a revenue column to transaction-grain data that only stores unit price.
 *
 * Without this the role resolver falls back to "largest unclaimed monetary
 * column" and adopts the unit price, so the headline KPI becomes
 * `sum(UnitPrice)` - on the UCI Online Retail set that reports $2.50M against
 * a true revenue of GBP 9.75M. The number is not merely imprecise, it is a
 * category error: prices are per-unit and do not add up.
 */
export function planRevenueDerivation(
  columns: { name: string; type: string }[],
): { quantity: string; price: string } | null {
  const numeric = columns.filter((c) => NUMERIC_TYPES.test(c.type.toUpperCase()));

  // Never override a dataset that already reports its own revenue.
  if (numeric.some((c) => REVENUE_NAME_RE.test(c.name))) return null;
  if (columns.some((c) => c.name.toLowerCase() === 'revenue')) return null;

  const quantity = numeric.find((c) => QUANTITY_NAME_RE.test(c.name));
  const price = numeric.find((c) => UNIT_PRICE_NAME_RE.test(c.name));
  if (!quantity || !price) return null;
  return { quantity: quantity.name, price: price.name };
}

export async function deriveRevenueColumn(
  conn: duckdb.AsyncDuckDBConnection,
  table: string,
): Promise<DerivedMeasure | null> {
  const plan = planRevenueDerivation(await tableColumns(conn, table));
  if (!plan) return null;

  const expression = `${ident(plan.quantity)} * ${ident(plan.price)}`;
  try {
    await conn.query(`ALTER TABLE ${ident(table)} ADD COLUMN ${ident('Revenue')} DOUBLE`);
    await conn.query(
      `UPDATE ${ident(table)} SET ${ident('Revenue')} =
         CAST(${ident(plan.quantity)} AS DOUBLE) * CAST(${ident(plan.price)} AS DOUBLE)`,
    );
  } catch {
    return null;
  }

  return {
    column: 'Revenue',
    expression,
    note: `Revenue derived as ${plan.quantity} x ${plan.price}; the dataset stores price per unit, which cannot be summed on its own.`,
  };
}
