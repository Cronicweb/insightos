/**
 * KPI scorecard construction.
 *
 * Picks a reporting grain, evaluates every KPI the resolved roles can support
 * as a period series in a single SQL pass, then derives deltas, trend and
 * seasonality. Ratio KPIs are recomputed from their components per period -
 * never averaged - which is the mistake that quietly corrupts most dashboards.
 */
import type * as duckdb from '@duckdb/duckdb-wasm';
import type { ColumnProfile, Kpi, Scorecard, SeriesPoint } from '@/lib/types';
import { ident, num, query } from './sql';
import { mannKendall, mean } from './stats';
import { pluginFor, type KpiDefinition } from './plugins';
import { resolveRolesDetailed } from './roles';

export type Grain = 'day' | 'week' | 'month' | 'quarter';

const GRAIN_LABEL: Record<Grain, string> = { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter' };

const GRAIN_ORDER: Grain[] = ['day', 'week', 'month', 'quarter'];

/** A trend test on fewer than this many periods is not worth running. */
const MIN_PERIODS = 4;
/** Below this, periods are so sparse that COUNT(DISTINCT ...) degenerates to 1. */
const MIN_ROWS_PER_PERIOD = 3;

/**
 * Choose the finest grain that still yields enough periods *and* enough rows
 * inside each period to reason about.
 *
 * Span alone is not enough. A 42-row extract spread over seven months spans
 * 205 days, which naively suggests a weekly grain - but that yields thirty
 * buckets holding a single row each, so `COUNT(DISTINCT order_id)` reports 1
 * and every delta becomes noise. We therefore measure actual bucket density
 * and coarsen until each period carries a defensible number of observations.
 */
export async function chooseGrain(
  conn: duckdb.AsyncDuckDBConnection,
  table: string,
  dateColumn: string,
): Promise<Grain> {
  const col = `CAST(${ident(dateColumn)} AS TIMESTAMP)`;
  const rows = await query<Record<string, unknown>>(
    conn,
    `SELECT count(*) AS n,
            count(DISTINCT date_trunc('day', ${col})) AS day,
            count(DISTINCT date_trunc('week', ${col})) AS week,
            count(DISTINCT date_trunc('month', ${col})) AS month,
            count(DISTINCT date_trunc('quarter', ${col})) AS quarter
       FROM ${ident(table)} WHERE ${ident(dateColumn)} IS NOT NULL`,
  );
  const stats = rows[0];
  const n = num(stats?.n) ?? 0;
  if (!n) return 'day';

  const periodsFor = (g: Grain) => Math.max(num(stats?.[g]) ?? 0, 0);

  // Ideal: enough periods for a trend, and enough rows per period for counts.
  for (const g of GRAIN_ORDER) {
    const p = periodsFor(g);
    if (p >= MIN_PERIODS && n / p >= MIN_ROWS_PER_PERIOD) return g;
  }
  // Otherwise prefer density over resolution: the coarsest grain that still
  // gives us at least two comparable periods.
  for (const g of [...GRAIN_ORDER].reverse()) {
    if (periodsFor(g) >= 2) {
      const finer = GRAIN_ORDER.filter((f) => periodsFor(f) >= MIN_PERIODS);
      return finer.length ? finer[finer.length - 1] : g;
    }
  }
  return 'day';
}

/**
 * Human-readable formula shown on a KPI card.
 *
 * Derived from the *executed* SQL rather than a hand-written string, so the
 * card can never claim `COUNT(DISTINCT order)` while the engine actually ran
 * `COUNT(DISTINCT "order_id")`. What you read is what was computed.
 */
export function displayFormula(sql: string): string {
  return sql.replace(/"/g, '').replace(/\s+/g, ' ').trim();
}

function bucketExpr(grain: Grain, dateColumn: string): string {
  return `date_trunc('${grain}', CAST(${ident(dateColumn)} AS TIMESTAMP))`;
}

export function periodLabel(iso: string, grain: Grain): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getUTCFullYear();
  const m = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  if (grain === 'day') return `${d.getUTCDate()} ${m}`;
  if (grain === 'week') return `w/c ${d.getUTCDate()} ${m}`;
  if (grain === 'month') return `${m} ${y}`;
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${y}`;
}

/** Substitute `{role}` placeholders with quoted column identifiers. */
export function renderExpression(def: KpiDefinition, roles: Record<string, string>): string | null {
  let sql = def.expression;
  for (const role of def.requires) {
    const col = roles[role];
    if (!col) return null;
    sql = sql.split(`{${role}}`).join(ident(col));
  }
  // Some expressions reference roles beyond `requires` (e.g. flag rates).
  const leftover = sql.match(/\{(\w+)\}/g);
  if (leftover) {
    for (const token of leftover) {
      const role = token.slice(1, -1);
      const col = roles[role];
      if (!col) return null;
      sql = sql.split(token).join(ident(col));
    }
  }
  return sql;
}

export interface ScorecardResult {
  scorecard: Scorecard;
  grain: Grain;
  periods: string[];
  /** Per-KPI expression, kept so root cause can reuse the exact same maths. */
  expressions: Record<string, string>;
  definitions: Record<string, KpiDefinition>;
}

export async function buildScorecard(
  conn: duckdb.AsyncDuckDBConnection,
  table: string,
  columns: ColumnProfile[],
  domain: string,
): Promise<ScorecardResult> {
  const resolved = resolveRolesDetailed(columns);
  const roles: Record<string, string> = {};
  for (const r of resolved) roles[r.role] = r.column;

  const plugin = pluginFor(domain);
  const dateColumn = roles.date ?? '';
  const grain: Grain = dateColumn ? await chooseGrain(conn, table, dateColumn) : 'month';

  const usable: KpiDefinition[] = [];
  const expressions: Record<string, string> = {};
  for (const def of plugin.kpis) {
    const sql = renderExpression(def, roles);
    if (sql) {
      usable.push(def);
      expressions[def.id] = sql;
    }
  }

  // A dataset with no date column still deserves a scorecard - it just has a
  // single period and therefore no trend.
  const selects = usable.map((d) => `${expressions[d.id]} AS ${ident(d.id)}`);
  const rows = dateColumn
    ? await query<Record<string, unknown>>(
        conn,
        `SELECT CAST(${bucketExpr(grain, dateColumn)} AS VARCHAR) AS period, ${selects.join(', ')}
           FROM ${ident(table)} WHERE ${ident(dateColumn)} IS NOT NULL
          GROUP BY 1 ORDER BY 1`,
      )
    : await query<Record<string, unknown>>(conn, `SELECT 'all' AS period, ${selects.join(', ')} FROM ${ident(table)}`);

  const periods = rows.map((r) => String(r.period));
  const kpis: Kpi[] = [];

  for (const def of usable) {
    const series: SeriesPoint[] = rows.map((r) => ({
      period: String(r.period),
      label: periodLabel(String(r.period), grain),
      value: num(r[def.id]) ?? 0,
    }));
    if (!series.length) continue;

    const values = series.map((p) => p.value);
    const value = values[values.length - 1];
    const previous = values.length > 1 ? values[values.length - 2] : null;
    const delta = previous === null ? null : value - previous;
    const deltaPct = previous === null || previous === 0 ? null : ((value - previous) / Math.abs(previous)) * 100;
    const direction = delta === null || Math.abs(delta) < 1e-9 ? 'flat' : delta > 0 ? 'up' : 'down';
    const isFavourable =
      direction === 'flat' ? null : def.higherIsBetter ? direction === 'up' : direction === 'down';

    kpis.push({
      id: def.id,
      label: def.label,
      description: def.description,
      unit: def.unit,
      value: Number(value.toFixed(4)),
      previous_value: previous === null ? null : Number(previous.toFixed(4)),
      delta: delta === null ? null : Number(delta.toFixed(4)),
      delta_pct: deltaPct === null ? null : Number(deltaPct.toFixed(2)),
      direction,
      is_favourable: isFavourable,
      higher_is_better: def.higherIsBetter,
      additive: def.additive,
      formula: displayFormula(expressions[def.id] ?? def.formula),
      series,
      trend: values.length >= 4 ? mannKendall(values) : null,
      sparkline: values.slice(-24).map((v) => Number(v.toFixed(4))),
      period_label: series[series.length - 1].label,
      comparison_label: series.length > 1 ? series[series.length - 2].label : 'no prior period',
      contribution_ready: def.additive,
      tags: def.tags ?? [],
    });
  }

  const primary =
    kpis.find((k) => k.tags.includes('headline')) ??
    kpis.find((k) => k.unit === 'currency' && k.additive) ??
    kpis[0] ??
    null;

  return {
    scorecard: {
      domain,
      grain,
      date_column: dateColumn,
      period_label: kpis[0]?.period_label ?? 'all data',
      comparison_label: kpis[0]?.comparison_label ?? 'no prior period',
      kpis,
      roles: resolved,
      seasonality: detectSeasonality(primary, grain),
      primary_kpi_id: primary?.id ?? null,
    },
    grain,
    periods,
    expressions,
    definitions: Object.fromEntries(usable.map((d) => [d.id, d])),
  };
}

/**
 * Cheap seasonality probe: compare the mean of each calendar slot against the
 * overall mean. Deliberately not a full STL decomposition - the aim is to warn
 * the reader that a period-on-period delta may be seasonal, not to forecast.
 */
function detectSeasonality(kpi: Kpi | null, grain: Grain): Scorecard['seasonality'] {
  const none = { detected: false, period: null, strength: 0, peak_label: null, trough_label: null };
  if (!kpi) return none;
  const cycle = grain === 'month' ? 12 : grain === 'week' ? 52 : grain === 'day' ? 7 : 4;
  const values = kpi.series.map((p) => p.value);
  if (values.length < cycle * 2) return none;

  const slots: number[][] = Array.from({ length: cycle }, () => []);
  values.forEach((v, i) => slots[i % cycle].push(v));
  const slotMeans = slots.map((s) => (s.length ? mean(s) : 0));
  const overall = mean(values);
  if (!overall) return none;

  const amplitude = (Math.max(...slotMeans) - Math.min(...slotMeans)) / Math.abs(overall);
  if (amplitude < 0.15) return none;

  const peakIdx = slotMeans.indexOf(Math.max(...slotMeans));
  const troughIdx = slotMeans.indexOf(Math.min(...slotMeans));
  const labelFor = (i: number) => kpi.series[i]?.label ?? null;
  return {
    detected: true,
    period: cycle,
    strength: Number(Math.min(1, amplitude).toFixed(2)),
    peak_label: labelFor(peakIdx),
    trough_label: labelFor(troughIdx),
  };
}
