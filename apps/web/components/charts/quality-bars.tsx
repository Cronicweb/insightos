'use client';

import * as React from 'react';
import type { ChartSpec } from '@/lib/types';
import { formatPct } from '@/lib/format';

interface Dim {
  name: string;
  score: number;
  weight: number;
  detail: string;
}

/** Weighted data-quality dimensions. Bar length = score, label shows the weight. */
export function QualityBars({ spec }: { spec: ChartSpec }) {
  const dims = spec.data as unknown as Dim[];

  const tone = (score: number) =>
    score >= 95
      ? 'rgb(var(--positive))'
      : score >= 85
        ? 'rgb(var(--accent))'
        : score >= 70
          ? 'rgb(var(--warning))'
          : 'rgb(var(--negative))';

  return (
    <ul className="space-y-3.5">
      {dims.map((d) => (
        <li key={d.name}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-medium">
              {d.name}
              <span className="ml-1.5 text-2xs text-subtle">
                weight {formatPct(d.weight * 100, 0)}
              </span>
            </span>
            <span className="text-[13px] font-semibold tabular">{d.score.toFixed(1)}</span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-line/60">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(0, Math.min(100, d.score))}%`,
                backgroundColor: tone(d.score),
              }}
            />
          </div>
          <p className="mt-1.5 text-2xs text-muted">{d.detail}</p>
        </li>
      ))}
    </ul>
  );
}
