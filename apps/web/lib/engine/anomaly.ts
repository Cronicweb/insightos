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
import type {
  Anomaly, AnomalyReport, BusinessException, Kpi, LedgerAudit, SegmentAnomaly, Severity,
} from '@/lib/types';
import { ident, num, query, str } from './sql';
import { mad, median } from './stats';

function severityFor(z: number): Severity {
  const a = Math.abs(z);
  if (a >= 5) return 'critical';
  if (a >= 4) return 'high';
  if (a >= 3) return 'medium';
  return 'low';
}

export function detectTemporalAnomalies(
  kpis: Kpi[],
  partialLastPeriod = false,
): { anomalies: Anomaly[]; suppressed: Anomaly[] } {
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
        anomaly_class: 'statistical',
        baseline_label: `Median of ${values.length} ${kpi.period_label ?? 'period'}s = ${med.toLocaleString('en-GB', { maximumFractionDigits: 2 })}; scale = MAD ${scale.toLocaleString('en-GB', { maximumFractionDigits: 2 })}`,
        threshold_label: '|robust z| >= 3',
        // Only a currency KPI has a monetary reading; a percentage deviating
        // by "3 units" is not money and must not be presented as though it is.
        financial_impact: kpi.unit === 'currency' ? Number(deviation.toFixed(2)) : null,
        impact_unit: kpi.unit,
        impact_basis: kpi.unit === 'currency'
          ? 'Observed minus the median of the same series - the value that would not have occurred at a typical period.'
          : 'Not monetary: this KPI is not measured in currency.',
      });
    });
  }

  const ranked = out.sort((a, b) => Math.abs(b.z_score ?? 0) - Math.abs(a.z_score ?? 0));

  /*
   * Suppression, not deletion.
   *
   * The last period of an extract is almost always incomplete - the export
   * simply stopped mid-trading - and a truncated period reliably reads as the
   * largest dip in the series. Reporting it as a business event is the single
   * most common false positive in transaction data, so it is moved aside with
   * its reason attached rather than silently dropped.
   */
  const suppressed: Anomaly[] = [];
  const kept: Anomaly[] = [];
  for (const a of ranked) {
    const kpi = kpis.find((k) => k.id === a.metric);
    const isLast = kpi ? a.index === kpi.series.length - 1 : false;
    if (isLast && partialLastPeriod && a.kind === 'dip') {
      suppressed.push({
        ...a,
        suppressed: true,
        suppression_reason:
          'Final period of the extract and the file stops mid-period, so the shortfall is a data cutoff rather than a demand event.',
      });
      continue;
    }
    kept.push(a);
  }

  return { anomalies: kept.slice(0, 30), suppressed: suppressed.slice(0, 10) };
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

/**
 * Business-rule exceptions.
 *
 * These are not outliers. A cancelled invoice or a zero-priced line is not
 * statistically surprising - it is a known category of record that breaks a
 * commercial rule. Mixing the two hides both: the statistics get noisier and
 * the rule breaches lose their specificity. They are therefore reported as a
 * separate class with their own severity scale.
 */
export function businessExceptions(ledger: LedgerAudit | null): BusinessException[] {
  if (!ledger) return [];
  const out: BusinessException[] = [];

  const severityFromPct = (pct: number): Severity =>
    pct >= 20 ? 'high' : pct >= 5 ? 'medium' : 'low';

  for (const rule of ledger.quality_rules) {
    if (rule.id === 'missing_description') continue;
    const cancelKpi = ledger.kpis.find((k) => k.id === 'cancellation_rate');
    out.push({
      id: `exception.${rule.id}`,
      rule: rule.rule,
      detail: `${rule.detection}. ${rule.treatment}${rule.impact ? ` ${rule.impact}` : ''}`,
      scope: 'Whole file, before the analysis scope filter',
      rows: rule.rows,
      pct: rule.pct,
      financial_impact:
        rule.id === 'cancelled' && cancelKpi
          ? null
          : null,
      impact_basis:
        rule.id === 'cancelled'
          ? 'Reversed value is recorded, but the true cost of a cancellation is its handling cost, and no cost column exists in this file.'
          : 'Row-count effect on the analysis scope; no monetary value is claimed where none can be computed.',
      severity: severityFromPct(rule.pct),
    });
  }
  return out;
}

export function buildAnomalyReport(
  anomalies: Anomaly[],
  segments: SegmentAnomaly[],
  kpis: Kpi[],
  options: { suppressed?: Anomaly[]; ledger?: LedgerAudit | null } = {},
): AnomalyReport {
  const suppressed = options.suppressed ?? [];
  const exceptions = businessExceptions(options.ledger ?? null);

  const suppressionNotes: string[] = [];
  if (suppressed.length) {
    suppressionNotes.push(
      `${suppressed.length} flag${suppressed.length === 1 ? '' : 's'} were withheld as artefacts rather than events. Each is listed with the reason, so the judgement is auditable rather than hidden.`,
    );
  }
  if (options.ledger) {
    suppressionNotes.push(
      'Cancelled invoices and non-positive quantities and prices are removed before the series is built, so a returns spike cannot masquerade as a demand collapse.',
    );
    suppressionNotes.push(
      'Segments are only tested when they carry at least three rows in the period, which keeps a two-order segment from producing an extreme rate on a denominator of two.',
    );
  }

  return {
    anomalies,
    segment_anomalies: segments,
    scanned_metrics: kpis.length,
    scanned_points: kpis.reduce((a, k) => a + k.series.length, 0),
    method_notes: [
      'Temporal outliers use a robust z-score built on the median and the median absolute deviation, so one extreme period cannot inflate the threshold that judges it.',
      'Threshold: |z| >= 3 for a period against its own history; |z| >= 2.5 for a segment against the median of its peers in the current period.',
      'Baseline: the median of the metric across every period in the series, not the previous period, so a single bad month does not become the yardstick.',
      'Series shorter than eight periods are skipped because no dispersion estimate would be trustworthy.',
      'Statistical anomalies and business-rule exceptions are reported separately: the first is "unusual against history", the second is "breaks a commercial rule". They need different responses.',
    ],
    critical_count:
      anomalies.filter((a) => a.severity === 'critical').length +
      segments.filter((s) => s.severity === 'critical').length,
    business_exceptions: exceptions,
    suppressed,
    suppression_notes: suppressionNotes,
    detection_summary:
      `${anomalies.length} statistical anomal${anomalies.length === 1 ? 'y' : 'ies'} across ` +
      `${kpis.length} metric${kpis.length === 1 ? '' : 's'} and ${kpis.reduce((a, k) => a + k.series.length, 0)} period observations` +
      (segments.length ? `, plus ${segments.length} cross-sectional segment flag${segments.length === 1 ? '' : 's'}` : '') +
      (exceptions.length ? `. ${exceptions.length} business-rule exception${exceptions.length === 1 ? '' : 's'} are reported separately.` : '.'),
  };
}
