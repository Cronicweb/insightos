'use client';

import * as React from 'react';
import { AlertTriangle, EyeOff, Radar, ShieldAlert } from 'lucide-react';
import type { AnomalyReport } from '@/lib/types';
import { fixed, formatExact, formatInt, formatPct, formatSignedPct, titleCase } from '@/lib/format';
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
        {report.detection_summary ? (
          <p className="mt-3 text-xs leading-relaxed text-muted">{report.detection_summary}</p>
        ) : null}
        {report.suppression_notes?.length ? (
          <ul className="mt-3 space-y-1.5 rounded-xl border border-line bg-elevated p-3">
            {report.suppression_notes.map((n, i) => (
              <li key={i} className="flex gap-2 text-2xs leading-relaxed text-muted">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-subtle" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        ) : null}
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
                      {a.threshold_label ? <span>threshold {a.threshold_label}</span> : null}
                    </div>
                    {a.baseline_label ? (
                      <p className="mt-1.5 text-2xs leading-relaxed text-subtle">
                        <span className="font-medium">Baseline: </span>
                        {a.baseline_label}
                      </p>
                    ) : null}
                    {a.financial_impact !== null && a.financial_impact !== undefined ? (
                      <p className="mt-1 text-2xs leading-relaxed text-subtle">
                        <span className="font-medium">Impact: </span>
                        {formatExact(a.financial_impact, a.impact_unit)}
                        {a.impact_basis ? ` \u00b7 ${a.impact_basis}` : ''}
                      </p>
                    ) : null}
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

      {report.business_exceptions?.length ? (
        <div className="rounded-2xl border border-line bg-surface shadow-card">
          <div className="flex items-center gap-2 border-b border-line px-5 py-4">
            <ShieldAlert className="h-4 w-4 text-warning" />
            <h3 className="text-[15px] font-semibold tracking-tight">Business-rule exceptions</h3>
            <span className="ml-auto text-2xs text-subtle">{report.business_exceptions.length}</span>
          </div>
          <p className="border-b border-line px-5 py-3 text-2xs leading-relaxed text-muted">
            These are not statistical outliers. A cancelled invoice or a zero-priced line is not surprising
            against history &mdash; it breaks a commercial rule. Mixing the two makes the statistics noisier and
            the rule breaches less specific, so they are reported separately and need different responses.
          </p>
          <ul className="divide-y divide-line">
            {report.business_exceptions.map((e) => (
              <li key={e.id} className="flex gap-3 px-5 py-4">
                <span
                  className={cn(
                    'mt-0.5 h-fit shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide',
                    SEVERITY_STYLE[e.severity] ?? SEVERITY_STYLE.info,
                  )}
                >
                  {e.severity}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[13px] font-semibold">{e.rule}</span>
                    <Badge tone="neutral">
                      {formatInt(e.rows)} rows &middot; {formatPct(e.pct, 2)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted">{e.detail}</p>
                  <p className="mt-1.5 text-2xs leading-relaxed text-subtle">
                    <span className="font-medium">Scope: </span>
                    {e.scope} &middot; {e.impact_basis}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.suppressed?.length ? (
        <details className="group rounded-2xl border border-line bg-surface shadow-card">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4">
            <EyeOff className="h-4 w-4 text-subtle" />
            <h3 className="text-[15px] font-semibold tracking-tight">
              Withheld flags ({report.suppressed.length})
            </h3>
            <span className="ml-auto text-2xs text-subtle group-open:hidden">show</span>
          </summary>
          <p className="border-t border-line px-5 py-3 text-2xs leading-relaxed text-muted">
            Each of these passed the statistical threshold but was judged an artefact of the extract rather
            than a business event. They are listed with their reason so the judgement can be overruled.
          </p>
          <ul className="divide-y divide-line border-t border-line">
            {report.suppressed.map((a, i) => (
              <li key={`${a.metric}-${a.period}-${i}`} className="px-5 py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[13px] font-semibold">{a.metric_label}</span>
                  <span className="text-2xs text-subtle">{a.period}</span>
                  <span className="text-2xs text-subtle">z = {fixed(a.z_score, 2)}</span>
                </div>
                <p className="mt-1 text-2xs leading-relaxed text-muted">{a.suppression_reason}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
