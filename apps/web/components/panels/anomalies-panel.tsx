'use client';

import * as React from 'react';
import { AlertTriangle, Radar } from 'lucide-react';
import type { AnomalyReport } from '@/lib/types';
import { fixed, formatInt, formatPct, formatSignedPct, titleCase } from '@/lib/format';
import { Badge, SectionLabel } from '../ui/primitives';
import { SEVERITY_STYLE, cn } from '@/lib/utils';

/**
 * Two kinds of anomaly, deliberately kept apart:
 *   - temporal: a period that broke from its own history (robust z on residuals)
 *   - segment:  a segment that broke from its peers in the same period
 */
export function AnomaliesPanel({ report }: { report: AnomalyReport }) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center gap-3">
          <Radar className="h-4 w-4 text-accent" />
          <SectionLabel>Anomaly scan</SectionLabel>
          <div className="ml-auto flex flex-wrap gap-2">
            <Badge tone="neutral">{formatInt(report.scanned_points)} points scanned</Badge>
            <Badge tone="neutral">{report.scanned_metrics} metrics</Badge>
            <Badge tone={report.critical_count ? 'negative' : 'positive'}>
              {report.critical_count} critical
            </Badge>
          </div>
        </div>
        {report.method_notes.length ? (
          <ul className="mt-3 space-y-1 border-t border-line pt-3">
            {report.method_notes.map((m, i) => (
              <li key={i} className="text-2xs leading-relaxed text-muted">
                {m}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface shadow-card">
          <div className="flex items-center gap-2 border-b border-line px-5 py-4">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <h3 className="text-[15px] font-semibold tracking-tight">Temporal anomalies</h3>
            <span className="ml-auto text-2xs text-subtle">{report.anomalies.length}</span>
          </div>
          {report.anomalies.length ? (
            <ul className="max-h-[600px] divide-y divide-line overflow-auto">
              {report.anomalies.map((a, i) => (
                <li key={`${a.metric}-${a.period}-${i}`} className="flex gap-3 px-5 py-4">
                  <span
                    className={cn(
                      'mt-0.5 h-fit shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide',
                      SEVERITY_STYLE[a.severity] ?? SEVERITY_STYLE.info,
                    )}
                  >
                    {a.severity}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[13px] font-semibold">{a.metric_label}</span>
                      <span className="text-2xs text-subtle">{a.period}</span>
                      <Badge tone="neutral">{titleCase(a.kind)}</Badge>
                    </div>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted">{a.narrative}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-subtle">
                      <span>
                        observed{' '}
                        <span className="font-medium text-ink">{a.observed.toLocaleString()}</span>
                      </span>
                      <span>
                        expected{' '}
                        <span className="font-medium text-ink">{a.expected.toLocaleString()}</span>
                      </span>
                      {a.deviation_pct !== null ? (
                        <span>{formatSignedPct(a.deviation_pct)}</span>
                      ) : null}
                      <span>z = {fixed(a.z_score, 2)}</span>
                      <span>{a.method}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-8 text-center text-sm text-subtle">
              No period broke from its own history beyond the detection threshold.
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-surface shadow-card">
          <div className="flex items-center gap-2 border-b border-line px-5 py-4">
            <AlertTriangle className="h-4 w-4 text-accent" />
            <h3 className="text-[15px] font-semibold tracking-tight">Segment outliers</h3>
            <span className="ml-auto text-2xs text-subtle">{report.segment_anomalies.length}</span>
          </div>
          {report.segment_anomalies.length ? (
            <ul className="max-h-[600px] divide-y divide-line overflow-auto">
              {report.segment_anomalies.map((s, i) => (
                <li key={`${s.dimension}-${s.segment}-${i}`} className="flex gap-3 px-5 py-4">
                  <span
                    className={cn(
                      'mt-0.5 h-fit shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide',
                      SEVERITY_STYLE[s.severity] ?? SEVERITY_STYLE.info,
                    )}
                  >
                    {s.severity}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[13px] font-semibold">
                        {titleCase(s.dimension)} = {s.segment}
                      </span>
                      <Badge tone="neutral">{s.metric}</Badge>
                    </div>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted">{s.narrative}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-subtle">
                      <span>
                        value{' '}
                        <span className="font-medium text-ink">{s.value.toLocaleString()}</span>
                      </span>
                      <span>
                        peer median{' '}
                        <span className="font-medium text-ink">
                          {s.peer_median.toLocaleString()}
                        </span>
                      </span>
                      <span>robust z = {fixed(s.robust_z, 2)}</span>
                      <span>{formatPct(s.share_of_total_pct, 1)} of total</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-8 text-center text-sm text-subtle">
              Every segment sat within the expected range of its peers.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
