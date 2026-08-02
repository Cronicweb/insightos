/**
 * Dataset profiling, executed entirely as SQL inside DuckDB.
 *
 * This mirrors `insightos.profiling` in the Python core: the same semantic
 * types, the same primary-key heuristic, the same measure/dimension split. The
 * UI cannot tell whether a profile came from pandas on a server or from DuckDB
 * in the tab.
 */
import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import type { ColumnProfile, DatasetSchema } from '@/lib/types';
import { ident, lit, num, numOr, query, queryOne, round, str, type Row } from './sql';

export type SemanticType =
  | 'datetime'
  | 'boolean'
  | 'currency'
  | 'percentage'
  | 'count'
  | 'numeric'
  | 'identifier'
  | 'categorical'
  | 'text';

const CURRENCY_RE = /(revenue|sales|amount|price|cost|spend|value|profit|margin|fee|balance|payment|charge|salary|budget|gmv|aov|arpu|income|expense|claim|premium|wage)/i;
const PERCENT_RE = /(pct|percent|rate|ratio|share|_pp$|utilisation|utilization|occupancy)/i;
const COUNT_RE = /(count|qty|quantity|units|visits|sessions|clicks|impressions|orders|tickets|calls|logins|views|transactions)/i;
const ID_RE = /(^id$|_id$|^id_|uuid|guid|code$|number$|_no$|_key$|account|customer|member|patient|employee|merchant|invoice|transaction_id)/i;
const DATE_RE = /(date|day|month|week|year|time|timestamp|period|_at$|_on$)/i;

function isNumericType(dtype: string): boolean {
  return /^(TINY|SMALL|BIG|HUGE)?INT|^INTEGER|^DECIMAL|^NUMERIC|^DOUBLE|^FLOAT|^REAL|^UBIGINT|^UINTEGER|^USMALLINT|^UTINYINT/i.test(
    dtype,
  );
}
function isTemporalType(dtype: string): boolean {
  return /^(DATE|TIMESTAMP|TIME)/i.test(dtype);
}
function isBooleanType(dtype: string): boolean {
  return /^BOOLEAN/i.test(dtype);
}

function classify(
  name: string,
  dtype: string,
  unique: number,
  rows: number,
  minValue: number | null,
  maxValue: number | null,
): SemanticType {
  if (isTemporalType(dtype)) return 'datetime';
  if (isBooleanType(dtype)) return 'boolean';
  const uniqueRatio = rows > 0 ? unique / rows : 0;
  if (isNumericType(dtype)) {
    // A 0/1 integer column is a flag, not a measure.
    if (unique <= 2 && (minValue === null || minValue >= 0) && (maxValue === null || maxValue <= 1)) {
      return 'boolean';
    }
    if (PERCENT_RE.test(name)) return 'percentage';
    if (CURRENCY_RE.test(name)) return 'currency';
    if (COUNT_RE.test(name)) return 'count';
    // A near-unique integer named like a key is an identifier, not a metric.
    if (ID_RE.test(name) && uniqueRatio > 0.5) return 'identifier';
    return 'numeric';
  }
  if (ID_RE.test(name) && uniqueRatio > 0.5) return 'identifier';
  if (uniqueRatio > 0.6 && unique > 200) return 'text';
  if (unique <= Math.max(60, rows * 0.05)) return 'categorical';
  return 'text';
}

/** Values that read as "missing" even though they are not SQL NULL. */
const BLANKS = ["''", "'null'", "'NULL'", "'N/A'", "'n/a'", "'-'", "'NaN'", "'None'", "'unknown'"];

export interface ProfileResult {
  schema: DatasetSchema;
  /** Column name -> semantic type, used by every downstream stage. */
  semantic: Record<string, SemanticType>;
  dtypes: Record<string, string>;
}

