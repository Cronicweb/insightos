/**
 * Data quality scoring.
 *
 * Six weighted dimensions produce a 0-100 score and a letter grade. The score
 * is not decoration: `usable_for_analysis` gates the governance layer, which in
 * turn downgrades recommendations built on weak data.
 */
import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import type { QualityIssue, QualityReport } from '@/lib/types';
import type { ProfileResult } from './profile';
import { ident, numOr, query, queryOne, round, str } from './sql';

const WEIGHTS = {
  completeness: 0.28,
  uniqueness: 0.18,
  validity: 0.18,
  consistency: 0.14,
  timeliness: 0.12,
  distribution: 0.1,
};

function grade(score: number): string {
  if (score >= 95) return 'A';
  if (score >= 88) return 'B';
  if (score >= 78) return 'C';
  if (score >= 65) return 'D';
  return 'E';
}

export async function assessQuality(
  conn: AsyncDuckDBConnection,
  table: string,
  profile: ProfileResult,
): Promise<QualityReport> {
  const t = ident(table);
  const { schema } = profile;
  const rows = schema.rows;
  const issues: QualityIssue[] = [];

  const missingByColumn = schema.columns
    .filter((c) => c.missing > 0)
    .map((c) => ({
      column: c.name,
      missing: c.missing,
      missing_pct: c.missing_pct,
      dtype: c.dtype,
      semantic_type: c.semantic_type,
    }))
    .sort((a, b) => b.missing_pct - a.missing_pct);

  for (const m of missingByColumn.filter((x) => x.missing_pct >= 5)) {
    issues.push({
      id: `missing:${m.column}`,
      dimension: 'completeness',
      column: m.column,
      severity: m.missing_pct >= 40 ? 'critical' : m.missing_pct >= 15 ? 'high' : 'medium',
      title: `${m.column} is ${m.missing_pct}% empty`,
      detail: `${m.missing.toLocaleString()} of ${rows.toLocaleString()} rows have no value for ${m.column}.`,
      remediation: 'Confirm whether the gap is a collection failure or a legitimate "not applicable".',
      affected_rows: m.missing,
      affected_pct: m.missing_pct,
    });
  }

  // Duplicates: whole-row, plus key-level when a primary key was inferred.
  const allCols = schema.columns.map((c) => ident(c.name)).join(', ');
  const dupRow = await queryOne(
    conn,
    `SELECT coalesce(sum(n) - count(*), 0) AS dup
       FROM (SELECT ${allCols}, count(*) AS n FROM ${t} GROUP BY ALL) g`,
  );
  const exactDuplicates = numOr(dupRow.dup);

  const keyColumns = schema.primary_key;
  let keyDuplicates = 0;
  let exampleKeys: unknown[] = [];
  if (keyColumns.length) {
    const k = keyColumns.map((c) => ident(c)).join(', ');
    const dk = await query(
      conn,
      `SELECT ${k}, count(*) AS n FROM ${t} GROUP BY ALL HAVING count(*) > 1 ORDER BY n DESC LIMIT 5`,
    );
    const dkTotal = await queryOne(
      conn,
      `SELECT coalesce(sum(n) - count(*), 0) AS dup FROM (SELECT ${k}, count(*) AS n FROM ${t} GROUP BY ALL) g`,
    );
    keyDuplicates = numOr(dkTotal.dup);
    exampleKeys = dk.map((r) => keyColumns.map((c) => str(r[c])).join(' / '));
  }
  if (exactDuplicates > 0) {
    issues.push({
      id: 'duplicates:exact',
      dimension: 'uniqueness',
      column: null,
      severity: exactDuplicates / Math.max(rows, 1) > 0.02 ? 'high' : 'medium',
      title: `${exactDuplicates.toLocaleString()} duplicate rows`,
      detail: 'Identical rows inflate every additive metric computed from this table.',
      remediation: 'De-duplicate on the natural key before trusting totals.',
      affected_rows: exactDuplicates,
      affected_pct: round((exactDuplicates / Math.max(rows, 1)) * 100, 2) ?? 0,
    });
  }

  // Outliers via Tukey fences, computed in SQL.
  const outliers: QualityReport['outliers'] = [];
  for (const col of schema.columns.filter((c) =>
    ['currency', 'count', 'numeric', 'percentage'].includes(c.semantic_type),
  )) {
    const c = ident(col.name);
    const q = await queryOne(
      conn,
      `SELECT quantile_cont(${c}, 0.25) AS q1, quantile_cont(${c}, 0.75) AS q3,
              sum(${c}) AS total
         FROM ${t} WHERE ${c} IS NOT NULL`,
    );
    const q1 = numOr(q.q1);
    const q3 = numOr(q.q3);
    const iqr = q3 - q1;
    if (!Number.isFinite(iqr) || iqr <= 0) continue;
    const lower = q1 - 1.5 * iqr;
    const upper = q3 + 1.5 * iqr;
    const o = await queryOne(
      conn,
      `SELECT count(*) AS n, min(${c}) AS lo, max(${c}) AS hi, coalesce(sum(${c}), 0) AS s
         FROM ${t} WHERE ${c} IS NOT NULL AND (${c} < ${lower} OR ${c} > ${upper})`,
    );
    const count = numOr(o.n);
    if (!count) continue;
    const total = numOr(q.total);
    outliers.push({
      column: col.name,
      count,
      pct: round((count / Math.max(col.count, 1)) * 100, 2) ?? 0,
      lower_fence: round(lower, 4),
      upper_fence: round(upper, 4),
      min_outlier: round(numOr(o.lo), 4) ?? 0,
      max_outlier: round(numOr(o.hi), 4) ?? 0,
      share_of_column_total_pct: total ? round((numOr(o.s) / total) * 100, 2) ?? 0 : 0,
      method: 'Tukey fence (1.5 x IQR)',
    });
  }
  outliers.sort((a, b) => b.share_of_column_total_pct - a.share_of_column_total_pct);
  for (const o of outliers.filter((x) => x.share_of_column_total_pct >= 15)) {
    issues.push({
      id: `outliers:${o.column}`,
      dimension: 'distribution',
      column: o.column,
      severity: o.share_of_column_total_pct >= 35 ? 'high' : 'medium',
      title: `${o.column} is concentrated in ${o.pct}% of rows`,
      detail: `Extreme values carry ${o.share_of_column_total_pct}% of the column total, so averages will mislead.`,
      remediation: 'Report medians alongside means, or segment the long tail out.',
      affected_rows: o.count,
      affected_pct: o.pct,
    });
  }

  // Invalid values: negative money, out-of-range percentages, future dates.
  const invalid: QualityReport['invalid_values'] = [];
  for (const col of schema.columns) {
    const c = ident(col.name);
    let rule: string | null = null;
    let predicate: string | null = null;
    if (col.semantic_type === 'currency') {
      rule = 'negative monetary value';
      predicate = `${c} < 0`;
    } else if (col.semantic_type === 'percentage') {
      rule = 'percentage outside 0-100';
      predicate = `(${c} < 0 OR ${c} > 100)`;
    } else if (col.semantic_type === 'datetime') {
      rule = 'timestamp in the future';
      predicate = `${c} > now()`;
    }
    if (!rule || !predicate) continue;
    const r = await queryOne(conn, `SELECT count(*) AS n FROM ${t} WHERE ${predicate}`);
    const n = numOr(r.n);
    if (!n) continue;
    const ex = await query(conn, `SELECT CAST(${c} AS VARCHAR) AS v FROM ${t} WHERE ${predicate} LIMIT 3`);
    invalid.push({
      column: col.name,
      rule,
      count: n,
      pct: round((n / Math.max(rows, 1)) * 100, 2) ?? 0,
      examples: ex.map((x) => str(x.v)),
    });
    issues.push({
      id: `invalid:${col.name}`,
      dimension: 'validity',
      column: col.name,
      severity: n / Math.max(rows, 1) > 0.05 ? 'high' : 'low',
      title: `${n.toLocaleString()} rows fail "${rule}" on ${col.name}`,
      detail: `Values that break the expected domain of ${col.name} will distort any aggregate built on it.`,
      remediation: 'Fix upstream, or exclude the offending rows explicitly.',
      affected_rows: n,
      affected_pct: round((n / Math.max(rows, 1)) * 100, 2) ?? 0,
      examples: ex.map((x) => str(x.v)),
    });
  }

  const cardinality = schema.columns
    .map((c) => {
      const shares = c.top_values.map((v) => v.count / Math.max(c.count, 1));
      const hhi = shares.length ? shares.reduce((a, s) => a + s * s, 0) : null;
      return {
        column: c.name,
        unique: c.unique,
        unique_pct: c.unique_pct,
        semantic_type: c.semantic_type,
        hhi: round(hhi, 3),
      };
    })
    .sort((a, b) => b.unique - a.unique);

  for (const c of schema.columns.filter((x) => x.is_constant)) {
    issues.push({
      id: `constant:${c.name}`,
      dimension: 'consistency',
      column: c.name,
      severity: 'low',
      title: `${c.name} never varies`,
      detail: 'A constant column carries no information and cannot explain anything.',
      remediation: 'Drop it, or confirm the extract was filtered too narrowly.',
    });
  }

  // Timeliness: how stale is the newest record?
  const timeCol = schema.time_columns[0];
  let timeliness = 100;
  let freshnessDetail = 'No date column detected, so freshness cannot be assessed.';
  let latest: string | null = null;
  if (timeCol) {
    const f = await queryOne(
      conn,
      `SELECT max(${ident(timeCol)}) AS mx,
              date_diff('day', CAST(max(${ident(timeCol)}) AS TIMESTAMP), CAST(now() AS TIMESTAMP)) AS age
         FROM ${t}`,
    );
    const age = numOr(f.age);
    latest = str(f.mx).slice(0, 10);
    timeliness = age <= 7 ? 100 : age <= 30 ? 92 : age <= 90 ? 80 : age <= 365 ? 62 : 40;
    freshnessDetail = `Most recent ${timeCol} is ${latest} (${Math.max(age, 0).toLocaleString()} days old).`;
  }

  const completeness =
    100 - (schema.columns.reduce((a, c) => a + c.missing_pct, 0) / Math.max(schema.columns.length, 1));
  const uniqueness = 100 - Math.min((exactDuplicates / Math.max(rows, 1)) * 100 * 4, 100);
  const invalidRows = invalid.reduce((a, i) => a + i.pct, 0);
  const validity = Math.max(0, 100 - invalidRows * 3);
  const constants = schema.columns.filter((c) => c.is_constant).length;
  const consistency = Math.max(0, 100 - (constants / Math.max(schema.columns.length, 1)) * 100);
  const outlierPressure = outliers.reduce((a, o) => a + o.share_of_column_total_pct, 0) /
    Math.max(outliers.length || 1, 1);
  const distribution = Math.max(0, 100 - outlierPressure * 0.8);

  const dimensions = [
    { name: 'Completeness', score: round(completeness, 1)!, weight: WEIGHTS.completeness, detail: `${missingByColumn.length} of ${schema.columns.length} columns have gaps.` },
    { name: 'Uniqueness', score: round(uniqueness, 1)!, weight: WEIGHTS.uniqueness, detail: `${exactDuplicates.toLocaleString()} duplicate rows detected.` },
    { name: 'Validity', score: round(validity, 1)!, weight: WEIGHTS.validity, detail: `${invalid.length} domain rules violated.` },
    { name: 'Consistency', score: round(consistency, 1)!, weight: WEIGHTS.consistency, detail: `${constants} constant columns.` },
    { name: 'Timeliness', score: round(timeliness, 1)!, weight: WEIGHTS.timeliness, detail: freshnessDetail },
    { name: 'Distribution', score: round(distribution, 1)!, weight: WEIGHTS.distribution, detail: `${outliers.length} columns carry heavy tails.` },
  ];

  const score = dimensions.reduce((a, d) => a + d.score * d.weight, 0);
  const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  issues.sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9));

  return {
    score: round(score, 1)!,
    grade: grade(score),
    rows,
    columns: schema.columns.length,
    usable_for_analysis: score >= 60 && rows >= 30,
    dimensions,
    issues,
    missing_by_column: missingByColumn,
    duplicates: {
      exact_duplicate_rows: exactDuplicates,
      exact_duplicate_pct: round((exactDuplicates / Math.max(rows, 1)) * 100, 2) ?? 0,
      key_columns: keyColumns,
      key_duplicate_rows: keyDuplicates,
      example_keys: exampleKeys,
    },
    outliers,
    cardinality,
    invalid_values: invalid,
  };
}
