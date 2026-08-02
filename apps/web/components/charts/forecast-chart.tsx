'use client';

import * as React from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartSpec, Unit } from '@/lib/types';
import { formatExact, formatValue } from '@/lib/format';

interface Point {
  label: string;
  actual: number | null;
  forecast: number | null;
  lower: number | null;
  upper: number | null;
}

/**
 * Actuals plus forecast with a prediction interval.
 *
 * The interval is drawn as a band rather than error bars because the honest
 * message is "the future is a range"; a single line invites false precision.
 */
export function ForecastChart({ spec, height = 280 }: { spec: ChartSpec; height?: number }) {
  const unit = ((spec.encoding?.unit as Unit) ?? spec.unit ?? 'number') as Unit;
  const raw = spec.data as unknown as Point[];

  // Recharts stacks areas, so the band is rendered as (lower) + (upper - lower).
  const data = raw.map((p) => ({
    ...p,
    bandBase: p.lower,
    bandSpan: p.lower !== null && p.upper !== null ? p.upper - p.lower : null,
  }));

  const firstForecast = raw.find((p) => p.forecast !== null && p.actual === null)?.label;
  const axis = { stroke: 'transparent', tickLine: false, axisLine: false } as const;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} />
        <YAxis {...axis} width={58} tickFormatter={(v: number) => formatValue(v, unit)} />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as Point;
            return (
              <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-pop">
                <div className="text-2xs text-subtle">{label}</div>
                {p.actual !== null ? (
                  <div className="text-[13px] font-semibold tabular">
                    {formatExact(p.actual, unit)}
                    <span className="ml-1.5 text-2xs font-normal text-muted">actual</span>
                  </div>
                ) : null}
                {p.forecast !== null ? (
                  <div className="text-[13px] font-semibold tabular">
                    {formatExact(p.forecast, unit)}
                    <span className="ml-1.5 text-2xs font-normal text-muted">forecast</span>
                  </div>
                ) : null}
                {p.lower !== null && p.upper !== null ? (
                  <div className="mt-0.5 text-2xs text-muted tabular">
                    interval {formatValue(p.lower, unit)} &ndash; {formatValue(p.upper, unit)}
                  </div>
                ) : null}
              </div>
            );
          }}
        />
        <Area
          dataKey="bandBase"
          stackId="band"
          stroke="none"
          fill="transparent"
          isAnimationActive={false}
        />
        <Area
          dataKey="bandSpan"
          stackId="band"
          stroke="none"
          fill="rgb(var(--accent))"
          fillOpacity={0.13}
          isAnimationActive={false}
        />
        {firstForecast ? (
          <ReferenceLine
            x={firstForecast}
            stroke="rgb(var(--subtle))"
            strokeDasharray="4 4"
            label={{
              value: 'forecast',
              position: 'insideTopRight',
              fontSize: 10,
              fill: 'rgb(var(--subtle))',
            }}
          />
        ) : null}
        <Line
          type="monotone"
          dataKey="actual"
          stroke="rgb(var(--ink))"
          strokeWidth={2}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="forecast"
          stroke="rgb(var(--accent))"
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={{ r: 2.5 }}
          connectNulls
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
