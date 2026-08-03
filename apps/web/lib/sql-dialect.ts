/**
 * A small, honest SQL dialect translator: DuckDB -> BigQuery / Hive.
 *
 * This is not a parser and does not pretend to be one. It is a scanner over the
 * handful of constructs that actually differ between the three engines, which
 * is a short and enumerable list - date truncation, date differencing,
 * quantiles, type names and identifier quoting. Everything else in the SQL this
 * product emits is ANSI and ports unchanged.
 *
 * The reason to solve it this way rather than with a general transpiler: a
 * general transpiler has to be right about all of SQL, whereas an analyst
 * porting a query only has to be right about the divergences. Encoding the
 * divergences explicitly, with the caveats attached, is both smaller and more
 * useful than a black box - you can read this file and learn the differences.
 *
 * See docs/sql-portability.md for the full construct table this implements.
 */

export type Dialect = 'duckdb' | 'bigquery' | 'hive';

export const DIALECTS: { id: Dialect; label: string }[] = [
  { id: 'duckdb', label: 'DuckDB' },
  { id: 'bigquery', label: 'BigQuery' },
  { id: 'hive', label: 'Hive' },
];

export interface Translation {
  sql: string;
  /** Divergences that a regex cannot fix and a human has to decide about. */
  notes: string[];
}

/** Split a call's argument list on top-level commas, respecting nesting and quotes. */
function splitArgs(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    } else if (ch === '(' || ch === '[') {
      depth += 1;
    } else if (ch === ')' || ch === ']') {
      depth -= 1;
    } else if (ch === ',' && depth === 0) {
      args.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(inner.slice(start).trim());
  return args;
}

/**
 * Rewrite every call to `name(...)`, passing the parsed arguments to `fn`.
 *
 * Scans for the balanced closing parenthesis rather than using a regex, so
 * nested calls such as `DATE_TRUNC('month', MIN(order_date))` survive intact.
 */
function rewriteCalls(sql: string, name: string, fn: (args: string[]) => string | null): string {
  const needle = name.toLowerCase();
  let out = '';
  let i = 0;

  while (i < sql.length) {
    const lower = sql.slice(i).toLowerCase();
    const at = lower.indexOf(needle);
    if (at === -1) {
      out += sql.slice(i);
      break;
    }

    const abs = i + at;
    const before = abs > 0 ? sql[abs - 1] : ' ';
    const afterIdx = abs + name.length;
    const boundary = !/[A-Za-z0-9_]/.test(before) && sql[afterIdx] === '(';

    if (!boundary) {
      out += sql.slice(i, abs + name.length);
      i = abs + name.length;
      continue;
    }

    let depth = 0;
    let quote: string | null = null;
    let end = -1;
    for (let j = afterIdx; j < sql.length; j += 1) {
      const ch = sql[j];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') quote = ch;
      else if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }

    if (end === -1) {
      out += sql.slice(i);
      break;
    }

    const replaced = fn(splitArgs(sql.slice(afterIdx + 1, end)));
    out += sql.slice(i, abs) + (replaced ?? sql.slice(abs, end + 1));
    i = end + 1;
  }

  return out;
}

