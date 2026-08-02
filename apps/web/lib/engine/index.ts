/**
 * The browser analytics pipeline.
 *
 * This runs the same stage sequence as the Python engine and emits the same
 * `Analysis` contract, so every existing panel renders an uploaded dataset
 * without a single fork in the UI. Stages that fail are recorded as warnings
 * rather than taking the whole run down - a partial analysis is still useful.
 */
import type {
  Analysis, ChartNarrative, ChartSpec, Forecast, RootCauseTree,
} from '@/lib/types';
import { getDuckDb } from '@/lib/duckdb/client';
import { ident, lit, query, num, str } from './sql';
import { profileTable } from './profile';
import { assessQuality } from './quality';
import { detectSensitiveFields, type PrivacyReport } from './privacy';
import { detectDomain, domainLabel } from './domain';
import { resolveRoles, dimensionColumns } from './roles';
import { pluginFor } from './plugins';
import { buildScorecard } from './kpi';
import { detectTemporalAnomalies, detectSegmentAnomalies, buildAnomalyReport } from './anomaly';
import { analyseRootCause } from './rootcause';
import { forecastKpi } from './forecast';
import { buildRecommendations } from './recommend';
import { buildExecutiveReport } from './report';
import { compositionCharts, forecastChart, heroChart, qualityChart, rootCauseChart, type SegmentSlice } from './charts';
import { runSql } from './ingest';
import type { IngestResult } from './ingest';

export interface BrowserAnalysis extends Analysis {
  privacy: PrivacyReport;
  source: 'browser';
}

