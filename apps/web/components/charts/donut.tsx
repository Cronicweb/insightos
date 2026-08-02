'use client';

import * as React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { ChartSpec, Unit } from '@/lib/types';
import { formatExact, formatPct } from '@/lib/format';
import { colourAt } from '@/lib/utils';

interface Slice {
  name: string;
  value: number;
  display: string;
  share: number;
}

/** Donut with a centre read-out, matching the reference dashboard's composition card. */
export function Donut({ spec, height = 300 }: { spec: ChartSpec; height?: number }) {
  const unit = ((spec.encoding?.unit as Unit) ?? spec.unit ?? 'number') as Unit;
  const data = spec.data as unknown as Slice[];
  const [active, setActive] = React.useState(0);
  const focus = data[Math.min(active, data.length - 1)];

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_170px] sm:items-center">
      <div className="relative" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              content={({ active: on, payload }) => {
                if (!on || !payload?.length) return null;
                const p = payload[0].payload as Slice;
                return (
                  <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-pop">
                    <div className="text-2xs text-subtle">{p.name}</div>
                    <div className="text-[13px] font-semibold tabular">
                      {p.display ?? formatExact(p.value, unit)}
                    </div>
                    <div className="text-2xs text-muted">{formatPct(p.share, 1)} of total</div>
                  </div>
                );
              }}
            />
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={1.5}
              stroke="none"
              onMouseEnter={(_, i) => setActive(i)}
            >
              {data.map((d, i) => (
                <Cell key={d.name} fill={colourAt(i)} opacity={i === active ? 1 : 0.45} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        {focus ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="text-center">
              <div className="text-2xs text-muted">{focus.name}</div>
              <div className="mt-0.5 text-xl font-semibold tabular">
                {focus.display ?? formatExact(focus.value, unit)}
              </div>
              <div className="mt-1.5 inline-block rounded-full bg-ink px-2 py-0.5 text-2xs font-semibold text-canvas tabular">
                {formatPct(focus.share, 2)}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <ul className="space-y-1.5">
        {data.map((d, i) => (
          <li key={d.name}>
            <button
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left hover:bg-elevated"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colourAt(i) }}
                />
                <span className="truncate text-xs">{d.name}</span>
              </span>
              <span className="shrink-0 text-2xs tabular text-muted">{formatPct(d.share, 1)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
