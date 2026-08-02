'use client';

import * as React from 'react';
import type { Analysis, ChartSpec, Kpi } from '@/lib/types';
import { formatExact, formatSignedPct, formatValue } from '@/lib/format';
import { AreaSeries, type SeriesMode } from '../charts/area-series';
import { Segmented, Badge } from '../ui/primitives';
import { AreaChart, BarChart3, LineChart, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The hero card: one enormous number, its period-over-period delta, the shape of
 * the series, and - always - the engine's written explanation underneath.
 */
export function HeroMetric({
  kpi,
  spec,
  analysis,
}: {
  kpi: Kpi;
  spec: ChartSpec | undefined;
  analysis: Analysis;
}) {
  const [mode, setMode] = React.useState<SeriesMode>('area');
  const favourable = kpi.is_favourable;

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4 px-5 pt-5">
      <div>
        <div className="flex items-center gap-2 text-xs text-muted">
          {kpi.label}
          <Badge tone="neutral">{analysis.scorecard.grain}</Badge>
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          <span className="text-[40px] font-semibold leading-none tracking-tight tabular">
            {formatValue(kpi.value, kpi.unit)}
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-semibold tabular',
              favourable === false
                ? 'bg-negative/10 text-negative'
                : favourable === true
                  ? 'bg-positive/10 text-positive'
                  : 'bg-elevated text-muted',
            )}
          >
            {formatSignedPct(kpi.delta_pct)}
          </span>
          <span className="text-xs text-muted">
            vs {formatValue(kpi.previous_value, kpi.unit)} in {kpi.comparison_label}
          </span>
        </div>
        <p className="mt-2 max-w-2xl text-xs text-muted">
          {kpi.description} &middot; <span className="font-mono text-2xs">{kpi.formula}</span>
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden rounded-xl border border-line px-3 py-1.5 text-xs text-muted sm:inline">
          {kpi.period_label}
        </span>
        <Segmented<SeriesMode>
          value={mode}
          onChange={setMode}
          size="sm"
          options={[
            { value: 'bar', label: <BarChart3 className="h-3.5 w-3.5" />, title: 'Bars' },
            { value: 'area', label: <AreaChart className="h-3.5 w-3.5" />, title: 'Area' },
            { value: 'line', label: <LineChart className="h-3.5 w-3.5" />, title: 'Line' },
            { value: 'table', label: <Table2 className="h-3.5 w-3.5" />, title: 'Table' },
          ]}
        />
      </div>
    </div>
  );

  if (!spec) {
    return (
      <section className="rounded-2xl border border-line bg-surface shadow-card">
        {header}
        <div className="p-5 text-xs text-subtle">No series chart available for this metric.</div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      {header}
      <div className="px-3 pb-1 pt-4">
        <AreaSeries spec={spec} mode={mode} height={268} />
      </div>
      <InsightsStrip spec={spec} />
      {kpi.trend ? (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line px-5 py-3 text-2xs text-muted">
          <span>
            Trend: <span className="font-medium text-ink">{kpi.trend.direction}</span>{' '}
            (Mann&ndash;Kendall &tau; = {kpi.trend.tau.toFixed(3)}, p ={' '}
            {kpi.trend.p_value.toExponential(1)})
          </span>
          <span>
            Theil&ndash;Sen slope: {formatExact(kpi.trend.slope_per_period, kpi.unit)} per period (
            {kpi.trend.slope_pct_per_period.toFixed(2)}%)
          </span>
          <span>
            {kpi.trend.significant
              ? 'Significant at \u03b1 = 0.05'
              : 'Not significant at \u03b1 = 0.05'}
          </span>
        </div>
      ) : null}
    </section>
  );
}

function InsightsStrip({ spec }: { spec: ChartSpec }) {
  return (
    <div className="border-t border-line bg-elevated/60 px-5 py-4">
      <div className="text-2xs font-semibold uppercase tracking-[0.08em] text-subtle">Insights</div>
      <p className="mt-2 text-[13px] font-medium leading-relaxed">{spec.narrative.headline}</p>
      <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {spec.narrative.bullets.map((b, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-muted">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-subtle" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
