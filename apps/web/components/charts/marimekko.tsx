'use client';

import * as React from 'react';
import type { ChartSpec, Unit } from '@/lib/types';
import { formatExact, formatPct } from '@/lib/format';
import { colourAt, softColourAt } from '@/lib/utils';

interface Child {
  name: string;
  value: number;
  display: string;
  shareOfGroup: number;
}
interface Group {
  name: string;
  value: number;
  display: string;
  share: number;
  children: Child[];
}

/**
 * Marimekko (mosaic) composition chart.
 *
 * Column width encodes each group's share of the total; segment height encodes
 * the sub-share within the group. It is the one chart that shows *both* levels
 * of a two-dimensional composition at once, which is exactly what a root-cause
 * conversation needs - and it is hand-built rather than delegated to a chart
 * library because no general-purpose library models the dual encoding.
 */
export function Marimekko({ spec, height = 340 }: { spec: ChartSpec; height?: number }) {
  const unit = ((spec.encoding?.unit as Unit) ?? spec.unit ?? 'number') as Unit;
  const groups = spec.data as unknown as Group[];
  const [hover, setHover] = React.useState<{
    group: Group;
    child: Child;
    x: number;
    y: number;
  } | null>(null);

  const total = groups.reduce((a, g) => a + Math.abs(g.value), 0) || 1;
  const wrapRef = React.useRef<HTMLDivElement>(null);

  return (
    <div className="relative" ref={wrapRef}>
      <div className="flex gap-1.5" style={{ height }}>
        {groups.map((g, gi) => {
          const widthPct = (Math.abs(g.value) / total) * 100;
          const colour = colourAt(gi);
          const soft = softColourAt(gi);
          const wide = widthPct > 9;
          return (
            <div
              key={g.name}
              className="flex min-w-[10px] flex-col gap-1.5"
              style={{ width: `${widthPct}%` }}
            >
              {g.children.map((c, ci) => {
                const h = Math.max(c.shareOfGroup, 1.5);
                const last = ci === g.children.length - 1;
                return (
                  <div
                    key={c.name}
                    className="relative overflow-hidden rounded-lg transition-[filter] hover:brightness-95 dark:hover:brightness-125"
                    style={{
                      height: `${h}%`,
                      backgroundColor: soft,
                      opacity: 0.55 + 0.45 * (1 - ci / Math.max(g.children.length, 1)),
                    }}
                    onMouseEnter={(e) => {
                      const box = wrapRef.current?.getBoundingClientRect();
                      setHover({
                        group: g,
                        child: c,
                        x: e.clientX - (box?.left ?? 0),
                        y: e.clientY - (box?.top ?? 0),
                      });
                    }}
                    onMouseMove={(e) => {
                      const box = wrapRef.current?.getBoundingClientRect();
                      setHover((prev) =>
                        prev
                          ? {
                              ...prev,
                              x: e.clientX - (box?.left ?? 0),
                              y: e.clientY - (box?.top ?? 0),
                            }
                          : prev,
                      );
                    }}
                    onMouseLeave={() => setHover(null)}
                  >
                    {last && wide ? (
                      <div className="absolute inset-x-2 bottom-2 space-y-1.5">
                        <span
                          className="inline-block rounded-full px-2 py-0.5 text-2xs font-semibold text-white"
                          style={{ backgroundColor: 'rgb(17 24 39 / 0.88)' }}
                        >
                          {formatPct(g.share, 1)}
                        </span>
                        <div className="truncate text-2xs font-medium text-slate-800">{g.name}</div>
                      </div>
                    ) : null}
                    <span
                      className="absolute left-0 top-0 h-full w-[3px]"
                      style={{ backgroundColor: colour, opacity: 0.35 }}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {hover ? (
        <div
          className="pointer-events-none absolute z-20 w-56 rounded-xl border border-line bg-surface p-3 shadow-pop"
          style={{
            left: Math.min(
              Math.max(hover.x - 100, 0),
              Math.max((wrapRef.current?.clientWidth ?? 400) - 230, 0),
            ),
            top: Math.max(hover.y - 96, 0),
          }}
        >
          <div className="flex items-center gap-1.5 text-[13px] font-semibold">
            <span
              className="h-2 w-2 rounded-full"
              style={{
                backgroundColor: colourAt(groups.findIndex((g) => g.name === hover.group.name)),
              }}
            />
            {hover.group.name}
          </div>
          <div className="mt-2 text-2xs text-subtle">{hover.child.name}</div>
          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <span className="text-[15px] font-semibold tabular">
              {hover.child.display ?? formatExact(hover.child.value, unit)}
            </span>
            <span className="rounded-full bg-ink px-1.5 py-0.5 text-2xs font-semibold text-canvas tabular">
              {formatPct(hover.child.shareOfGroup, 1)}
            </span>
          </div>
          <div className="mt-2 border-t border-line pt-2 text-2xs text-muted">
            {hover.group.name} is {formatPct(hover.group.share, 1)} of total &middot;{' '}
            {hover.group.display}
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        {groups.map((g, i) => (
          <span key={g.name} className="inline-flex items-center gap-1.5 text-xs text-muted">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colourAt(i) }} />
            {g.name}
          </span>
        ))}
      </div>
    </div>
  );
}
