'use client';

import * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartSpec, Unit } from '@/lib/types';
import { formatExact, formatValue } from '@/lib/format';

export type SeriesMode = 'area' | 'bar' | 'line' | 'table';

export function AreaSeries({
  spec,
  mode = 'area',
  height = 260,
}: {
  spec: ChartSpec;
  mode?: SeriesMode;
  height?: number;
}) {
  const unit = (spec.unit ?? 'number') as Unit;
  const data = spec.data as { label: string; value: number; display?: string }[];

  if (mode === 'table') {
    return (
      <div className="max-h-[300px] overflow-auto rounded-xl border border-line">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-elevated text-2xs uppercase tracking-wide text-subtle">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Period</th>
              <th className="px-3 py-2 text-right font-semibold">Value</th>
              <th className="px-3 py-2 text-right font-semibold">Change</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => {
              const prev = i > 0 ? data[i - 1].value : null;
              const change =
                prev !== null && prev !== 0 ? ((d.value - prev) / Math.abs(prev)) * 100 : null;
              return (
                <tr key={d.label} className="border-t border-line">
                  <td className="px-3 py-1.5">{d.label}</td>
                  <td className="px-3 py-1.5 text-right tabular">
                    {d.display ?? formatExact(d.value, unit)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular text-muted">
                    {change === null ? '\u2014' : `${change > 0 ? '+' : ''}${change.toFixed(1)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const axis = { stroke: 'transparent', tickLine: false, axisLine: false } as const;
  const tooltip = (
    <Tooltip
      cursor={{ stroke: 'rgb(var(--line))', strokeWidth: 1 }}
      content={({ active, payload, label }) => {
        if (!active || !payload?.length) return null;
        const p = payload[0].payload as { display?: string; value: number };
        return (
          <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-pop">
            <div className="text-2xs text-subtle">{label}</div>
            <div className="text-[13px] font-semibold tabular">
              {p.display ?? formatExact(p.value, unit)}
            </div>
          </div>
        );
      }}
    />
  );

  return (
    <ResponsiveContainer width="100%" height={height}>
      {mode === 'bar' ? (
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} />
          <YAxis {...axis} width={56} tickFormatter={(v: number) => formatValue(v, unit)} />
          {tooltip}
          <Bar dataKey="value" fill="rgb(var(--accent))" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      ) : mode === 'line' ? (
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} />
          <YAxis {...axis} width={56} tickFormatter={(v: number) => formatValue(v, unit)} />
          {tooltip}
          <Line
            type="monotone"
            dataKey="value"
            stroke="rgb(var(--accent))"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      ) : (
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="insightos-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity={0.22} />
              <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} />
          <YAxis {...axis} width={56} tickFormatter={(v: number) => formatValue(v, unit)} />
          {tooltip}
          <Area
            type="monotone"
            dataKey="value"
            stroke="rgb(var(--accent))"
            strokeWidth={2}
            fill="url(#insightos-area)"
          />
        </AreaChart>
      )}
    </ResponsiveContainer>
  );
}
