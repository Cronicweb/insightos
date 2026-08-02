'use client';

import * as React from 'react';
import { ArrowRight, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { Analysis } from '@/lib/types';
import type { WorkspaceTab } from '../top-nav';
import { fixed, formatSignedPct, formatValue, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The first thing anyone sees.
 *
 * An analyst opens a dashboard already knowing the question: what changed, why,
 * does it matter, and what do I do. Everything else on the page is the working
 * that supports these five answers, so they are stated up front rather than
 * left to be reconstructed from charts.
 *
 * Every field is read from deterministic engine output. Nothing is generated.
 */
export function ExecutiveBrief({
  analysis,
  onTab,
}: {
  analysis: Analysis;
  onTab?: (tab: WorkspaceTab) => void;
}) {
  const kpi = analysis.scorecard.kpis[0];
  const tree = analysis.root_causes[0];
  const driver = tree?.nodes?.find((n) => n.role === 'driver') ?? tree?.nodes?.[0];
  const rec = [...analysis.recommendations.recommendations].sort(
    (a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0),
  )[0];

  const delta = kpi?.delta_pct ?? null;
  const direction = delta == null ? 'flat' : delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : 'flat';
  const favourable = kpi?.is_favourable ?? null;

  const whatChanged = kpi
    ? `${kpi.label} ${direction === 'flat' ? 'held at' : direction === 'up' ? 'rose to' : 'fell to'} ${formatValue(kpi.value, kpi.unit)}${
        delta == null ? '' : ` (${formatSignedPct(delta)} vs the prior period)`
      }.`
    : analysis.report.headline;

  const driverName = driver
    ? [driver.dimension, driver.segment].filter(Boolean).join(' \u00b7 ') || 'One segment'
    : null;

  const why = driver
    ? `${driverName} is the largest single contributor${
        driver.contribution_pct != null
          ? Math.abs(driver.contribution_pct) > 110
            ? `, accounting for more than the entire net movement (${fixed(Math.abs(driver.contribution_pct), 0)}%) \u2014 other segments moved the opposite way`
            : `, accounting for ${fixed(Math.abs(driver.contribution_pct), 0)}% of the movement`
          : ''
      }.`
    : analysis.report.summary.split('. ')[0] + '.';

  const impact =
    rec?.estimated_impact != null
      ? `${formatValue(rec.estimated_impact, rec.impact_unit)} of ${
          rec.metric ?? 'value'
        } is attributable to the issue below.`
      : analysis.recommendations.total_estimated_impact != null
        ? `${formatValue(analysis.recommendations.total_estimated_impact, kpi?.unit)} of estimated value is in play across all open recommendations.`
        : 'No quantified financial exposure was isolated for this period.';

  const confidence = rec?.confidence ?? analysis.report.confidence ?? null;

  return (
    <section
      aria-labelledby="brief-heading"
      className="rounded-2xl border border-line bg-surface shadow-card"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <h2
          id="brief-heading"
          className="text-2xs font-semibold uppercase tracking-[0.08em] text-subtle"
        >
          Executive brief
        </h2>
        <span className="text-2xs text-subtle">
          {analysis.report.period}
          {analysis.report.comparison ? ` vs ${analysis.report.comparison}` : ''}
        </span>
        {confidence != null ? (
          <span className="ml-auto flex items-center gap-2">
            <span className="text-2xs text-subtle">Confidence</span>
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-elevated">
              <span
                className="block h-full rounded-full bg-accent"
                style={{ width: `${Math.round(confidence * 100)}%` }}
              />
            </span>
            <span className="text-2xs font-semibold tabular text-ink">
              {fixed(confidence * 100, 0)}%
            </span>
          </span>
        ) : null}
      </div>

      <dl className="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-4">
        <Cell
          label="What changed"
          tone={direction === 'flat' ? 'flat' : favourable === false ? 'bad' : 'good'}
          icon={
            direction === 'up' ? (
              <TrendingUp className="h-3.5 w-3.5" aria-hidden />
            ) : direction === 'down' ? (
              <TrendingDown className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Minus className="h-3.5 w-3.5" aria-hidden />
            )
          }
        >
          {whatChanged}
        </Cell>
        <Cell label="Why">{why}</Cell>
        <Cell label="Business impact">{impact}</Cell>
        <Cell label="Recommended action">
          {rec ? (
            <>
              <span className="font-medium text-ink">{rec.title}</span>
              <span className="block text-subtle">
                {titleCase(rec.priority)} priority
                {rec.suggested_owner ? ` \u00b7 ${rec.suggested_owner}` : ''}
                {rec.approval_required ? ' \u00b7 approval required' : ''}
              </span>
              {onTab ? (
                <button
                  type="button"
                  onClick={() => onTab('actions')}
                  className="mt-1.5 inline-flex items-center gap-1 rounded text-2xs font-semibold text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  See the evidence
                  <ArrowRight className="h-3 w-3" aria-hidden />
                </button>
              ) : null}
            </>
          ) : (
            'No rule fired at a level that warrants action this period.'
          )}
        </Cell>
      </dl>
    </section>
  );
}

function Cell({
  label,
  children,
  tone = 'flat',
  icon,
}: {
  label: string;
  children: React.ReactNode;
  tone?: 'good' | 'bad' | 'flat';
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-surface px-5 py-4">
      <dt className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-subtle">
        {icon ? (
          <span
            className={cn(
              tone === 'good' && 'text-positive',
              tone === 'bad' && 'text-negative',
              tone === 'flat' && 'text-muted',
            )}
          >
            {icon}
          </span>
        ) : null}
        {label}
      </dt>
      <dd className="mt-1.5 text-[13px] leading-relaxed text-muted">{children}</dd>
    </div>
  );
}
