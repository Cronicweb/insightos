'use client';

import * as React from 'react';
import type { Analysis, ChartSpec } from '@/lib/types';
import { formatInt, formatPct, titleCase } from '@/lib/format';
import { Badge, SectionLabel, Segmented } from '../ui/primitives';
import { ChartRenderer } from '../charts/chart-renderer';
import { SEVERITY_STYLE, cn } from '@/lib/utils';

type Tab = 'issues' | 'columns' | 'missing' | 'outliers' | 'cardinality';

const DASH = '\u2014';

export function QualityPanel({ analysis, chart }: { analysis: Analysis; chart?: ChartSpec }) {
  const q = analysis.quality;
  const [tab, setTab] = React.useState<Tab>('issues');

  const ring = (score: number) =>
    score >= 95
      ? 'rgb(var(--positive))'
      : score >= 85
        ? 'rgb(var(--accent))'
        : score >= 70
          ? 'rgb(var(--warning))'
          : 'rgb(var(--negative))';

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-card">
          <SectionLabel>Data quality score</SectionLabel>
          <div className="mt-4 flex items-center gap-6">
            <div
              className="relative grid h-28 w-28 shrink-0 place-items-center rounded-full"
              style={{
                background: `conic-gradient(${ring(q.score)} ${q.score * 3.6}deg, rgb(var(--line)) 0deg)`,
              }}
            >
              <div className="grid h-[88px] w-[88px] place-items-center rounded-full bg-surface">
                <div className="text-center">
                  <div className="text-2xl font-semibold tabular">{q.score.toFixed(1)}</div>
                  <div className="text-2xs text-subtle">grade {q.grade}</div>
                </div>
              </div>
            </div>
            <div className="min-w-0 space-y-2 text-[13px]">
              <p className="text-muted">
                Weighted across {q.dimensions.length} dimensions over{' '}
                <span className="font-medium text-ink">{formatInt(q.rows)}</span> rows &times;{' '}
                <span className="font-medium text-ink">{q.columns}</span> columns.
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge tone={q.usable_for_analysis ? 'positive' : 'negative'}>
                  {q.usable_for_analysis ? 'Usable for analysis' : 'Not usable as-is'}
                </Badge>
                <Badge tone="neutral">{q.issues.length} issues</Badge>
                <Badge tone="neutral">
                  {formatInt(q.duplicates.exact_duplicate_rows)} duplicate rows
                </Badge>
              </div>
            </div>
          </div>
        </div>

        {chart ? <ChartRenderer spec={chart} /> : null}
      </div>

      <div className="rounded-2xl border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h3 className="text-[15px] font-semibold tracking-tight">Profiling detail</h3>
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            size="sm"
            options={[
              { value: 'issues', label: `Issues ${q.issues.length}` },
              { value: 'columns', label: `Columns ${analysis.schema.columns.length}` },
              { value: 'missing', label: 'Missing' },
              { value: 'outliers', label: `Outliers ${q.outliers.length}` },
              { value: 'cardinality', label: 'Cardinality' },
            ]}
          />
        </div>

        <div className="max-h-[560px] overflow-auto">
          {tab === 'issues' ? <Issues analysis={analysis} /> : null}
          {tab === 'columns' ? <Columns analysis={analysis} /> : null}
          {tab === 'missing' ? <Missing analysis={analysis} /> : null}
          {tab === 'outliers' ? <Outliers analysis={analysis} /> : null}
          {tab === 'cardinality' ? <Cardinality analysis={analysis} /> : null}
        </div>
      </div>
    </div>
  );
}

