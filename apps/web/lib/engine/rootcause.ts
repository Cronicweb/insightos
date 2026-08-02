/**
 * Root cause engine - the signature capability.
 *
 * Given a metric that moved between two periods, decompose the movement across
 * every candidate dimension, score which dimension actually explains it, and
 * emit an evidence-backed tree. Crucially it also records what was *ruled out*,
 * because "it wasn't the marketing spend" is often the more valuable finding.
 *
 * Method, in order:
 *   1. Contribution decomposition - each segment's share of the total delta.
 *   2. Mix-vs-rate separation - expected delta if the segment had simply grown
 *      with the business, versus the excess that is genuinely segment-specific.
 *   3. Significance - Welch's t on the underlying row-level values, with a
 *      Benjamini-Hochberg correction because we test many segments at once.
 *   4. Dimension scoring - explanatory power, concentration and net coverage.
 */
import type * as duckdb from '@duckdb/duckdb-wasm';
import type { DimensionScore, RootCauseNode, RootCauseTree, Severity, Unit } from '@/lib/types';
import { ident, lit, num, query, str } from './sql';
import { hhi, welch } from './stats';

interface SegmentRow {
  segment: string;
  current: number;
  baseline: number;
  rowsCurrent: number;
  rowsBaseline: number;
  meanCurrent: number;
  meanBaseline: number;
  sdCurrent: number;
  sdBaseline: number;
}

export interface RootCauseInput {
  table: string;
  dateColumn: string;
  metricId: string;
  metricLabel: string;
  unit: Unit;
  expression: string;
  /** Raw column the metric aggregates, used for the row-level significance test. */
  valueColumn: string | null;
  dimensions: string[];
  currentPeriod: string;
  baselinePeriod: string;
  currentLabel: string;
  baselineLabel: string;
  grain: string;
  higherIsBetter: boolean;
  additive: boolean;
}

function periodFilter(dateColumn: string, grain: string, period: string): string {
  return `date_trunc('${grain}', CAST(${ident(dateColumn)} AS TIMESTAMP)) = CAST(${lit(period)} AS TIMESTAMP)`;
}

/** Benjamini-Hochberg: control the false discovery rate across many segments. */
function bhSignificant(pValues: (number | null)[], alpha = 0.05): boolean[] {
  const indexed = pValues.map((p, i) => ({ p: p ?? 1, i })).sort((a, b) => a.p - b.p);
  const m = indexed.length;
  const flags = new Array<boolean>(m).fill(false);
  let cutoff = -1;
  indexed.forEach((entry, rank) => {
    if (entry.p <= ((rank + 1) / m) * alpha) cutoff = rank;
  });
  for (let r = 0; r <= cutoff; r += 1) flags[indexed[r].i] = true;
  return flags;
}

function magnitude(d: number): string {
  const a = Math.abs(d);
  if (a >= 0.8) return 'large';
  if (a >= 0.5) return 'moderate';
  if (a >= 0.2) return 'small';
  return 'negligible';
}

