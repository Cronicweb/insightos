'use client';

// InsightOS — AI Trace panel (§15.3 / §13.11).
// Collapsible "How this was produced" disclosure attached to every AI explanation.

import * as React from 'react';
import type { AITraceExtended } from '@/lib/ai';

const ALL_SOURCES = [
  'Semantic Model',
  'Root Cause Analysis',
  'KPI Engine',
  'Recommendation Engine',
  'SQL Query',
  'Statistical Tests',
] as const;

export function AITracePanel({ trace }: { trace: AITraceExtended }) {
  const [open, setOpen] = React.useState(false);
  const used = new Set(trace.reasoningSources);
  return (
    <div className="mt-3 rounded-xl border border-line bg-elevated/40">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[44px] w-full items-center justify-between px-3 text-left text-xs font-semibold text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
      >
        <span>{open ? '▾' : '▸'} Reasoning Source · how this was produced</span>
        <span className="font-normal">
          {trace.provider} · {trace.model}
        </span>
      </button>
      {open && (
        <div className="space-y-3 px-3 pb-3 text-xs">
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {ALL_SOURCES.map((s) => (
              <span key={s} className={used.has(s) ? 'text-positive' : 'text-muted/50 line-through'}>
                {used.has(s) ? '✓' : '✗'} {s}
              </span>
            ))}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            <Meta k="Provider" v={trace.provider} />
            <Meta k="Model" v={trace.model} />
            <Meta k="Grounding" v={trace.grounding} />
            <Meta k="Prompt" v={trace.promptVersion} />
            <Meta k="Semantic" v={trace.semanticVersion ?? '—'} />
            <Meta k="Analysis hash" v={trace.analysisHash} />
            <Meta k="Temperature" v={String(trace.temperature)} />
            <Meta k="Cached" v={trace.cached ? 'yes' : 'no'} />
            <Meta k="Time" v={new Date(trace.timestamp).toISOString()} />
          </dl>
          {trace.contextSources.length > 0 && (
            <div>
              <p className="font-semibold text-muted">Context sources</p>
              <ul className="mt-1 list-inside list-disc text-muted">
                {trace.contextSources.slice(0, 12).map((c) => (
                  <li key={c} className="truncate">
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted/70">{k}</dt>
      <dd className="truncate font-medium">{v}</dd>
    </div>
  );
}
