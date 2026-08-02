'use client';

import * as React from 'react';
import { ChevronDown, Lightbulb } from 'lucide-react';
import type { Recommendation, RecommendationSet } from '@/lib/types';
import { fixed, formatPValue, formatValue, titleCase } from '@/lib/format';
import { Badge, SectionLabel } from '../ui/primitives';
import { SEVERITY_STYLE, cn } from '@/lib/utils';

/**
 * Recommendations are the output of a deterministic rule engine. Each card
 * exposes the rule that fired and the evidence rows it consumed, so a reader can
 * audit the suggestion rather than trust it.
 */
export function RecommendationsPanel({ set }: { set: RecommendationSet }) {
  const [category, setCategory] = React.useState<string>('all');

  const categories = React.useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of set.recommendations) seen.set(r.category, (seen.get(r.category) ?? 0) + 1);
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [set.recommendations]);

  const visible = set.recommendations.filter((r) => category === 'all' || r.category === category);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-accent" />
          <SectionLabel>Recommended actions</SectionLabel>
        </div>
        <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-muted">{set.narrative}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <FilterChip active={category === 'all'} onClick={() => setCategory('all')}>
            All {set.recommendations.length}
          </FilterChip>
          {categories.map(([c, n]) => (
            <FilterChip key={c} active={category === c} onClick={() => setCategory(c)}>
              {titleCase(c)} {n}
            </FilterChip>
          ))}
          <span className="ml-auto text-2xs text-subtle">
            {set.rules_fired} of {set.rules_evaluated} rules fired
          </span>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {visible.map((r) => (
          <RecommendationCard key={r.id} rec={r} />
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-subtle">
          No recommendations in this category.
        </div>
      ) : null}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-accent bg-accent text-white'
          : 'border-line text-muted hover:border-subtle hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  const [open, setOpen] = React.useState(false);

  return (
    <article className="flex flex-col rounded-2xl border border-line bg-surface shadow-card">
      <div className="flex items-start gap-3 border-b border-line p-5">
        <span
          className={cn(
            'mt-0.5 shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide',
            SEVERITY_STYLE[rec.priority] ?? SEVERITY_STYLE.info,
          )}
        >
          {rec.priority}
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="text-[15px] font-semibold leading-snug tracking-tight">{rec.title}</h4>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{rec.action}</p>
        </div>
        {rec.estimated_impact !== null ? (
          <div className="shrink-0 text-right">
            <div className="text-2xs text-subtle">Est. impact</div>
            <div className="text-[15px] font-semibold tabular">
              {formatValue(rec.estimated_impact, rec.impact_unit)}
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-5 py-3 text-2xs sm:grid-cols-4">
        <Field label="Category" value={titleCase(rec.category)} />
        <Field label="Effort" value={titleCase(rec.effort)} />
        <Field label="Horizon" value={titleCase(rec.horizon)} />
        <Field label="Owner" value={rec.owner_hint} />
      </div>

      <div className="mt-auto border-t border-line">
        <button
          onClick={() => setOpen((s) => !s)}
          className="flex w-full items-center justify-between px-5 py-3 text-2xs font-semibold uppercase tracking-[0.08em] text-subtle hover:text-ink"
        >
          Why this fired &middot; {rec.evidence.length} evidence rows
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
        </button>
        {open ? (
          <div className="space-y-3 border-t border-line bg-elevated/50 px-5 py-4">
            <p className="text-[13px] leading-relaxed text-muted">{rec.rationale}</p>
            <div className="flex flex-wrap gap-2">
              <Badge tone="neutral">rule: {rec.triggered_by}</Badge>
              <Badge tone="neutral">confidence {fixed(rec.confidence * 100, 0)}%</Badge>
              {rec.metric ? <Badge tone="neutral">metric: {rec.metric}</Badge> : null}
              {rec.dimension ? (
                <Badge tone="neutral">
                  {rec.dimension}
                  {rec.segment ? ` = ${rec.segment}` : ''}
                </Badge>
              ) : null}
            </div>
            <table className="w-full text-2xs">
              <tbody className="divide-y divide-line">
                {rec.evidence.map((e, i) => (
                  <tr key={i}>
                    <td className="py-1.5 pr-3 text-muted">{e.label}</td>
                    <td className="py-1.5 pr-3 text-right font-medium tabular">
                      {typeof e.value === 'number'
                        ? e.value.toLocaleString()
                        : (e.value ?? '\u2014')}
                    </td>
                    <td className="py-1.5 text-right text-subtle">
                      {e.method ?? ''}
                      {e.p_value != null ? ` \u00b7 ${formatPValue(e.p_value)}` : ''}
                      {e.sample_size != null ? ` \u00b7 n=${e.sample_size.toLocaleString()}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-line pt-3 text-2xs text-subtle">
              <span className="font-semibold text-muted">Measure success by:</span>{' '}
              {rec.success_measure}
            </p>
            {rec.impact_basis ? (
              <p className="text-2xs text-subtle">
                <span className="font-semibold text-muted">Impact basis:</span> {rec.impact_basis}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-subtle">{label}</div>
      <div className="mt-0.5 font-medium text-ink">{value}</div>
    </div>
  );
}
