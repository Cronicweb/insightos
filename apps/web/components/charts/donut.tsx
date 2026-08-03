'use client';

import * as React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import type { ChartSpec, Unit } from '@/lib/types';
import { formatExact, formatPct } from '@/lib/format';
import { colourAt } from '@/lib/utils';

interface Slice {
  name: string;
  value: number;
  display: string;
  share: number;
}

/** Recharts sizes radius percentages against min(width, height). */
const INNER_RADIUS_RATIO = 0.62;
/** Below this hole diameter the share pill folds into the label line instead. */
const PILL_MIN_HOLE_PX = 118;

/**
 * Donut with a centre read-out, matching the reference dashboard's composition card.
 *
 * There is deliberately no Recharts `<Tooltip>`: with a 62% inner radius the tooltip
 * anchors inside the hole and covers the centre read-out, which already shows the same
 * name, value and share for the hovered slice.
 *
 * The read-out is measured against the hole rather than the card, and its type scales
 * down to fit. Clamping it with `truncate` turned readable figures into `$10.…`, which
 * is worse than a smaller number.
 */
export function Donut({ spec, height = 300 }: { spec: ChartSpec; height?: number }) {
  const unit = ((spec.encoding?.unit as Unit) ?? spec.unit ?? 'number') as Unit;
  const data = spec.data as unknown as Slice[];
  const [active, setActive] = React.useState(0);
  const focus = data[Math.min(active, data.length - 1)];

  const plotRef = React.useRef<HTMLDivElement>(null);
  const [hole, setHole] = React.useState(0);

  React.useEffect(() => {
    const el = plotRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setHole(Math.min(el.clientWidth, el.clientHeight) * INNER_RADIUS_RATIO);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const value = focus ? (focus.display ?? formatExact(focus.value, unit)) : '';
  const room = hole > 0 ? hole * 0.86 : 0;
  const valueSize = room
    ? Math.max(12, Math.min(22, room / (Math.max(value.length, 1) * 0.6)))
    : 20;
  const showPill = hole === 0 || hole >= PILL_MIN_HOLE_PX;

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_170px] sm:items-center">
      <div className="relative" style={{ height }} ref={plotRef}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={`${INNER_RADIUS_RATIO * 100}%`}
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
            <div className="text-center" style={room ? { maxWidth: room } : undefined}>
              <div className="truncate text-2xs text-muted">
                {showPill ? focus.name : `${focus.name} · ${formatPct(focus.share, 1)}`}
              </div>
              <div
                className="mt-0.5 font-semibold leading-tight tabular"
                style={{ fontSize: valueSize }}
              >
                {value}
              </div>
              {showPill ? (
                <div className="mt-1.5 inline-block rounded-full bg-ink px-2 py-0.5 text-2xs font-semibold text-canvas tabular">
                  {formatPct(focus.share, 2)}
                </div>
              ) : null}
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