/** Strip the quotes from a `'month'`-style literal argument. */
function unit(arg: string): string {
  return arg.replace(/^['"]|['"]$/g, '').toLowerCase();
}

/** Convert `"quoted identifiers"` to backticks, leaving string literals alone. */
function backtickIdentifiers(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      const end = sql.indexOf("'", i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop;
    } else if (ch === '"') {
      const end = sql.indexOf('"', i + 1);
      if (end === -1) {
        out += sql.slice(i);
        break;
      }
      out += '`' + sql.slice(i + 1, end) + '`';
      i = end + 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

const HIVE_TRUNC: Record<string, string> = { year: 'YY', quarter: 'Q', month: 'MM' };

/**
 * Constructs whose caveats are worth printing only when the query actually
 * uses them. A note that fires on every query - including `SELECT * LIMIT 20` -
 * teaches a reader to ignore the notes, which defeats the point of having them.
 */
const QUANTILE_RE = /\b(?:QUANTILE_CONT|APPROX_QUANTILE|PERCENTILE_CONT|PERCENTILE_DISC)\s*\(/i;
const READS_A_TABLE_RE = /\bFROM\s+[`"\w]/i;

function toBigQuery(sql: string): Translation {
  const notes: string[] = [];

  let out = rewriteCalls(sql, 'DATE_TRUNC', (a) => {
    if (a.length !== 2) return null;
    const u = unit(a[0]);
    const part = u === 'week' ? 'WEEK(MONDAY)' : u.toUpperCase();
    return `DATE_TRUNC(${a[1]}, ${part})`;
  });

  // BigQuery reverses the operand order and takes the part last.
  out = rewriteCalls(out, 'DATE_DIFF', (a) => {
    if (a.length !== 3) return null;
    return `DATE_DIFF(${a[2]}, ${a[1]}, ${unit(a[0]).toUpperCase()})`;
  });

  out = rewriteCalls(out, 'QUANTILE_CONT', (a) =>
    a.length === 2 ? `PERCENTILE_CONT(${a[0]}, ${a[1]}) OVER ()` : null,
  );

  // There is no scalar approximate quantile; you take 100 buckets and index one.
  out = rewriteCalls(out, 'APPROX_QUANTILE', (a) => {
    if (a.length !== 2) return null;
    const p = Number(a[1]);
    if (!Number.isFinite(p)) return null;
    return `APPROX_QUANTILES(${a[0]}, 100)[OFFSET(${Math.round(p * 100)})]`;
  });

  out = out
    .replace(/\bAS\s+VARCHAR\b/gi, 'AS STRING')
    .replace(/\bAS\s+DOUBLE\b/gi, 'AS FLOAT64')
    .replace(/\bAS\s+(?:INTEGER|BIGINT)\b/gi, 'AS INT64')
    .replace(/\bTRY_CAST\b/gi, 'SAFE_CAST')
    .replace(/\bSELECT\s+\*\s+EXCLUDE\b/gi, 'SELECT * EXCEPT');

  out = backtickIdentifiers(out);

  if (/\bFILTER\s*\(\s*WHERE\b/i.test(out)) {
    notes.push('FILTER (WHERE ...) is not supported - rewrite as SUM(CASE WHEN ... THEN ... END).');
  }
  if (/\bUSING\s+SAMPLE\b/i.test(out)) {
    notes.push('Use TABLESAMPLE SYSTEM (n PERCENT) instead of USING SAMPLE.');
  }

  // Only relevant once the query actually reads a table: a scalar SELECT is
  // free, and billing advice on it would be noise.
  if (READS_A_TABLE_RE.test(sql)) {
    notes.push(
      'Qualify the table as `project.dataset.table`; partition filters are billed, so add one.',
    );
  }
  return { sql: out, notes };
}

function toHive(sql: string): Translation {
  const notes: string[] = [];

  let out = rewriteCalls(sql, 'DATE_TRUNC', (a) => {
    if (a.length !== 2) return null;
    const u = unit(a[0]);
    if (HIVE_TRUNC[u]) return `TRUNC(${a[1]}, '${HIVE_TRUNC[u]}')`;
    if (u === 'day') return `TO_DATE(${a[1]})`;
    // Monday-aligned week, matching DuckDB's ISO convention.
    if (u === 'week') return `DATE_SUB(${a[1]}, PMOD(DATEDIFF(${a[1]}, '1970-01-05'), 7))`;
    return null;
  });

  out = rewriteCalls(out, 'DATE_DIFF', (a) => {
    if (a.length !== 3) return null;
    const u = unit(a[0]);
    if (u === 'day') return `DATEDIFF(${a[2]}, ${a[1]})`;
    if (u === 'month') return `CAST(MONTHS_BETWEEN(${a[2]}, ${a[1]}) AS INT)`;
    if (u === 'year') return `CAST(MONTHS_BETWEEN(${a[2]}, ${a[1]}) / 12 AS INT)`;
    return null;
  });

  // Hive has no exact continuous quantile; the approximate form is the idiom.
  out = rewriteCalls(out, 'QUANTILE_CONT', (a) =>
    a.length === 2 ? `percentile_approx(${a[0]}, ${a[1]})` : null,
  );
  out = rewriteCalls(out, 'APPROX_QUANTILE', (a) =>
    a.length === 2 ? `percentile_approx(${a[0]}, ${a[1]})` : null,
  );
  out = rewriteCalls(out, 'STRING_AGG', (a) =>
    a.length === 2 ? `concat_ws(${a[1]}, collect_list(${a[0]}))` : null,
  );

  // There is no approximate distinct count, so it degrades to the exact one.
  out = rewriteCalls(out, 'APPROX_COUNT_DISTINCT', (a) =>
    a.length === 1 ? `COUNT(DISTINCT ${a[0]})` : null,
  );

  out = out.replace(/\bAS\s+VARCHAR\b/gi, 'AS STRING').replace(/\bTRY_CAST\b/gi, 'CAST');

  out = backtickIdentifiers(out);

  if (/\bQUALIFY\b/i.test(out)) {
    notes.push(
      'QUALIFY does not exist - move the window function into a CTE and filter outside it.',
    );
  }
  if (/\bFILTER\s*\(\s*WHERE\b/i.test(out)) {
    notes.push('FILTER (WHERE ...) is not supported - rewrite as SUM(CASE WHEN ... THEN ... END).');
  }
  if (/\bAPPROX_COUNT_DISTINCT\b/i.test(sql)) {
    notes.push('There is no approximate distinct count; this became an exact COUNT(DISTINCT ...).');
  }
  if (/\bGROUPING\s*\(/i.test(out)) {
    notes.push('GROUPING(col) is spelled GROUPING__ID here and returns a bitmask, not a flag.');
  }

  // Fires only when a quantile was actually rewritten, so the accuracy warning
  // stays attached to the one construct where accuracy genuinely changed.
  if (QUANTILE_RE.test(sql)) {
    notes.push('percentile_approx is approximate by construction; DuckDB QUANTILE_CONT is exact.');
  }
  return { sql: out, notes };
}

/**
 * Translate DuckDB SQL into the requested dialect.
 *
 * Returns the rewritten SQL plus any divergence that cannot be mechanically
 * fixed, because silently emitting SQL that will not run is worse than saying
 * which line a human has to look at.
 */
export function translate(sql: string, dialect: Dialect): Translation {
  if (dialect === 'duckdb') return { sql, notes: [] };
  return dialect === 'bigquery' ? toBigQuery(sql) : toHive(sql);
}
