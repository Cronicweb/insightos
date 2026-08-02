'use client';

import * as React from 'react';
import type { ChartSpec, Unit } from '@/lib/types';
import { formatExact, formatPct, formatPValue, formatValue } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Step {
  name: string;
  kind: 'total' | 'driver' | 'offset' | 'stable' | 'other' | string;
  value: number;
  display: string;
  contributionPct?: number;
  significant?: boolean;
  pValue?: number;
}

/**
 * Contribution waterfall: baseline -> each segment's contribution -> current.
 *
 * The bar colour encodes the engine's *role* verdict (driver / offset / stable),
 * not just the sign, because "moved down" and "is the reason it moved down" are
 * different claims and only the second one is actionable.
 */
export function Waterfall({ spec, height = 300 }: { spec: ChartSpec; height?: number }) {
  const unit = ((spec.encoding?.unit as Unit) ?? spec.unit ?? 'number') as Unit;
  const steps = spec.data as unknown as Step[];

  const { bars, min, max } = React.useMemo(() => {
    let running = 0;
    let lo = 0;
    let hi = 0;
    const out = steps.map((s) => {
      if (s.kind === 'total') {
        const bar = { step: s, start: 0, end: s.value };
        running = s.value;
        lo = Math.min(lo, 0, s.value);
        hi = Math.max(hi, s.value);
        return bar;
      }
      const start = running;
      running += s.value;
      lo = Math.min(lo, running, start);
      hi = Math.max(hi, running, start);
      return { step: s, start, end: running };
    });
    return { bars: out, min: lo, max: hi };
  }, [steps]);

  const span = max - min || 1;
  const pos = (v: number) => ((max - v) / span) * 100;

  const colourFor = (kind: string) =>
    kind === 'total'
      ? 'rgb(var(--muted))'
      : kind === 'driver'
        ? 'rgb(var(--negative))'
        : kind === 'offset'
          ? 'rgb(var(--positive))'
          : 'rgb(var(--subtle))';

  return (
    <div>
      <div className="flex items-end gap-2 sm:gap-3" style={{ height }}>
        {bars.map(({ step, start, end }, i) => {
          const top = pos(Math.max(start, end));
          const bottom = pos(Math.min(start, end));
          const heightPct = Math.max(bottom - top, 0.8);
          return (
            <div key={`${step.name}-${i}`} className="group relative flex-1">
              <div className="relative h-full" style={{ height }}>
                <div
                  className="absolute w-full rounded-md transition-opacity group-hover:opacity-85"
                  style={{
                    top: `${top}%`,
                    height: `${heightPct}%`,
                    backgroundColor: colourFor(step.kind),
                    opacity: step.kind === 'total' ? 0.35 : 0.9,
                  }}
                />
              </div>

              <div className="pointer-events-none absolute -top-1 left-1/2 z-20 hidden w-52 -translate-x-1/2 -translate-y-full rounded-xl border border-line bg-surface p-3 shadow-pop group-hover:block">
                <div className="text-[13px] font-semibold">{step.name}</div>
                <div className="mt-1 text-[13px] tabular">
                  {step.display ?? formatExact(step.value, unit)}
                </div>
                {step.contributionPct !== undefined ? (
                  <div className="mt-1 text-2xs text-muted">
                    {formatPct(step.contributionPct, 1)} of the total movement
                  </div>
                ) : null}
                {step.pValue !== undefined && step.pValue !== null ? (
                  <div className="mt-1 text-2xs text-subtle">
                    {formatPValue(step.pValue)}{' '}
                    {step.significant
                      ? '\u00b7 significant after correction'
                      : '\u00b7 not significant'}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex gap-2 sm:gap-3">
        {bars.map(({ step }, i) => (
          <div key={`${step.name}-label-${i}`} className="flex-1 text-center">
            <div className="truncate text-2xs font-medium" title={step.name}>
              {step.name}
            </div>
            <div
              className={cn(
                'mt-0.5 truncate text-2xs tabular',
                step.kind === 'driver'
                  ? 'text-negative'
                  : step.kind === 'offset'
                    ? 'text-positive'
                    : 'text-subtle',
              )}
            >
              {step.kind === 'total' ? formatValue(step.value, unit) : step.display}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-line pt-3 text-2xs text-muted">
        <Legend colour="rgb(var(--negative))" label="Driver \u2014 moved more than expected" />
        <Legend colour="rgb(var(--positive))" label="Offset \u2014 pushed the other way" />
        <Legend colour="rgb(var(--subtle))" label="Stable \u2014 moved with the total" />
      </div>
    </div>
  );
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: colour }} />
      {label}
    </span>
  );
}
