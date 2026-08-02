'use client';

import * as React from 'react';
import { TrendingUp } from 'lucide-react';
import type { Analysis } from '@/lib/types';
import { ChartRenderer } from '../charts/chart-renderer';
import { SectionLabel, Badge } from '../ui/primitives';
import { fixed } from '@/lib/format';

export function ForecastPanel({ analysis }: { analysis: Analysis }) {
  const charts = analysis.charts.filter((c) => c.kind === 'forecast');

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-accent" />
          <SectionLabel>Forecast</SectionLabel>
        </div>
        <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-muted">
          Models are selected per metric from the data itself &mdash; seasonal decomposition where a
          stable cycle exists, damped trend otherwise &mdash; and every projection ships with a
          prediction interval and the reasons it might be wrong. InsightOS states its model choice
          rather than hiding it.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {charts.map((c) => (
          <ChartRenderer key={c.id} spec={c} height={260} />
        ))}
      </div>

      <div className="rounded-2xl border border-line bg-surface shadow-card">
        <div className="border-b border-line px-5 py-4">
          <h3 className="text-[15px] font-semibold tracking-tight">
            Model selection &amp; caveats
          </h3>
        </div>
        <ul className="divide-y divide-line">
          {analysis.forecasts.map((f) => (
            <li key={f.metric} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold">{f.metric_label}</span>
                <Badge tone="accent">{f.model}</Badge>
                <Badge tone="neutral">horizon {f.horizon}</Badge>
                {typeof f.mape === 'number' ? (
                  <Badge tone="neutral">backtest MAPE {fixed(f.mape, 1)}%</Badge>
                ) : null}
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{f.narrative}</p>
              <p className="mt-1.5 text-2xs text-subtle">
                <span className="font-semibold text-muted">Why this model:</span>{' '}
                {f.model_rationale}
              </p>
              {f.caveats.length ? (
                <ul className="mt-2 space-y-1">
                  {f.caveats.map((c, i) => (
                    <li key={i} className="flex gap-2 text-2xs leading-relaxed text-subtle">
                      <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-warning" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
