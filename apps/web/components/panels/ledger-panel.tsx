'use client';

import * as React from 'react';
import {
  Calculator, ChevronDown, Layers, ListChecks, ScrollText, Sigma, TrendingUp, Users,
} from 'lucide-react';
import type {
  LedgerAudit, LedgerKpi, LedgerTrend, ParetoBlock, RfmBlock,
} from '@/lib/types';
import { formatExact, formatInt, formatPct, formatValue } from '@/lib/format';
import { Badge, SectionLabel } from '../ui/primitives';
import { cn } from '@/lib/utils';

/**
 * The transaction ledger.
 *
 * A KPI on a slide is an assertion. The same KPI beside its formula, its SQL
 * and its numerator and denominator is a claim a reviewer can falsify. That is
 * the whole design of this panel: every number is shown with the arithmetic
 * that produced it and the exact scope it was measured over, because two
 * revenue figures on one screen that differ by 900,000 are not a bug - they
 * are two different questions, and the failure is not saying which.
 */
export function LedgerPanel({ ledger }: { ledger: LedgerAudit }) {
  return (
    <div className="space-y-4">
      <ScopeHeader ledger={ledger} />
      <KpiGrid kpis={ledger.kpis} />
      <QualityLedger ledger={ledger} />
      <Trends trends={ledger.trends} />
      <ParetoSection blocks={ledger.pareto} />
      {ledger.repeat ? <RepeatSection ledger={ledger} /> : null}
      {ledger.rfm ? <RfmSection rfm={ledger.rfm} /> : null}
      {ledger.notes.length ? (
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
          <SectionLabel>Method notes</SectionLabel>
          <ul className="mt-3 space-y-2">
            {ledger.notes.map((n, i) => (
              <li key={i} className="flex gap-2 text-2xs leading-relaxed text-muted">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-subtle" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ScopeHeader({ ledger }: { ledger: LedgerAudit }) {
  const s = ledger.scope;
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        <ScrollText className="h-4 w-4 text-accent" />
        <SectionLabel>Transaction ledger</SectionLabel>
        <div className="ml-auto flex flex-wrap gap-2">
          <Badge tone="neutral">{formatInt(s.rows)} rows in scope</Badge>
          <Badge tone="neutral">{formatPct(s.rows_pct)} of file</Badge>
          {s.last_period_partial ? <Badge tone="warning">Final period partial</Badge> : null}
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted">{ledger.grain_note}</p>

      <dl className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Scope" value={s.label} />
        <Field
          label="Date range"
          value={s.date_min && s.date_max ? `${s.date_min} to ${s.date_max}` : 'No date column'}
        />
        <Field label="Rows retained" value={`${formatInt(s.rows)} (${formatPct(s.rows_pct)})`} />
        <Field label="Date column" value={s.date_column ?? 'none'} />
      </dl>

      <details className="group mt-4 border-t border-line pt-3">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-2xs font-semibold uppercase tracking-wide text-subtle hover:text-fg">
          <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
          Scope filter (SQL)
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-elevated p-3 text-2xs leading-relaxed text-muted">
          {s.filter_sql}
        </pre>
      </details>

      {s.partial_note ? (
        <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-2xs leading-relaxed text-muted">
          {s.partial_note}
        </p>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs uppercase tracking-wide text-subtle">{label}</dt>
      <dd className="mt-1 break-words text-xs font-medium text-fg">{value}</dd>
    </div>
  );
}

/** Every KPI ships with the arithmetic that produced it. */
function KpiGrid({ kpis }: { kpis: LedgerKpi[] }) {
  if (!kpis.length) return null;
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {kpis.map((k) => (
        <KpiCard key={k.id} kpi={k} />
      ))}
    </div>
  );
}

function KpiCard({ kpi }: { kpi: LedgerKpi }) {
  return (
    <div className="flex flex-col rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <p className="text-2xs font-semibold uppercase tracking-wide text-subtle">{kpi.label}</p>
        <Badge tone={kpi.scope === 'dataset' ? 'neutral' : 'accent'}>
          {kpi.scope === 'dataset' ? 'Dataset' : 'Period'}
        </Badge>
      </div>

      <p className="mt-2 text-2xl font-semibold tracking-tight text-fg">
        {kpi.value === null ? 'n/a' : formatExact(kpi.value, kpi.unit)}
      </p>
      <p className="mt-1 text-2xs text-subtle">{kpi.scope_label}</p>

      {kpi.note ? <p className="mt-3 text-2xs leading-relaxed text-muted">{kpi.note}</p> : null}

      <details className="group mt-auto border-t border-line pt-3 [&:not(:first-child)]:mt-4">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-2xs font-semibold uppercase tracking-wide text-subtle hover:text-fg">
          <Calculator className="h-3 w-3" />
          Calculation details
          <ChevronDown className="ml-auto h-3 w-3 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-2 space-y-2">
          <p className="text-2xs leading-relaxed text-muted">
            <span className="font-semibold text-fg">Formula: </span>
            {kpi.formula}
          </p>
          {kpi.numerator && kpi.denominator ? (
            <p className="text-2xs leading-relaxed text-muted">
              <span className="font-semibold text-fg">Terms: </span>
              {kpi.numerator.label} = {formatValue(kpi.numerator.value)} &divide;{' '}
              {kpi.denominator.label} = {formatValue(kpi.denominator.value)}
            </p>
          ) : null}
          <pre className="overflow-x-auto rounded-lg border border-line bg-elevated p-3 text-2xs leading-relaxed text-muted">
            {kpi.sql}
          </pre>
        </div>
      </details>
    </div>
  );
}

function QualityLedger({ ledger }: { ledger: LedgerAudit }) {
  return (
    <div className="rounded-2xl border border-line bg-surface shadow-card">
      <div className="flex items-center gap-2 border-b border-line px-5 py-4">
        <ListChecks className="h-4 w-4 text-accent" />
        <h3 className="text-[15px] font-semibold tracking-tight">Data quality ledger</h3>
        <span className="ml-auto text-2xs text-subtle">{ledger.quality_rules.length} rules</span>
      </div>

      <p className="border-b border-line px-5 py-3 text-xs leading-relaxed text-muted">
        {ledger.quality_summary}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-line text-2xs uppercase tracking-wide text-subtle">
            <tr>
              <th className="px-5 py-3 font-medium">Condition</th>
              <th className="px-5 py-3 font-medium">Detection</th>
              <th className="px-5 py-3 text-right font-medium">Rows</th>
              <th className="px-5 py-3 text-right font-medium">%</th>
              <th className="px-5 py-3 font-medium">Treatment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ledger.quality_rules.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-5 py-3 font-medium text-fg">{r.rule}</td>
                <td className="px-5 py-3 text-muted">{r.detection}</td>
                <td className="px-5 py-3 text-right tabular-nums text-fg">{formatInt(r.rows)}</td>
                <td className="px-5 py-3 text-right tabular-nums text-fg">{formatPct(r.pct, 2)}</td>
                <td className="px-5 py-3 text-muted">
                  {r.treatment}
                  {r.impact ? <span className="mt-1 block text-2xs text-subtle">{r.impact}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ledger.reconciliation.length ? (
        <div className="border-t border-line px-5 py-4">
          <SectionLabel>Reconciliation</SectionLabel>
          <p className="mt-2 text-2xs leading-relaxed text-muted">
            Every row removed is accounted for, so the analysis total can be traced back to the raw file.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-line text-2xs uppercase tracking-wide text-subtle">
                <tr>
                  <th className="py-2 pr-4 font-medium">Step</th>
                  <th className="py-2 pr-4 text-right font-medium">Rows</th>
                  <th className="py-2 pr-4 text-right font-medium">Revenue</th>
                  <th className="py-2 font-medium">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ledger.reconciliation.map((step, i) => (
                  <tr key={i} className="align-top">
                    <td className="py-2 pr-4 font-medium text-fg">{step.label}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-fg">{formatInt(step.rows)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-fg">
                      {formatExact(step.revenue, 'currency')}
                    </td>
                    <td className="py-2 text-muted">{step.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Trends({ trends }: { trends: LedgerTrend[] }) {
  const [grain, setGrain] = React.useState<string>(trends[trends.length - 1]?.grain ?? 'month');
  if (!trends.length) return null;
  const active = trends.find((t) => t.grain === grain) ?? trends[0];
  const max = Math.max(...active.points.map((p) => Math.abs(p.revenue)), 1);

  return (
    <div className="rounded-2xl border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-4">
        <TrendingUp className="h-4 w-4 text-accent" />
        <h3 className="text-[15px] font-semibold tracking-tight">Revenue trend</h3>
        <div className="ml-auto flex gap-1 rounded-lg border border-line bg-elevated p-1">
          {trends.map((t) => (
            <button
              key={t.grain}
              type="button"
              onClick={() => setGrain(t.grain)}
              className={cn(
                'rounded-md px-3 py-1 text-2xs font-medium capitalize transition',
                t.grain === active.grain ? 'bg-surface text-fg shadow-sm' : 'text-subtle hover:text-fg',
              )}
            >
              {t.grain}
            </button>
          ))}
        </div>
      </div>

      <p className="border-b border-line px-5 py-3 text-2xs leading-relaxed text-muted">{active.note}</p>

      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 border-b border-line bg-surface text-2xs uppercase tracking-wide text-subtle">
            <tr>
              <th className="px-5 py-3 font-medium">Period</th>
              <th className="px-5 py-3 text-right font-medium">Revenue</th>
              <th className="px-5 py-3 text-right font-medium">Orders</th>
              <th className="px-5 py-3 text-right font-medium">Units</th>
              <th className="px-5 py-3 text-right font-medium">Customers</th>
              <th className="w-1/4 px-5 py-3 font-medium">Share</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {active.points.map((p, i) => {
              const last = i === active.points.length - 1 && active.partial_last;
              return (
                <tr key={p.period} className={cn('tabular-nums', last && 'bg-warning/5')}>
                  <td className="px-5 py-2.5 font-medium text-fg">
                    {p.label}
                    {last ? <span className="ml-2 text-2xs text-warning">partial</span> : null}
                  </td>
                  <td className="px-5 py-2.5 text-right text-fg">{formatExact(p.revenue, 'currency')}</td>
                  <td className="px-5 py-2.5 text-right text-muted">{formatInt(p.orders)}</td>
                  <td className="px-5 py-2.5 text-right text-muted">{formatInt(p.units)}</td>
                  <td className="px-5 py-2.5 text-right text-muted">{formatInt(p.customers)}</td>
                  <td className="px-5 py-2.5">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-elevated">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${Math.max(1, (Math.abs(p.revenue) / max) * 100)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ParetoSection({ blocks }: { blocks: ParetoBlock[] }) {
  if (!blocks.length) return null;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {blocks.map((b) => (
        <div key={b.dimension} className="rounded-2xl border border-line bg-surface shadow-card">
          <div className="flex items-center gap-2 border-b border-line px-5 py-4">
            <Sigma className="h-4 w-4 text-accent" />
            <h3 className="text-[15px] font-semibold tracking-tight">{b.label}</h3>
            <span className="ml-auto text-2xs text-subtle">{formatInt(b.entities)} total</span>
          </div>

          <p className="border-b border-line px-5 py-3 text-xs leading-relaxed text-muted">{b.headline}</p>

          <ul className="max-h-[340px] divide-y divide-line overflow-auto">
            {b.entries.map((e) => (
              <li key={`${e.rank}-${e.name}`} className="px-5 py-2.5">
                <div className="flex items-baseline gap-3">
                  <span className="w-6 shrink-0 text-2xs tabular-nums text-subtle">{e.rank}</span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg" title={e.name}>
                    {e.name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-fg">
                    {formatExact(e.value, 'currency')}
                  </span>
                  <span className="w-12 shrink-0 text-right text-2xs tabular-nums text-subtle">
                    {formatPct(e.share_pct)}
                  </span>
                </div>
                <div className="ml-9 mt-1.5 h-1 w-full overflow-hidden rounded-full bg-elevated">
                  <div
                    className="h-full rounded-full bg-accent/40"
                    style={{ width: `${Math.min(100, e.cumulative_pct)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function RepeatSection({ ledger }: { ledger: LedgerAudit }) {
  const r = ledger.repeat!;
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-accent" />
        <h3 className="text-[15px] font-semibold tracking-tight">Repeat versus one-time customers</h3>
      </div>

      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Identified customers" value={formatInt(r.identified_customers)} />
        <Stat
          label="Repeat customers"
          value={`${formatInt(r.repeat_customers)} (${formatPct(r.repeat_rate_pct)})`}
        />
        <Stat label="One-time customers" value={formatInt(r.one_time_customers)} />
        <Stat
          label="Revenue from repeat"
          value={`${formatExact(r.repeat_revenue, 'currency')} (${formatPct(r.repeat_revenue_share_pct)})`}
        />
      </dl>

      <p className="mt-4 rounded-lg border border-line bg-elevated px-3 py-2 text-2xs leading-relaxed text-muted">
        {r.note}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-2xs uppercase tracking-wide text-subtle">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tracking-tight text-fg">{value}</dd>
    </div>
  );
}

function RfmSection({ rfm }: { rfm: RfmBlock }) {
  return (
    <div className="rounded-2xl border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-4">
        <Layers className="h-4 w-4 text-accent" />
        <h3 className="text-[15px] font-semibold tracking-tight">RFM segmentation</h3>
        <div className="ml-auto flex flex-wrap gap-2">
          <Badge tone="neutral">{formatInt(rfm.customers)} customers</Badge>
          <Badge tone="neutral">as of {rfm.as_of}</Badge>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-line text-2xs uppercase tracking-wide text-subtle">
            <tr>
              <th className="px-5 py-3 font-medium">Segment</th>
              <th className="px-5 py-3 text-right font-medium">Customers</th>
              <th className="px-5 py-3 text-right font-medium">% base</th>
              <th className="px-5 py-3 text-right font-medium">Revenue</th>
              <th className="px-5 py-3 text-right font-medium">% revenue</th>
              <th className="px-5 py-3 text-right font-medium">Recency</th>
              <th className="px-5 py-3 text-right font-medium">Freq</th>
              <th className="px-5 py-3 font-medium">Recommended action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rfm.segments.map((s) => (
              <tr key={s.segment} className="align-top tabular-nums">
                <td className="px-5 py-3 font-medium text-fg">{s.segment}</td>
                <td className="px-5 py-3 text-right text-fg">{formatInt(s.customers)}</td>
                <td className="px-5 py-3 text-right text-muted">{formatPct(s.share_pct)}</td>
                <td className="px-5 py-3 text-right text-fg">{formatExact(s.revenue, 'currency')}</td>
                <td className="px-5 py-3 text-right text-muted">{formatPct(s.revenue_share_pct)}</td>
                <td className="px-5 py-3 text-right text-muted">{formatInt(s.avg_recency_days)}d</td>
                <td className="px-5 py-3 text-right text-muted">{s.avg_frequency.toFixed(1)}</td>
                <td className="px-5 py-3 text-left font-sans text-muted">{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-1 border-t border-line px-5 py-4">
        {rfm.method.map((m, i) => (
          <li key={i} className="text-2xs leading-relaxed text-muted">
            {m}
          </li>
        ))}
      </ul>
    </div>
  );
}