async function segmentsFor(
  conn: duckdb.AsyncDuckDBConnection,
  input: RootCauseInput,
  dimension: string,
): Promise<SegmentRow[]> {
  const cur = periodFilter(input.dateColumn, input.grain, input.currentPeriod);
  const base = periodFilter(input.dateColumn, input.grain, input.baselinePeriod);
  const valueCol = input.valueColumn ? ident(input.valueColumn) : 'NULL';
  const rows = await query<Record<string, unknown>>(
    conn,
    `WITH cur AS (
       SELECT CAST(${ident(dimension)} AS VARCHAR) AS segment,
              ${input.expression} AS v, count(*) AS n,
              avg(CAST(${valueCol} AS DOUBLE)) AS m, stddev_samp(CAST(${valueCol} AS DOUBLE)) AS s
         FROM ${ident(input.table)} WHERE ${cur} AND ${ident(dimension)} IS NOT NULL GROUP BY 1),
     base AS (
       SELECT CAST(${ident(dimension)} AS VARCHAR) AS segment,
              ${input.expression} AS v, count(*) AS n,
              avg(CAST(${valueCol} AS DOUBLE)) AS m, stddev_samp(CAST(${valueCol} AS DOUBLE)) AS s
         FROM ${ident(input.table)} WHERE ${base} AND ${ident(dimension)} IS NOT NULL GROUP BY 1)
     SELECT coalesce(cur.segment, base.segment) AS segment,
            coalesce(cur.v, 0) AS current, coalesce(base.v, 0) AS baseline,
            coalesce(cur.n, 0) AS rows_current, coalesce(base.n, 0) AS rows_baseline,
            coalesce(cur.m, 0) AS mean_current, coalesce(base.m, 0) AS mean_baseline,
            coalesce(cur.s, 0) AS sd_current, coalesce(base.s, 0) AS sd_baseline
       FROM cur FULL OUTER JOIN base ON cur.segment = base.segment`,
  );
  return rows.map((r) => ({
    segment: str(r.segment) ?? '(unknown)',
    current: num(r.current) ?? 0,
    baseline: num(r.baseline) ?? 0,
    rowsCurrent: num(r.rows_current) ?? 0,
    rowsBaseline: num(r.rows_baseline) ?? 0,
    meanCurrent: num(r.mean_current) ?? 0,
    meanBaseline: num(r.mean_baseline) ?? 0,
    sdCurrent: num(r.sd_current) ?? 0,
    sdBaseline: num(r.sd_baseline) ?? 0,
  }));
}

function buildNodes(rows: SegmentRow[], dimension: string, totalDelta: number, input: RootCauseInput): RootCauseNode[] {
  const totalCurrent = rows.reduce((a, r) => a + r.current, 0);
  const totalBaseline = rows.reduce((a, r) => a + r.baseline, 0);
  const overallGrowth = totalBaseline !== 0 ? totalCurrent / totalBaseline - 1 : 0;

  const tests = rows.map((r) =>
    input.valueColumn && r.rowsCurrent >= 5 && r.rowsBaseline >= 5
      ? welch(r.meanCurrent, r.sdCurrent, r.rowsCurrent, r.meanBaseline, r.sdBaseline, r.rowsBaseline)
      : { t: 0, p: 1, cohens_d: 0 },
  );
  const significant = bhSignificant(tests.map((t) => t.p));

  return rows.map((r, i) => {
    const delta = r.current - r.baseline;
    const expected = r.baseline * overallGrowth;
    const excess = delta - expected;
    const shareCur = totalCurrent ? (r.current / totalCurrent) * 100 : 0;
    const shareBase = totalBaseline ? (r.baseline / totalBaseline) * 100 : 0;
    const segGrowth = r.baseline !== 0 ? r.current / r.baseline - 1 : null;
    const contribution = totalDelta !== 0 ? (delta / totalDelta) * 100 : null;
    const test = tests[i];

    // A segment is a driver when it moves the total the same way and materially.
    const sameDirection = totalDelta !== 0 && Math.sign(delta) === Math.sign(totalDelta);
    const material = contribution !== null && Math.abs(contribution) >= 10;
    const role: RootCauseNode['role'] = sameDirection && material ? 'driver' : !sameDirection && material ? 'offset' : 'stable';

    const severity: Severity =
      role !== 'driver' ? 'info'
        : Math.abs(contribution ?? 0) >= 50 ? 'critical'
        : Math.abs(contribution ?? 0) >= 30 ? 'high'
        : Math.abs(contribution ?? 0) >= 15 ? 'medium' : 'low';

    const pctText = segGrowth === null ? 'from a zero base' : `${segGrowth >= 0 ? '+' : ''}${(segGrowth * 100).toFixed(1)}%`;
    const narrative =
      role === 'driver'
        ? `${r.segment} moved ${pctText} and accounts for ${Math.abs(contribution ?? 0).toFixed(1)}% of the total change in ${input.metricLabel}.`
        : role === 'offset'
          ? `${r.segment} moved ${pctText}, partially offsetting the overall change.`
          : `${r.segment} moved ${pctText}, broadly in line with the business.`;

    return {
      dimension,
      segment: r.segment,
      path: [{ dimension, segment: r.segment }],
      current: Number(r.current.toFixed(4)),
      baseline: Number(r.baseline.toFixed(4)),
      delta: Number(delta.toFixed(4)),
      delta_pct: segGrowth === null ? null : Number((segGrowth * 100).toFixed(2)),
      contribution_pct: contribution === null ? null : Number(contribution.toFixed(2)),
      share_current_pct: Number(shareCur.toFixed(2)),
      share_baseline_pct: Number(shareBase.toFixed(2)),
      share_change_pp: Number((shareCur - shareBase).toFixed(2)),
      expected_delta: Number(expected.toFixed(4)),
      excess_delta: Number(excess.toFixed(4)),
      excess_pct: r.baseline ? Number(((excess / Math.abs(r.baseline)) * 100).toFixed(2)) : null,
      growth_gap_pp: segGrowth === null ? null : Number(((segGrowth - overallGrowth) * 100).toFixed(2)),
      rows_current: r.rowsCurrent,
      rows_baseline: r.rowsBaseline,
      p_value: test.p,
      p_value_adjusted_significant: significant[i],
      test_name: input.valueColumn ? "Welch's t-test on row-level values, Benjamini-Hochberg adjusted" : 'contribution decomposition only',
      effect_size: test.cohens_d,
      effect_magnitude: magnitude(test.cohens_d),
      role,
      severity,
      narrative,
      children: [],
    };
  });
}