async function segmentSlices(
  conn: Awaited<ReturnType<typeof getDuckDb>>['conn'],
  table: string,
  dimension: string,
  expression: string,
  dateColumn: string,
  grainExpr: string | null,
  currentPeriod: string | null,
  baselinePeriod: string | null,
  nested: string | null,
): Promise<SegmentSlice[]> {
  const rows = await query<{ name: unknown; value: unknown }>(
    conn,
    `SELECT CAST(${ident(dimension)} AS VARCHAR) AS name, ${expression} AS value
       FROM ${ident(table)} WHERE ${ident(dimension)} IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 12`,
  );
  const parsed = rows.map((r) => ({ name: str(r.name) || '(blank)', value: num(r.value) ?? 0 }));
  const total = parsed.reduce((a, s) => a + s.value, 0) || 1;

  let deltas: Record<string, number | null> = {};
  if (grainExpr && currentPeriod && baselinePeriod) {
    const move = await query<{ name: unknown; cur: unknown; base: unknown }>(
      conn,
      `SELECT CAST(${ident(dimension)} AS VARCHAR) AS name,
              ${expression} FILTER (WHERE CAST(${grainExpr} AS VARCHAR) = ${lit(currentPeriod)}) AS cur,
              ${expression} FILTER (WHERE CAST(${grainExpr} AS VARCHAR) = ${lit(baselinePeriod)}) AS base
         FROM ${ident(table)} WHERE ${ident(dimension)} IS NOT NULL AND ${ident(dateColumn)} IS NOT NULL
        GROUP BY 1`,
    );
    for (const r of move) {
      const cur = num(r.cur);
      const base = num(r.base);
      deltas[str(r.name)] = base !== null && base !== 0 && cur !== null ? ((cur - base) / Math.abs(base)) * 100 : null;
    }
  }

  let children: Record<string, { name: string; value: number; shareOfGroup: number }[]> = {};
  if (nested) {
    const sub = await query<{ parent: unknown; child: unknown; value: unknown }>(
      conn,
      `SELECT CAST(${ident(dimension)} AS VARCHAR) AS parent, CAST(${ident(nested)} AS VARCHAR) AS child, ${expression} AS value
         FROM ${ident(table)} WHERE ${ident(dimension)} IS NOT NULL AND ${ident(nested)} IS NOT NULL
        GROUP BY 1, 2`,
    );
    for (const r of sub) {
      const parent = str(r.parent);
      (children[parent] ||= []).push({ name: str(r.child), value: num(r.value) ?? 0, shareOfGroup: 0 });
    }
    for (const key of Object.keys(children)) {
      const groupTotal = children[key].reduce((a, c) => a + c.value, 0) || 1;
      children[key] = children[key]
        .map((c) => ({ ...c, shareOfGroup: (c.value / groupTotal) * 100 }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6);
    }
  }

  return parsed.map((s) => ({
    name: s.name,
    value: s.value,
    share: (s.value / total) * 100,
    deltaPct: deltas[s.name] ?? null,
    children: children[s.name],
  }));
}

const STAGE_LABELS: Record<string, string> = {
  quality: 'Scoring data quality',
  scorecard: 'Discovering KPIs',
  composition: 'Breaking down the drivers',
  root_cause: 'Running root cause analysis',
  forecast: 'Forecasting the next periods',
  segment_anomalies: 'Screening segments for anomalies',
  anomalies: 'Detecting anomalies',
  recommendations: 'Writing recommendations',
  report: 'Assembling the executive report',
};

export async function analyseInBrowser(
  ingest: IngestResult,
  onProgress?: (stage: string) => void,
): Promise<BrowserAnalysis> {
  const timings: Record<string, number> = {};
  const warnings: string[] = [];
  const { conn } = await getDuckDb();
  const table = ingest.table;

  const stage = async <T,>(name: string, fn: () => Promise<T> | T, fallback: T): Promise<T> => {
    const t0 = performance.now();
    onProgress?.(STAGE_LABELS[name] ?? name);
    try {
      return await fn();
    } catch (err) {
      warnings.push(`${name}: ${(err as Error).message}`);
      return fallback;
    } finally {
      timings[name] = Math.round(performance.now() - t0);
    }
  };

  const profile = await profileTable(conn, table, ingest.fileName);
  timings.profile = 0;

  const quality = await stage('quality', () => assessQuality(conn, table, profile), {
    score: 0, grade: 'n/a', rows: profile.schema.rows, columns: profile.schema.columns.length,
    dimensions: [], issues: [], usable_for_analysis: false, narrative: 'Quality assessment failed.',
    duplicate_rows: 0, duplicate_pct: 0, missing_cells: 0, missing_pct: 0, method_notes: [],
  } as never);

  const privacy = detectSensitiveFields(profile.schema.columns);
  const domain = detectDomain(profile.schema.columns);
  const plugin = pluginFor(domain.domain);
  const roles = resolveRoles(profile.schema.columns);
  // Masked columns are personal data; they are never used as a breakdown so no
  // chart, root-cause branch or recommendation can re-identify an individual.
  const dims = dimensionColumns(profile.schema.columns, roles, privacy.masked_columns);

  const scorecardResult = await stage(
    'scorecard',
    () => buildScorecard(conn, table, profile.schema.columns, domain.domain),
    null as never,
  );

  const charts: ChartSpec[] = [];
  const narratives: ChartNarrative[] = [];
  const rootCauses: RootCauseTree[] = [];
  const forecasts: Forecast[] = [];

  const scorecard = scorecardResult?.scorecard ?? {
    domain: domain.domain, grain: 'month', date_column: roles.date ?? '', period_label: 'n/a',
    comparison_label: 'n/a', kpis: [], roles: [], primary_kpi_id: null,
    seasonality: { detected: false, period: null, strength: 0, peak_label: null, trough_label: null },
  };

  const primary = scorecard.kpis.find((k) => k.id === scorecard.primary_kpi_id) ?? scorecard.kpis[0];
  const periods = scorecardResult?.periods ?? [];
  const currentPeriod = periods[periods.length - 1] ?? null;
  const baselinePeriod = periods.length > 1 ? periods[periods.length - 2] : null;
  const dateColumn = scorecard.date_column;
  const grainExpr = dateColumn ? `date_trunc('${scorecard.grain}', CAST(${ident(dateColumn)} AS TIMESTAMP))` : null;

  for (const kpi of scorecard.kpis.slice(0, 6)) charts.push(heroChart(kpi));

  if (primary && scorecardResult) {
    const expression = scorecardResult.expressions[primary.id];
    const def = scorecardResult.definitions[primary.id];

    await stage('composition', async () => {
      for (const dim of dims.slice(0, 3)) {
        const slices = await segmentSlices(
          conn, table, dim, expression, dateColumn, grainExpr, currentPeriod, baselinePeriod,
          dims.find((d) => d !== dim) ?? null,
        );
        if (slices.length < 2) continue;
        charts.push(...compositionCharts(primary.label, dim, primary.unit, slices, dim === dims[0]));
      }
    }, undefined);

    if (currentPeriod && baselinePeriod) {
      await stage('root_cause', async () => {
        for (const kpi of scorecard.kpis.slice(0, 3)) {
          const tree = await analyseRootCause(
            conn,
            {
              table, dateColumn, metricId: kpi.id, metricLabel: kpi.label, unit: kpi.unit,
              expression: scorecardResult.expressions[kpi.id],
              valueColumn: roles.revenue ?? roles.quantity ?? null,
              dimensions: dims, currentPeriod, baselinePeriod,
              currentLabel: kpi.period_label, baselineLabel: kpi.comparison_label,
              grain: scorecard.grain, higherIsBetter: kpi.higher_is_better, additive: kpi.additive,
            },
            kpi.value,
            kpi.previous_value ?? kpi.value,
          );
          if (tree) rootCauses.push(tree);
        }
      }, undefined);
    }

    for (const tree of rootCauses.slice(0, 2)) charts.push(rootCauseChart(tree));

    await stage('forecast', () => {
      for (const kpi of scorecard.kpis.slice(0, 3)) {
        const f = forecastKpi(kpi);
        if (f) {
          forecasts.push(f);
          charts.push(forecastChart(f, kpi));
        }
      }
    }, undefined);
  }

  const temporal = detectTemporalAnomalies(scorecard.kpis);
  const segmentAnomalies = primary && scorecardResult && currentPeriod && grainExpr
    ? await stage('segment_anomalies', () => detectSegmentAnomalies(
        conn, table, dims, primary.id, primary.label,
        scorecardResult.expressions[primary.id],
        `CAST(${grainExpr} AS VARCHAR) = ${lit(currentPeriod)}`,
      ), [])
    : [];
  const anomalies = buildAnomalyReport(temporal, segmentAnomalies, scorecard.kpis);

  if (quality.dimensions.length) charts.push(qualityChart(quality));
  for (const c of charts) narratives.push(c.narrative);

  const recommendations = buildRecommendations({ scorecard, rootCauses, anomalies, quality, plugin });
  const report = buildExecutiveReport({
    dataset: ingest.fileName, domain, scorecard, rootCauses, anomalies, quality, recommendations,
  });

  return {
    key: `upload:${ingest.table}`,
    dataset: ingest.fileName,
    story: `${ingest.rows.toLocaleString('en-GB')} rows analysed entirely in your browser. Detected domain: ${domainLabel(domain.domain)}.`,
    rows: ingest.rows,
    columns: ingest.columns,
    schema: profile.schema,
    quality,
    domain,
    scorecard,
    anomalies,
    root_causes: rootCauses,
    forecasts,
    narratives,
    charts,
    recommendations,
    report,
    timings_ms: { ingest: ingest.durationMs, ...timings },
    warnings,
    privacy,
    source: 'browser',
  };
}

export interface SqlResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
}

const SQL_ROW_LIMIT = 500;

/**
 * Ad-hoc SQL against the uploaded table. The same DuckDB instance that produced
 * the analysis answers the query, so the console is not a separate toy engine -
 * it is the engine.
 */
export async function executeSql(sql: string): Promise<SqlResult> {
  const started = performance.now();
  const { conn } = await getDuckDb();
  const rows = (await runSql(conn, sql)) as Record<string, unknown>[];
  const truncated = rows.length > SQL_ROW_LIMIT;
  const page = truncated ? rows.slice(0, SQL_ROW_LIMIT) : rows;
  return {
    columns: page.length ? Object.keys(page[0]) : [],
    rows: page,
    rowCount: rows.length,
    truncated,
    durationMs: Math.round(performance.now() - started),
  };
}

/** Column names of the uploaded table, used to seed the console with a hint. */
export async function describeTable(table: string): Promise<string[]> {
  const { conn } = await getDuckDb();
  const rows = (await runSql(conn, `SELECT * FROM ${table} LIMIT 1`)) as Record<string, unknown>[];
  return rows.length ? Object.keys(rows[0]) : [];
}