export async function profileTable(
  conn: AsyncDuckDBConnection,
  table: string,
  datasetName: string,
): Promise<ProfileResult> {
  const t = ident(table);
  const rowsRow = await queryOne(conn, `SELECT count(*) AS n FROM ${t}`);
  const rows = numOr(rowsRow.n);

  const described = await query(
    conn,
    `SELECT column_name AS name, data_type AS dtype
       FROM information_schema.columns
      WHERE table_name = ${lit(table)}
      ORDER BY ordinal_position`,
  );

  const columns: ColumnProfile[] = [];
  const semantic: Record<string, SemanticType> = {};
  const dtypes: Record<string, string> = {};

  for (const meta of described) {
    const name = str(meta.name);
    const dtype = str(meta.dtype);
    const c = ident(name);
    dtypes[name] = dtype;

    const numeric = isNumericType(dtype);
    const temporal = isTemporalType(dtype);
    const stats: string[] = [
      `count(${c}) AS non_null`,
      `count(DISTINCT ${c}) AS uniq`,
    ];
    if (numeric) {
      stats.push(
        `min(${c}) AS lo`,
        `max(${c}) AS hi`,
        `avg(${c}) AS mean`,
        `median(${c}) AS med`,
        `stddev_samp(${c}) AS sd`,
      );
    } else if (temporal) {
      stats.push(`min(${c}) AS lo`, `max(${c}) AS hi`);
    } else {
      stats.push(`min(CAST(${c} AS VARCHAR)) AS lo`, `max(CAST(${c} AS VARCHAR)) AS hi`);
      stats.push(
        `sum(CASE WHEN trim(CAST(${c} AS VARCHAR)) IN (${BLANKS.join(', ')}) THEN 1 ELSE 0 END) AS blanks`,
      );
    }

    const s = await queryOne(conn, `SELECT ${stats.join(', ')} FROM ${t}`);
    const nonNull = numOr(s.non_null);
    const blanks = numOr(s.blanks);
    const missing = rows - nonNull + blanks;
    const unique = numOr(s.uniq);
    const lo = numeric ? num(s.lo) : null;
    const hi = numeric ? num(s.hi) : null;

    const top = await query(
      conn,
      `SELECT CAST(${c} AS VARCHAR) AS value, count(*) AS n
         FROM ${t} WHERE ${c} IS NOT NULL
        GROUP BY 1 ORDER BY n DESC LIMIT 8`,
    );
    const samples = await query(
      conn,
      `SELECT DISTINCT CAST(${c} AS VARCHAR) AS v FROM ${t} WHERE ${c} IS NOT NULL LIMIT 5`,
    );

    const kind = classify(name, dtype, unique, rows, lo, hi);
    semantic[name] = kind;

    // Shannon entropy over the observed value distribution, in bits.
    let entropy: number | null = null;
    if (kind === 'categorical' || kind === 'boolean') {
      const dist = await query(
        conn,
        `SELECT count(*) AS n FROM ${t} WHERE ${c} IS NOT NULL GROUP BY ${c}`,
      );
      const total = dist.reduce((acc, r) => acc + numOr(r.n), 0);
      entropy = total
        ? -dist.reduce((acc, r) => {
            const p = numOr(r.n) / total;
            return p > 0 ? acc + p * Math.log2(p) : acc;
          }, 0)
        : null;
    }

    columns.push({
      name,
      dtype,
      semantic_type: kind,
      count: nonNull,
      missing,
      missing_pct: rows ? round((missing / rows) * 100, 2)! : 0,
      unique,
      unique_pct: rows ? round((unique / rows) * 100, 2)! : 0,
      is_unique: rows > 0 && unique === rows && missing === 0,
      is_constant: unique <= 1,
      sample_values: samples.map((r) => str(r.v)),
      min: numeric ? round(lo, 4) : temporal ? str(s.lo) : str(s.lo).slice(0, 60),
      max: numeric ? round(hi, 4) : temporal ? str(s.hi) : str(s.hi).slice(0, 60),
      mean: numeric ? round(num(s.mean), 4) : null,
      median: numeric ? round(num(s.med), 4) : null,
      std: numeric ? round(num(s.sd), 4) : null,
      top_values: top.map((r) => ({
        value: str(r.value),
        count: numOr(r.n),
        pct: rows ? round((numOr(r.n) / rows) * 100, 2)! : 0,
      })),
      entropy: round(entropy, 3),
      min_date: temporal ? str(s.lo).slice(0, 10) : null,
      max_date: temporal ? str(s.hi).slice(0, 10) : null,
    });
  }

  const timeColumns = columns
    .filter((c) => c.semantic_type === 'datetime' || (DATE_RE.test(c.name) && c.dtype.startsWith('VARCHAR') === false))
    .map((c) => c.name);
  const identifiers = columns.filter((c) => c.semantic_type === 'identifier').map((c) => c.name);
  const measures = columns
    .filter((c) => ['currency', 'percentage', 'count', 'numeric'].includes(c.semantic_type))
    .map((c) => c.name);
  const dimensions = columns
    .filter((c) => ['categorical', 'boolean'].includes(c.semantic_type) && !c.is_constant)
    .map((c) => c.name);

  // Primary key: prefer a single fully-unique identifier column.
  const primaryKey = columns.filter((c) => c.is_unique && c.semantic_type !== 'datetime').map((c) => c.name);

  return {
    schema: {
      name: datasetName,
      rows,
      columns,
      primary_key: primaryKey.slice(0, 1),
      identifiers,
      measures,
      dimensions,
      time_columns: timeColumns,
    },
    semantic,
    dtypes,
  };
}

export { isNumericType, isTemporalType, DATE_RE, CURRENCY_RE, PERCENT_RE, COUNT_RE, ID_RE };
export type { Row };
