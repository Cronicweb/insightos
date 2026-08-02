'use client';

import * as React from 'react';
import { Sparkles, FlaskConical, ChevronDown } from 'lucide-react';
import type { ChartSpec } from '@/lib/types';
import { formatPValue } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The Insights panel.
 *
 * InsightOS treats "a chart without an explanation" as a bug, not a style
 * choice: the Python `ChartSpec` dataclass raises if constructed without a
 * narrative, so by the time a spec reaches this component the explanation is
 * guaranteed to exist. This frame is where that guarantee becomes visible.
 */
export function ChartFrame({
  spec,
  children,
  toolbar,
  className,
  dense = false,
}: {
  spec: ChartSpec;
  children: React.ReactNode;
  toolbar?: React.ReactNode;
  className?: string;
  dense?: boolean;
}) {
  const [showMethod, setShowMethod] = React.useState(false);
  const n = spec.narrative;

  return (
    <section
      className={cn(
        'overflow-hidden rounded-2xl border border-line bg-surface shadow-card',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold tracking-tight">{spec.title}</h3>
          {spec.subtitle ? (
            <p className="mt-0.5 truncate text-xs text-muted">{spec.subtitle}</p>
          ) : null}
        </div>
        {toolbar ? <div className="shrink-0">{toolbar}</div> : null}
      </div>

      <div className={cn(dense ? 'p-3' : 'p-5')}>{children}</div>

      <div className="border-t border-line bg-elevated/60 px-5 py-4">
        <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-subtle">
          <Sparkles className="h-3 w-3" />
          Insights
        </div>

        <p className="mt-2 text-[13px] font-medium leading-relaxed">{n.headline}</p>

        {n.bullets?.length ? (
          <ul className="mt-2 space-y-1.5">
            {n.bullets.map((b, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-muted">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-subtle" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {n.evidence?.length || n.method_notes?.length ? (
          <>
            <button
              onClick={() => setShowMethod((s) => !s)}
              className="mt-3 inline-flex items-center gap-1 text-2xs font-medium text-muted hover:text-ink"
            >
              <FlaskConical className="h-3 w-3" />
              Evidence &amp; method
              <ChevronDown
                className={cn('h-3 w-3 transition-transform', showMethod && 'rotate-180')}
              />
            </button>

            {showMethod ? (
              <div className="mt-2.5 space-y-2 rounded-xl border border-line bg-surface p-3">
                {n.evidence?.map((e, i) => (
                  <div key={i} className="text-2xs">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-semibold">{e.label}</span>
                      {e.p_value !== null && e.p_value !== undefined ? (
                        <span className="rounded border border-line px-1 py-px tabular text-subtle">
                          {formatPValue(e.p_value)}
                        </span>
                      ) : null}
                      {e.sample_size ? (
                        <span className="text-subtle">n = {e.sample_size}</span>
                      ) : null}
                    </div>
                    {e.comparison ? <p className="mt-0.5 text-muted">{e.comparison}</p> : null}
                    {e.method ? <p className="mt-0.5 text-subtle">Method: {e.method}</p> : null}
                  </div>
                ))}
                {n.method_notes?.length ? (
                  <ul className="space-y-1 border-t border-line pt-2">
                    {n.method_notes.map((m, i) => (
                      <li key={i} className="text-2xs text-subtle">
                        {m}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {spec.footnote ? <p className="mt-2 text-2xs text-subtle">{spec.footnote}</p> : null}
      </div>
    </section>
  );
}
