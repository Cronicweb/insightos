'use client';

import * as React from 'react';
import { Search, ChevronRight, Database, Gauge, AlertTriangle, Lightbulb } from 'lucide-react';
import type { Analysis, DatasetSummary } from '@/lib/types';
import { formatInt, formatValue, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DeltaPill, Kbd } from './ui/primitives';

/**
 * Left rail: dataset switcher on top, then a searchable, expandable KPI list -
 * the structural analogue of the account tree in the reference design.
 */
export function Sidebar({
  datasets,
  activeKey,
  onSelect,
  analysis,
  selectedKpi,
  onSelectKpi,
}: {
  datasets: DatasetSummary[];
  activeKey: string;
  onSelect: (key: string) => void;
  analysis: Analysis | null;
  selectedKpi: string | null;
  onSelectKpi: (id: string) => void;
}) {
  const [query, setQuery] = React.useState('');
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const kpis = analysis?.scorecard?.kpis ?? [];
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? kpis.filter(
        (k) =>
          k.label.toLowerCase().includes(needle) ||
          k.id.toLowerCase().includes(needle) ||
          k.formula.toLowerCase().includes(needle),
      )
    : kpis;

  const primary = analysis?.scorecard?.primary_kpi_id;

  return (
    <aside className="flex w-full flex-col gap-3 lg:w-[300px] lg:shrink-0">
      <div className="rounded-2xl border border-line bg-surface shadow-card">
        <div className="relative p-3">
          <Search className="pointer-events-none absolute left-6 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search metrics"
            className="w-full rounded-xl border border-line bg-elevated py-2 pl-8 pr-14 text-[13px] outline-none placeholder:text-subtle focus:border-accent/50"
          />
          <span className="pointer-events-none absolute right-6 top-1/2 -translate-y-1/2">
            <Kbd>&#8984;K</Kbd>
          </span>
        </div>

        <div className="px-3 pb-3">
          <div className="mb-1.5 px-1 text-2xs font-semibold uppercase tracking-[0.08em] text-subtle">
            Workspaces
          </div>
          <div className="space-y-1">
            {datasets.map((d) => {
              const active = d.key === activeKey;
              return (
                <button
                  key={d.key}
                  onClick={() => onSelect(d.key)}
                  className={cn(
                    'w-full rounded-xl border px-3 py-2.5 text-left transition-colors',
                    active
                      ? 'border-accent/40 bg-accent/[0.06]'
                      : 'border-transparent hover:bg-elevated',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold">{d.name}</span>
                    {d.primaryKpi ? (
                      <DeltaPill
                        value={d.primaryKpi.deltaPct}
                        favourable={d.primaryKpi.isFavourable}
                      />
                    ) : null}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-2xs text-muted">
                    <span className="inline-flex items-center gap-1">
                      <Database className="h-3 w-3" />
                      {formatInt(d.rows)} rows
                    </span>
                    <span className="text-subtle">&middot;</span>
                    <span className="capitalize">{d.domain}</span>
                    <span className="text-subtle">&middot;</span>
                    <span className="inline-flex items-center gap-1">
                      <Gauge className="h-3 w-3" />
                      {d.qualityGrade}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 rounded-2xl border border-line bg-surface shadow-card">
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-subtle">
            Discovered KPIs
          </span>
          <span className="text-2xs text-subtle">{kpis.length}</span>
        </div>

        <div className="max-h-[560px] overflow-y-auto px-2 pb-3">
          {visible.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-subtle">
              No metric matches &ldquo;{query}&rdquo;.
            </p>
          ) : null}

          {visible.map((k) => {
            const open = expanded[k.id] ?? false;
            const selected = selectedKpi === k.id;
            return (
              <div key={k.id} className="border-b border-dashed border-line/70 last:border-0">
                <div
                  className={cn(
                    'flex items-center gap-1 rounded-xl px-2 py-2.5',
                    selected && 'bg-elevated',
                  )}
                >
                  <button
                    onClick={() => setExpanded((s) => ({ ...s, [k.id]: !open }))}
                    aria-label={open ? 'Collapse' : 'Expand'}
                    className="grid h-5 w-5 shrink-0 place-items-center rounded text-subtle hover:text-ink"
                  >
                    <ChevronRight
                      className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')}
                    />
                  </button>
                  <button
                    onClick={() => onSelectKpi(k.id)}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium">{k.label}</span>
                        {primary === k.id ? (
                          <span className="shrink-0 rounded border border-accent/30 bg-accent/10 px-1 text-[9px] font-semibold uppercase text-accent">
                            primary
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-2xs text-subtle">
                        {k.formula}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[13px] font-semibold tabular">
                        {formatValue(k.value, k.unit)}
                      </span>
                      <span className="mt-0.5 block">
                        <DeltaPill value={k.delta_pct} favourable={k.is_favourable} />
                      </span>
                    </span>
                  </button>
                </div>

                {open ? (
                  <div className="space-y-1.5 px-9 pb-3 text-2xs text-muted">
                    <p>{k.description}</p>
                    <div className="flex justify-between">
                      <span className="text-subtle">{k.comparison_label}</span>
                      <span className="tabular">{formatValue(k.previous_value, k.unit)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-subtle">{k.period_label}</span>
                      <span className="tabular">{formatValue(k.value, k.unit)}</span>
                    </div>
                    {k.trend ? (
                      <div className="flex justify-between">
                        <span className="text-subtle">Trend</span>
                        <span>
                          {titleCase(k.trend.direction)}
                          {k.trend.significant ? ' (significant)' : ' (not significant)'}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {analysis ? <SidebarFooter analysis={analysis} /> : null}
    </aside>
  );
}

function SidebarFooter({ analysis }: { analysis: Analysis }) {
  const anomalies = analysis.anomalies?.anomalies?.length ?? 0;
  const critical = analysis.anomalies?.critical_count ?? 0;
  const recs = analysis.recommendations?.recommendations?.length ?? 0;
  const ms = Object.values(analysis.timings_ms ?? {}).reduce((a, b) => a + b, 0);

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="grid grid-cols-2 gap-3 text-2xs">
        <Stat
          icon={<AlertTriangle className="h-3 w-3" />}
          label="Anomalies"
          value={`${anomalies}`}
          hint={critical ? `${critical} critical` : 'none critical'}
        />
        <Stat
          icon={<Lightbulb className="h-3 w-3" />}
          label="Actions"
          value={`${recs}`}
          hint={`${analysis.recommendations?.rules_fired ?? 0}/${
            analysis.recommendations?.rules_evaluated ?? 0
          } rules fired`}
        />
      </div>
      <p className="mt-3 border-t border-line pt-3 text-2xs text-subtle">
        Full pipeline computed in {(ms / 1000).toFixed(1)}s over {formatInt(analysis.rows)} rows
        &middot; {analysis.columns} columns.
      </p>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-subtle">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold leading-none tabular">{value}</div>
      <div className="mt-1 text-subtle">{hint}</div>
    </div>
  );
}