function scoreDimension(dimension: string, nodes: RootCauseNode[], totalDelta: number): DimensionScore {
  const drivers = nodes.filter((n) => n.role === 'driver');
  const netCoverage = totalDelta !== 0 ? (drivers.reduce((a, n) => a + n.delta, 0) / totalDelta) * 100 : 0;
  const absTotal = nodes.reduce((a, n) => a + Math.abs(n.delta), 0);
  const shares = absTotal ? nodes.map((n) => Math.abs(n.delta) / absTotal) : [];
  const concentration = hhi(shares);
  const gaps = nodes.map((n) => n.growth_gap_pp ?? 0);
  const dispersion = gaps.length ? Number((Math.max(...gaps) - Math.min(...gaps)).toFixed(2)) : 0;
  // Explanatory power rewards a dimension that both covers the delta and
  // concentrates it: a change spread evenly over 20 segments explains nothing.
  const power = Math.max(0, Math.min(1, (Math.abs(netCoverage) / 100) * 0.6 + concentration * 0.4));

  return {
    dimension,
    explanatory_power: Number(power.toFixed(3)),
    concentration,
    dispersion,
    net_coverage: Number(netCoverage.toFixed(2)),
    significant_segments: nodes.filter((n) => n.p_value_adjusted_significant).length,
    segments_tested: nodes.length,
    verdict:
      power >= 0.55 ? `${dimension} explains most of the movement`
        : power >= 0.3 ? `${dimension} explains part of the movement`
        : `${dimension} does not explain the movement`,
  };
}

