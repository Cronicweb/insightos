'use client';

import * as React from 'react';
import { ChevronRight, ShieldCheck, GitBranch, Target } from 'lucide-react';
import type { RootCauseNode, RootCauseTree, Unit } from '@/lib/types';
import { fixed, formatExact, formatPValue, formatPct, formatSignedPct, formatValue, titleCase } from '@/lib/format';
import { Badge, SectionLabel } from '../ui/primitives';
import { ROLE_STYLE, cn } from '@/lib/utils';

/**
 * The explainable root-cause tree.
 *
 * Every claim on this panel is rendered from an engine field: the contribution
 * share, the excess over the expected move, the statistical test and its
 * corrected p-value. The panel deliberately also shows what was *ruled out* -
 * an explanation you cannot falsify is not an explanation.
 */
export function RootCausePanel({ tree }: { tree: RootCauseTree }) {
  const unit = tree.unit as Unit;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line p-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-accent" />
              <SectionLabel>Root cause &middot; {tree.metric_label}</SectionLabel>
            </div>
            <h3 className="mt-2 text-lg font-semibold tracking-tight">{tree.headline}</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge
                tone={
                  tree.severity === 'critical'
                    ? 'negative'
                    : tree.severity === 'high'
                      ? 'warning'
                      : 'neutral'
                }
              >
                {titleCase(tree.severity)} severity
              </Badge>
              <Badge tone="neutral">{titleCase(tree.comparison_type.replace(/_/g, ' '))}</Badge>
              <Badge tone="accent">Confidence {fixed(tree.confidence * 100, 0)}%</Badge>
              {tree.comparison_caveats?.length ? (
                <Badge tone="warning">Read the caveats</Badge>
              ) : null}
            </div>

            {tree.comparison_caveats?.length ? (
              <div className="mt-3 rounded-xl border border-warning/30 bg-warning/5 p-3">
                <p className="text-2xs font-semibold uppercase tracking-wide text-warning">
                  Before acting on this comparison
                </p>
                <ul className="mt-2 space-y-1.5">
                  {tree.comparison_caveats.map((c, i) => (
                    <li key={i} className="flex gap-2 text-2xs leading-relaxed text-muted">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-warning" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <dl className="grid w-full grid-cols-3 gap-x-4 gap-y-1 sm:w-auto sm:shrink-0 sm:gap-x-6 sm:text-right">
            <Figure label={tree.baseline_period} value={formatValue(tree.baseline_value, unit)} />
            <Figure label={tree.current_period} value={formatValue(tree.current_value, unit)} />
            <Figure
              label="Change"
              value={formatSignedPct(tree.delta_pct)}
              tone={
                tree.is_favourable === false
                  ? 'negative'
                  : tree.is_favourable
                    ? 'positive'
                    : undefined
              }
            />
          </dl>
        </div>

        <div className="space-y-2 p-5">
          {tree.narrative.map((line, i) => (
            <p
              key={i}
              className={cn('text-[13px] leading-relaxed', i === 0 ? 'font-medium' : 'text-muted')}
            >
              {line}
            </p>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="rounded-2xl border border-line bg-surface shadow-card">
          <div className="flex items-center gap-2 border-b border-line px-5 py-4">
            <GitBranch className="h-4 w-4 text-muted" />
            <h4 className="text-[15px] font-semibold tracking-tight">Evidence tree</h4>
            <span className="ml-auto text-2xs text-subtle">
              drilled {tree.nodes.some((n) => n.children.length) ? 2 : 1} level
              {tree.nodes.some((n) => n.children.length) ? 's' : ''}
            </span>
          </div>
          <div className="p-3">
            {tree.nodes.map((node, i) => (
              <NodeRow
                key={`${node.dimension}-${node.segment}`}
                node={node}
                unit={unit}
                depth={0}
                defaultOpen={i === 0}
              />
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-surface shadow-card">
            <div className="border-b border-line px-5 py-4">
              <h4 className="text-[15px] font-semibold tracking-tight">Dimension ranking</h4>
              <p className="mt-0.5 text-xs text-muted">
                Which cut of the data explains the move best.
              </p>
            </div>
            <ul className="divide-y divide-line">
              {tree.dimension_scores.map((d) => (
                <li key={d.dimension} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px] font-medium">{titleCase(d.dimension)}</span>
                    <span className="text-2xs tabular text-muted">
                      {fixed(d.explanatory_power * 100, 0)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-line/60">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${Math.min(100, d.explanatory_power * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-2xs text-muted">
                    {d.verdict} &middot; {d.significant_segments}/{d.segments_tested} segments
                    significant
                  </p>
                </li>
              ))}
            </ul>
          </div>

          {tree.ruled_out.length ? (
            <div className="rounded-2xl border border-line bg-surface shadow-card">
              <div className="flex items-center gap-2 border-b border-line px-5 py-4">
                <ShieldCheck className="h-4 w-4 text-positive" />
                <h4 className="text-[15px] font-semibold tracking-tight">Ruled out</h4>
              </div>
              <ul className="divide-y divide-line">
                {tree.ruled_out.map((r) => (
                  <li key={r.name} className="px-5 py-3">
                    <div className="text-[13px] font-medium">{titleCase(r.name)}</div>
                    <p className="mt-0.5 text-2xs text-muted">{r.reason}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {tree.method_notes.length ? (
            <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
              <SectionLabel>Method</SectionLabel>
              {tree.contribution_method ? (
                <p className="mt-2 rounded-lg border border-line bg-elevated px-3 py-2 text-2xs leading-relaxed text-muted">
                  {tree.contribution_method}
                </p>
              ) : null}
              <ul className="mt-2 space-y-1.5">
                {tree.method_notes.map((m, i) => (
                  <li key={i} className="text-2xs leading-relaxed text-muted">
                    {m}
                  </li>
                ))}
              </ul>
              {tree.excluded_dimensions.length ? (
                <p className="mt-3 border-t border-line pt-3 text-2xs text-subtle">
                  Excluded as circular (they define the metric):{' '}
                  {tree.excluded_dimensions.join(', ')}.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
}) {
  return (
    <div>
      <dt className="text-2xs text-subtle">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-[15px] font-semibold tabular',
          tone === 'negative' && 'text-negative',
          tone === 'positive' && 'text-positive',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function NodeRow({
  node,
  unit,
  depth,
  defaultOpen = false,
}: {
  node: RootCauseNode;
  unit: Unit;
  depth: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const hasChildren = node.children.length > 0;

  return (
    <div className={cn(depth > 0 && 'ml-4 border-l border-dashed border-line pl-3')}>
      <div className="rounded-xl px-2 py-2.5 hover:bg-elevated/60">
        <div className="flex items-start gap-2">
          <button
            onClick={() => setOpen((s) => !s)}
            disabled={!hasChildren}
            aria-label={open ? 'Collapse' : 'Expand'}
            className={cn(
              'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded text-subtle',
              hasChildren ? 'hover:text-ink' : 'opacity-0',
            )}
          >
            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold">
                {titleCase(node.dimension)} = {node.segment}
              </span>
              <span
                className={cn(
                  'rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                  ROLE_STYLE[node.role] ?? ROLE_STYLE.stable,
                )}
              >
                {node.role}
              </span>
              <span className="rounded border border-line px-1 py-px text-[9px] tabular text-subtle">
                {formatPValue(node.p_value)}{' '}
                {node.p_value_adjusted_significant ? '\u00b7 BH-significant' : '\u00b7 not significant'}
              </span>
            </div>

            <p className="mt-1 text-[13px] leading-relaxed text-muted">{node.narrative}</p>

            <div className="mt-2 grid grid-cols-2 gap-x-5 gap-y-1.5 sm:grid-cols-4">
              <Metric label="Baseline" value={formatValue(node.baseline, unit)} />
              <Metric label="Current" value={formatValue(node.current, unit)} />
              <Metric
                label="Contribution"
                value={
                  node.contribution_pct === null ? '\u2014' : formatPct(node.contribution_pct, 1)
                }
              />
              <Metric
                label="Excess vs expected"
                value={formatExact(node.excess_delta, unit)}
                hint={`expected ${formatValue(node.expected_delta, unit)}`}
              />
            </div>

            {node.contribution_explanation ? (
              <p className="mt-2 rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-2xs leading-relaxed text-muted">
                <span className="font-semibold text-fg">Contribution: </span>
                {node.contribution_explanation}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {open && hasChildren ? (
        <div className="mt-1">
          {node.children.map((c) => (
            <NodeRow key={`${c.dimension}-${c.segment}`} node={c} unit={unit} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-2xs text-subtle">{label}</div>
      <div className="text-xs font-medium tabular">{value}</div>
      {hint ? <div className="text-[10px] text-subtle">{hint}</div> : null}
    </div>
  );
}