function Issues({ analysis }: { analysis: Analysis }) {
  const issues = analysis.quality.issues;
  if (!issues.length) {
    return <p className="p-8 text-center text-sm text-subtle">No quality issues detected.</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {issues.map((i) => (
        <li key={i.id} className="flex gap-3 px-5 py-4">
          <span
            className={cn(
              'mt-0.5 h-fit shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide',
              SEVERITY_STYLE[i.severity] ?? SEVERITY_STYLE.info,
            )}
          >
            {i.severity}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold">{i.title}</span>
              <Badge tone="neutral">{i.dimension}</Badge>
              {i.column ? <Badge tone="neutral">{i.column}</Badge> : null}
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{i.detail}</p>
            {i.remediation ? (
              <p className="mt-1.5 text-2xs text-subtle">
                <span className="font-semibold text-muted">Remediation:</span> {i.remediation}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Columns({ analysis }: { analysis: Analysis }) {
  const s = analysis.schema;
  const roleOf = (name: string) =>
    s.primary_key.includes(name)
      ? 'primary key'
      : s.time_columns.includes(name)
        ? 'time'
        : s.measures.includes(name)
          ? 'measure'
          : s.identifiers.includes(name)
            ? 'identifier'
            : s.dimensions.includes(name)
              ? 'dimension'
              : DASH;

  return (
    <table className="w-full text-2xs">
      <thead className="sticky top-0 bg-elevated text-subtle">
        <tr className="[&>th]:px-4 [&>th]:py-2.5 [&>th]:text-left [&>th]:font-medium">
          <th>Column</th>
          <th>Type</th>
          <th>Role</th>
          <th className="!text-right">Missing</th>
          <th className="!text-right">Unique</th>
          <th>Sample</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {s.columns.map((c) => (
          <tr key={c.name} className="[&>td]:px-4 [&>td]:py-2.5 hover:bg-elevated/60">
            <td className="font-medium text-ink">{c.name}</td>
            <td className="text-muted">
              {c.semantic_type}
              <span className="ml-1 text-subtle">({c.dtype})</span>
            </td>
            <td>
              <Badge tone={roleOf(c.name) === 'measure' ? 'accent' : 'neutral'}>
                {roleOf(c.name)}
              </Badge>
            </td>
            <td className="text-right tabular text-muted">{formatPct(c.missing_pct, 2)}</td>
            <td className="text-right tabular text-muted">{formatInt(c.unique)}</td>
            <td className="max-w-[280px] truncate text-subtle">
              {c.sample_values.slice(0, 3).map(String).join(', ')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Missing({ analysis }: { analysis: Analysis }) {
  const rows = analysis.quality.missing_by_column.filter((m) => m.missing > 0);
  if (!rows.length)
    return <p className="p-8 text-center text-sm text-subtle">No missing values.</p>;
  const max = Math.max(...rows.map((r) => r.missing_pct), 0.0001);
  return (
    <ul className="divide-y divide-line">
      {rows.map((m) => (
        <li key={m.column} className="px-5 py-3">
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="font-medium">{m.column}</span>
            <span className="tabular text-muted">
              {formatInt(m.missing)} &middot; {formatPct(m.missing_pct, 2)}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-line/60">
            <div
              className="h-full rounded-full bg-warning"
              style={{ width: `${(m.missing_pct / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Outliers({ analysis }: { analysis: Analysis }) {
  const rows = analysis.quality.outliers;
  if (!rows.length)
    return <p className="p-8 text-center text-sm text-subtle">No outliers detected.</p>;
  return (
    <table className="w-full text-2xs">
      <thead className="sticky top-0 bg-elevated text-subtle">
        <tr className="[&>th]:px-4 [&>th]:py-2.5 [&>th]:text-left [&>th]:font-medium">
          <th>Column</th>
          <th className="!text-right">Count</th>
          <th className="!text-right">% rows</th>
          <th className="!text-right">% of total</th>
          <th className="!text-right">Fences</th>
          <th>Method</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((o) => (
          <tr key={o.column} className="[&>td]:px-4 [&>td]:py-2.5 hover:bg-elevated/60">
            <td className="font-medium text-ink">{o.column}</td>
            <td className="text-right tabular">{formatInt(o.count)}</td>
            <td className="text-right tabular text-muted">{formatPct(o.pct, 2)}</td>
            <td className="text-right tabular text-muted">
              {formatPct(o.share_of_column_total_pct, 1)}
            </td>
            <td className="text-right tabular text-subtle">
              {o.lower_fence.toFixed(1)} &hellip; {o.upper_fence.toFixed(1)}
            </td>
            <td className="text-subtle">{o.method}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Cardinality({ analysis }: { analysis: Analysis }) {
  const rows = analysis.quality.cardinality;
  return (
    <table className="w-full text-2xs">
      <thead className="sticky top-0 bg-elevated text-subtle">
        <tr className="[&>th]:px-4 [&>th]:py-2.5 [&>th]:text-left [&>th]:font-medium">
          <th>Column</th>
          <th>Semantic type</th>
          <th className="!text-right">Distinct</th>
          <th className="!text-right">% distinct</th>
          <th className="!text-right">HHI concentration</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((c) => (
          <tr key={c.column} className="[&>td]:px-4 [&>td]:py-2.5 hover:bg-elevated/60">
            <td className="font-medium text-ink">{c.column}</td>
            <td className="text-muted">{titleCase(c.semantic_type)}</td>
            <td className="text-right tabular">{formatInt(c.unique)}</td>
            <td className="text-right tabular text-muted">{formatPct(c.unique_pct, 2)}</td>
            <td className="text-right tabular text-subtle">
              {c.hhi === null ? DASH : c.hhi.toFixed(4)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