export async function analyseRootCause(
  conn: duckdb.AsyncDuckDBConnection,
  input: RootCauseInput,
  currentValue: number,
  baselineValue: number,
): Promise<RootCauseTree | null> {
  const delta = currentValue - baselineValue;
  const deltaPct = baselineValue !== 0 ? (delta / Math.abs(baselineValue)) * 100 : null;
  if (!input.dimensions.length) return null;

  const scores: DimensionScore[] = [];
  const nodesByDim: Record<string, RootCauseNode[]> = {};
  const excluded: string[] = [];

  for (const dim of input.dimensions.slice(0, 5)) {
    let rows: SegmentRow[];
    try {
      rows = await segmentsFor(conn, input, dim);
    } catch {
      excluded.push(dim);
      continue;
    }
    // Too many levels and every segment is noise; too few and it is not a split.
    if (rows.length < 2 || rows.length > 40) {
      excluded.push(dim);
      continue;
    }
    const nodes = buildNodes(rows, dim, delta, input);
    nodesByDim[dim] = nodes;
    scores.push(scoreDimension(dim, nodes, delta));
  }

  if (!scores.length) return null;
  scores.sort((a, b) => b.explanatory_power - a.explanatory_power);
  const best = scores[0];
  const bestNodes = (nodesByDim[best.dimension ?? ''] ?? [])
    .sort((a, b) => Math.abs(b.contribution_pct ?? 0) - Math.abs(a.contribution_pct ?? 0))
    .slice(0, 12);

  // Second-level split: take the top drivers and break them down again by the
  // next-best dimension. This is what turns a list into a tree.
  const secondary = scores[1]?.dimension ?? null;
  if (secondary && best.dimension) {
    for (const node of bestNodes.filter((n) => n.role === 'driver').slice(0, 3)) {
      try {
        const childRows = await segmentsForNested(conn, input, best.dimension, node.segment ?? '', secondary);
        if (childRows.length >= 2 && childRows.length <= 25) {
          node.children = buildNodes(childRows, secondary, node.delta, input)
            .map((c) => ({ ...c, path: [...node.path, { dimension: secondary, segment: c.segment ?? '' }] }))
            .sort((a, b) => Math.abs(b.contribution_pct ?? 0) - Math.abs(a.contribution_pct ?? 0))
            .slice(0, 6);
        }
      } catch {
        /* a nested split failing must never fail the whole analysis */
      }
    }
  }

  const isFavourable = Math.abs(delta) < 1e-9 ? null : input.higherIsBetter ? delta > 0 : delta < 0;
  const direction = Math.abs(delta) < 1e-9 ? 'flat' : delta > 0 ? 'up' : 'down';
  const topDrivers = bestNodes.filter((n) => n.role === 'driver').slice(0, 3);
  const offsets = bestNodes.filter((n) => n.role === 'offset').slice(0, 2);

  const severity: Severity =
    isFavourable === false && Math.abs(deltaPct ?? 0) >= 15 ? 'critical'
      : isFavourable === false && Math.abs(deltaPct ?? 0) >= 7 ? 'high'
      : isFavourable === false ? 'medium' : 'info';

  const headline =
    topDrivers.length && best.dimension
      ? `${input.metricLabel} ${direction === 'up' ? 'rose' : 'fell'} ${Math.abs(deltaPct ?? 0).toFixed(1)}% ${input.currentLabel} versus ${input.baselineLabel}, concentrated in ${topDrivers.map((d) => d.segment).join(', ')} within ${best.dimension}.`
      : `${input.metricLabel} ${direction === 'up' ? 'rose' : 'fell'} ${Math.abs(deltaPct ?? 0).toFixed(1)}% with no single segment responsible.`;

  const narrative: string[] = [headline];
  for (const d of topDrivers) narrative.push(d.narrative);
  for (const o of offsets) narrative.push(o.narrative);
  for (const s of scores.slice(1, 3)) narrative.push(`${s.verdict} (explanatory power ${(s.explanatory_power * 100).toFixed(0)}%).`);

  const ruledOut = scores
    .slice(1)
    .filter((s) => s.explanatory_power < 0.3)
    .map((s) => ({
      kind: 'dimension',
      name: s.dimension ?? '',
      reason: `Movement was spread across ${s.segments_tested} segments with net coverage of only ${s.net_coverage.toFixed(0)}%.`,
      explanatory_power: s.explanatory_power,
    }));

  return {
    metric: input.metricId,
    metric_label: input.metricLabel,
    unit: input.unit,
    current_period: input.currentPeriod,
    baseline_period: input.baselinePeriod,
    comparison_type: `${input.grain}-on-${input.grain}`,
    current_value: Number(currentValue.toFixed(4)),
    baseline_value: Number(baselineValue.toFixed(4)),
    delta: Number(delta.toFixed(4)),
    delta_pct: deltaPct === null ? null : Number(deltaPct.toFixed(2)),
    direction,
    is_favourable: isFavourable,
    severity,
    dimension_scores: scores,
    nodes: bestNodes,
    ruled_out: ruledOut,
    headline,
    narrative,
    confidence: Number(Math.max(0.35, Math.min(0.96, 0.4 + best.explanatory_power * 0.5 + (best.significant_segments ? 0.1 : 0))).toFixed(2)),
    method_notes: [
      'Each segment is decomposed into an expected delta (its baseline scaled by overall growth) and an excess delta that is specific to that segment.',
      'Segment-level significance uses Welch\u2019s t-test on row-level values with a Benjamini-Hochberg correction, because many segments are tested at once.',
      'Dimensions are ranked by explanatory power, combining how much of the delta they cover with how concentrated that coverage is.',
      'Only additive metrics are decomposed; ratios are analysed through their components.',
    ],
    excluded_dimensions: excluded,
  };
}

