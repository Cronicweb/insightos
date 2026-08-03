import { describe, expect, it } from 'vitest';
import { translate } from '@/lib/sql-dialect';

/**
 * The dialect translator only has to be right about the constructs that
 * actually diverge, so these lock down exactly those - and the two traps that
 * cause silently wrong results rather than syntax errors: DATE_DIFF's reversed
 * operand order in BigQuery, and Hive's approximate-only quantiles.
 */
describe('DuckDB passthrough', () => {
  it('changes nothing', () => {
    const sql = "SELECT DATE_TRUNC('month', d) FROM t;";
    expect(translate(sql, 'duckdb').sql).toBe(sql);
  });
});

describe('date truncation', () => {
  it('moves the part to the second argument for BigQuery', () => {
    expect(translate("DATE_TRUNC('month', order_date)", 'bigquery').sql).toBe(
      'DATE_TRUNC(order_date, MONTH)',
    );
  });

  it('uses the Monday-anchored week part for BigQuery', () => {
    expect(translate("DATE_TRUNC('week', d)", 'bigquery').sql).toBe('DATE_TRUNC(d, WEEK(MONDAY))');
  });

  it('uses the TRUNC format code for Hive', () => {
    expect(translate("DATE_TRUNC('month', order_date)", 'hive').sql).toBe("TRUNC(order_date, 'MM')");
  });

  it('computes a Monday-aligned week arithmetically for Hive', () => {
    expect(translate("DATE_TRUNC('week', d)", 'hive').sql).toBe(
      "DATE_SUB(d, PMOD(DATEDIFF(d, '1970-01-05'), 7))",
    );
  });

  it('survives a nested call in the argument', () => {
    expect(translate("DATE_TRUNC('month', MIN(order_date))", 'bigquery').sql).toBe(
      'DATE_TRUNC(MIN(order_date), MONTH)',
    );
  });
});

describe('date differencing', () => {
  it('reverses the operand order for BigQuery', () => {
    expect(translate("DATE_DIFF('month', cohort, period)", 'bigquery').sql).toBe(
      'DATE_DIFF(period, cohort, MONTH)',
    );
  });

  it('reverses the operand order for Hive', () => {
    expect(translate("DATE_DIFF('day', a, b)", 'hive').sql).toBe('DATEDIFF(b, a)');
  });

  it('uses MONTHS_BETWEEN for Hive months', () => {
    expect(translate("DATE_DIFF('month', a, b)", 'hive').sql).toBe(
      'CAST(MONTHS_BETWEEN(b, a) AS INT)',
    );
  });
});

describe('quantiles', () => {
  it('turns an exact quantile into a windowed PERCENTILE_CONT for BigQuery', () => {
    expect(translate('QUANTILE_CONT(amount, 0.5)', 'bigquery').sql).toBe(
      'PERCENTILE_CONT(amount, 0.5) OVER ()',
    );
  });

  it('indexes a 100-bucket approximation for BigQuery', () => {
    expect(translate('APPROX_QUANTILE(amount, 0.9)', 'bigquery').sql).toBe(
      'APPROX_QUANTILES(amount, 100)[OFFSET(90)]',
    );
  });

  it('warns that Hive can only approximate', () => {
    const out = translate('QUANTILE_CONT(amount, 0.5)', 'hive');
    expect(out.sql).toBe('percentile_approx(amount, 0.5)');
    expect(out.notes.some((n) => n.includes('approximate'))).toBe(true);
  });
});

describe('type names and casts', () => {
  it('maps DuckDB type names to BigQuery ones', () => {
    expect(translate('CAST(x AS VARCHAR)', 'bigquery').sql).toBe('CAST(x AS STRING)');
    expect(translate('CAST(x AS DOUBLE)', 'bigquery').sql).toBe('CAST(x AS FLOAT64)');
    expect(translate('CAST(x AS BIGINT)', 'bigquery').sql).toBe('CAST(x AS INT64)');
  });

  it('maps TRY_CAST to each engine equivalent', () => {
    expect(translate('TRY_CAST(x AS INTEGER)', 'bigquery').sql).toBe('SAFE_CAST(x AS INT64)');
    expect(translate('TRY_CAST(x AS VARCHAR)', 'hive').sql).toBe('CAST(x AS STRING)');
  });

  it('degrades an approximate distinct count to an exact one for Hive', () => {
    expect(translate('APPROX_COUNT_DISTINCT(id)', 'hive').sql).toBe('COUNT(DISTINCT id)');
  });
});

describe('identifier quoting', () => {
  it('rewrites double-quoted identifiers as backticks', () => {
    expect(translate('SELECT "order date" FROM "my table"', 'bigquery').sql).toBe(
      'SELECT `order date` FROM `my table`',
    );
  });

  it('leaves string literals alone', () => {
    expect(translate("SELECT '(all segments)' AS s", 'bigquery').sql).toBe(
      "SELECT '(all segments)' AS s",
    );
  });

  it('does not confuse a quoted identifier inside a literal', () => {
    expect(translate('SELECT \'a "b" c\'', 'hive').sql).toBe('SELECT \'a "b" c\'');
  });
});

describe('unsupported constructs are reported, not silently emitted', () => {
  it('flags QUALIFY for Hive', () => {
    const out = translate('SELECT * FROM t QUALIFY rn <= 3', 'hive');
    expect(out.notes.some((n) => n.includes('QUALIFY'))).toBe(true);
  });

  it('flags FILTER (WHERE ...) for both warehouses', () => {
    for (const d of ['bigquery', 'hive'] as const) {
      const out = translate('SELECT SUM(x) FILTER (WHERE c) FROM t', d);
      expect(out.notes.some((n) => n.includes('FILTER'))).toBe(true);
    }
  });

  it('flags the GROUPING__ID difference for Hive', () => {
    const out = translate('SELECT GROUPING(region) FROM t GROUP BY ROLLUP(region)', 'hive');
    expect(out.notes.some((n) => n.includes('GROUPING__ID'))).toBe(true);
  });

  it('reminds a BigQuery reader about partition billing once a table is read', () => {
    const out = translate('SELECT region FROM orders', 'bigquery');
    expect(out.notes.some((n) => n.includes('partition'))).toBe(true);
  });

  // Caveats that fire on every query train the reader to skip them, so each one
  // has to be earned by the construct it describes.
  it('stays silent when the query cannot trigger the caveat', () => {
    expect(translate('SELECT 1', 'bigquery').notes).toEqual([]);
    expect(translate('SELECT * FROM orders LIMIT 20', 'hive').notes).toEqual([]);
  });
});

describe('a whole query ports in one pass', () => {
  it('translates the period-over-period recipe to BigQuery', () => {
    const duck = [
      'WITH monthly AS (SELECT DATE_TRUNC(\'month\', CAST("order date" AS TIMESTAMP)) AS period,',
      '  SUM(revenue) AS total FROM orders GROUP BY 1)',
      'SELECT period, total, LAG(total) OVER (ORDER BY period) AS prior FROM monthly;',
    ].join('\n');
    const out = translate(duck, 'bigquery').sql;
    expect(out).toContain('DATE_TRUNC(CAST(`order date` AS TIMESTAMP), MONTH)');
    expect(out).toContain('LAG(total) OVER (ORDER BY period)');
    expect(out).not.toContain("'month'");
  });
});
