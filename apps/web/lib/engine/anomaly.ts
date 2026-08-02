/**
 * Anomaly detection.
 *
 * Two complementary passes:
 *   1. Temporal - robust z-scores on the period series of every KPI, so a
 *      single freak month cannot mask the rest of the history (which is what
 *      happens with a mean/standard-deviation control chart).
 *   2. Cross-sectional - segments that sit far from their peers in the current
 *      period, which is how a single bad region or product line surfaces.
 */
import type * as duckdb from '@duckdb/duckdb-wasm';
import type { Anomaly, AnomalyReport, Kpi, SegmentAnomaly, Severity } from '@/lib/types';
import { ident, num, query, str } from './sql';
import { mad, median } from './stats';

function severityFor(z: number): Severity {
  const a = Math.abs(z);
  if (a >= 5) return 'critical';
  if (a >= 4) return 'high';
  if (a >= 3) return 'medium';
  return 'low';
}

export function detectTemporalAnomalies(kpis: Kpi[]): Anomaly[] {
  const out: Anomaly[] = [];
  for (const kpi of kpis) {
    const values = kpi.series.map((p) => p.value);
    if (values.length < 8) continue;
    const med = median(values);
    const scale = mad(values);
    // A near-zero MAD means a flat series; a tiny wobble is not an anomaly.
    if (!Number.isFinite(scale) || scale < Math.abs(med) * 1e-6 || scale === 0) continue;

    values.forEach((v, i) => {
      const z = (v - med) / scale;
      if (Math.abs(z) < 3) return;
      const deviation = v - med;
      out.push({
        metric: kpi.id,
        metric_label: kpi.label,
        period: kpi.series[i].period,
        index: i,
        observed: Number(v.toFixed(4)),
        expected: Number(med.toFixed(4)),
        deviation: Number(deviation.toFixed(4)),
        deviation_pct: med === 0 ? null : Number(((deviation / Math.abs(med)) * 100).toFixed(2)),
        z_score: Number(z.toFixed(2)),
        method: 'robust z-score (median / MAD)',
        kind: z > 0 ? 'spike' : 'dip',
        severity: severityFor(z),
        confidence: Number(Math.min(0.99, 0.6 + Math.abs(z) / 20).toFixed(2)),
        narrative: `${kpi.label} in ${kpi.series[i].label} sat ${Math.abs(z).toFixed(1)} robust deviations ${z > 0 ? 'above' : 'below'} its typical level of ${med.toLocaleString('en-GB', { maximumFractionDigits: 2 })}.`,
      });
    });
  }
  return out.sort((a, b) => Math.abs(b.z_score ?? 0) - Math.abs(a.z_score ?? 0)).slice(0, 30);
}

export async function detectSegmentAnomalies(
  conn: duckdb.AsyncDuckDBConnection,
  table: string,
  dimensions: string[],
  metricId: string,
  metricLabel: string,
  expression: string,
  periodFilter: string,
): Promise<SegmentAnomaly[]> {
  const out: SegmentAnomaly[] = [];
  for (const dim of dimensions.slice(0, 4)) {
    const rows = await query<{ segment: unknown; value: unknown }>(
      conn,
      `SELECT CAST(${ident(dim)} AS VARCHAR) AS segment, ${expression} AS value
         FROM ${ident(table)} WHERE ${periodFilter} AND ${ident(dim)} IS NOT NULL
        GROUP BY 1 HAVING count(*) >= 3`,
    );
    if (rows.length < 4) continue;
    const values = rows.map((r) => num(r.value) ?? 0);
    const total = values.reduce((a, b) => a + b, 0);
    const med = median(values);
    const scale = mad(values);
    if (!scale) continue;

    for (const row of rows) {
      const value = num(row.value) ?? 0;
      const z = (value - med) / scale;
      if (Math.abs(z) < 2.5) continue;
      out.push({
        metric: metricId,
        dimension: dim,
        segment: str(row.segment) ?? '(unknown)',
        value: Number(value.toFixed(4)),
        peer_median: Number(med.toFixed(4)),
        robust_z: Number(z.toFixed(2)),
        direction: z > 0 ? 'above peers' : 'below peers',
        share_of_total_pct: total ? Number(((value / total) * 100).toFixed(2)) : 0,
        severity: severityFor(z),
        narrative: `${str(row.segment)} recorded ${metricLabel} of ${value.toLocaleString('en-GB', { maximumFractionDigits: 2 })}, ${Math.abs(z).toFixed(1)} robust deviations ${z > 0 ? 'above' : 'below'} the peer median across ${dim}.`,
      });
    }
  }
  return out.sort((a, b) => Math.abs(b.robust_z ?? 0) - Math.abs(a.robust_z ?? 0)).slice(0, 20);
}

export function buildAnomalyReport(anomalies: Anomaly[], segments: SegmentAnomaly[], kpis: Kpi[]): AnomalyReport {
  return {
    anomalies,
    segment_anomalies: segments,
    scanned_metrics: kpis.length,
    scanned_points: kpis.reduce((a, k) => a + k.series.length, 0),
    method_notes: [
      'Temporal outliers use a robust z-score built on the median and the median absolute deviation, so one extreme period cannot inflate the threshold that judges it.',
      'A point is reported only beyond three robust deviations; segments are reported beyond 2.5 against their peer median.',
      'Series shorter than eight periods are skipped because no dispersion estimate would be trustworthy.',
    ],
    critical_count: anomalies.filter((a) => a.severity === 'critical').length + segments.filter((s) => s.severity === 'critical').length,
  };
}