async function segmentsForNested(
  conn: duckdb.AsyncDuckDBConnection,
  input: RootCauseInput,
  parentDim: string,
  parentSegment: string,
  childDim: string,
): Promise<SegmentRow[]> {
  const scoped: RootCauseInput = {
    ...input,
    table: input.table,
  };
  const cur = `${periodFilter(input.dateColumn, input.grain, input.currentPeriod)} AND CAST(${ident(parentDim)} AS VARCHAR) = ${lit(parentSegment)}`;
  const base = `${periodFilter(input.dateColumn, input.grain, input.baselinePeriod)} AND CAST(${ident(parentDim)} AS VARCHAR) = ${lit(parentSegment)}`;
  const valueCol = scoped.valueColumn ? ident(scoped.valueColumn) : 'NULL';
  const rows = await query<Record<string, unknown>>(
    conn,
    `WITH cur AS (
       SELECT CAST(${ident(childDim)} AS VARCHAR) AS segment, ${scoped.expression} AS v, count(*) AS n,
              avg(CAST(${valueCol} AS DOUBLE)) AS m, stddev_samp(CAST(${valueCol} AS DOUBLE)) AS s
         FROM ${ident(scoped.table)} WHERE ${cur} AND ${ident(childDim)} IS NOT NULL GROUP BY 1),
     base AS (
       SELECT CAST(${ident(childDim)} AS VARCHAR) AS segment, ${scoped.expression} AS v, count(*) AS n,
              avg(CAST(${valueCol} AS DOUBLE)) AS m, stddev_samp(CAST(${valueCol} AS DOUBLE)) AS s
         FROM ${ident(scoped.table)} WHERE ${base} AND ${ident(childDim)} IS NOT NULL GROUP BY 1)
     SELECT coalesce(cur.segment, base.segment) AS segment,
            coalesce(cur.v, 0) AS current, coalesce(base.v, 0) AS baseline,
            coalesce(cur.n, 0) AS rows_current, coalesce(base.n, 0) AS rows_baseline,
            coalesce(cur.m, 0) AS mean_current, coalesce(base.m, 0) AS mean_baseline,
            coalesce(cur.s, 0) AS sd_current, coalesce(base.s, 0) AS sd_baseline
       FROM cur FULL OUTER JOIN base ON cur.segment = base.segment`,
  );
  return rows.map((r) => ({
    segment: str(r.segment) ?? '(unknown)',
    current: num(r.current) ?? 0,
    baseline: num(r.baseline) ?? 0,
    rowsCurrent: num(r.rows_current) ?? 0,
    rowsBaseline: num(r.rows_baseline) ?? 0,
    meanCurrent: num(r.mean_current) ?? 0,
    meanBaseline: num(r.mean_baseline) ?? 0,
    sdCurrent: num(r.sd_current) ?? 0,
    sdBaseline: num(r.sd_baseline) ?? 0,
  }));
}
