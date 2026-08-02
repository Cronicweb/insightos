'use client';

import * as React from 'react';
import { EyeOff, ShieldCheck, Clock, FileCheck2 } from 'lucide-react';
import type { GovernanceReport, PrivacyReport } from '@/lib/types';
import { fixed, titleCase } from '@/lib/format';
import { Badge, SectionLabel } from '../ui/primitives';
import { cn } from '@/lib/utils';

/**
 * Decision readiness, expressed the way a data governance forum would express
 * it. The point of this panel is that a number is not trustworthy just because
 * it rendered: it is trustworthy when its source, freshness, owner and quality
 * are all stated, and when the platform is honest about the ceiling those place
 * on any conclusion drawn from it.
 */
const READINESS: Record<string, { label: string; tone: Tone; blurb: string }> = {
  executive_ready: {
    label: 'Executive ready',
    tone: 'positive',
    blurb: 'Safe to quote in a board pack without further qualification.',
  },
  operational: {
    label: 'Operational',
    tone: 'accent',
    blurb: 'Good enough to run the business day to day; qualify before escalating.',
  },
  exploratory: {
    label: 'Exploratory',
    tone: 'warning',
    blurb: 'Directionally useful only. Do not commit budget on this alone.',
  },
  blocked: {
    label: 'Blocked',
    tone: 'negative',
    blurb: 'Quality or freshness failures make conclusions unsafe.',
  },
};

type Tone = 'positive' | 'accent' | 'warning' | 'negative' | 'neutral';

const TONE_STYLE: Record<Tone, string> = {
  positive: 'border-positive/40 bg-positive/10 text-positive',
  accent: 'border-accent/40 bg-accent/10 text-accent',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  negative: 'border-negative/40 bg-negative/10 text-negative',
  neutral: 'border-line bg-elevated text-muted',
};

export function GovernancePanel({
  governance,
  privacy,
}: {
  governance?: GovernanceReport;
  privacy?: PrivacyReport;
}) {
  if (!governance && !privacy) return null;

  return (
    <div className="space-y-4">
      {governance ? <GovernanceCard governance={governance} /> : null}
      {privacy ? <PrivacyCard privacy={privacy} /> : null}
    </div>
  );
}

function GovernanceCard({ governance: g }: { governance: GovernanceReport }) {
  const readiness = READINESS[g.decisionReadiness] ?? {
    label: titleCase(g.decisionReadiness),
    tone: 'neutral' as Tone,
    blurb: '',
  };
  const freshTone: Tone =
    g.freshness.status === 'fresh'
      ? 'positive'
      : g.freshness.status === 'stale'
        ? 'negative'
        : 'warning';

  return (
    <section
      aria-labelledby="governance-heading"
      className="rounded-2xl border border-line bg-surface p-5 shadow-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <FileCheck2 className="h-4 w-4 text-accent" aria-hidden />
        <SectionLabel>
          <span id="governance-heading">Data governance</span>
        </SectionLabel>
        <span
          className={cn(
            'ml-auto rounded-md border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide',
            TONE_STYLE[readiness.tone],
          )}
        >
          {readiness.label}
        </span>
      </div>

      {readiness.blurb ? (
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{readiness.blurb}</p>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-2xs sm:grid-cols-3 lg:grid-cols-6">
        <Item label="Source" value={g.source} hint={titleCase(g.sourceType)} />
        <Item label="Owner" value={g.owner} hint={g.steward ? `Steward ${g.steward}` : undefined} />
        <Item
          label="Freshness"
          value={titleCase(g.freshness.status)}
          hint={g.freshness.asOf ? `as of ${g.freshness.asOf}` : undefined}
          tone={freshTone}
        />
        <Item label="Quality" value={`${fixed(g.qualityScore, 1)} (${g.qualityGrade})`} />
        <Item label="Trust level" value={titleCase(g.trustLevel)} />
        <Item label="Classification" value={titleCase(g.classification)} hint={g.retention} />
      </dl>

      {g.freshness.detail ? (
        <p className="mt-3 flex items-start gap-1.5 text-2xs leading-relaxed text-subtle">
          <Clock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          {g.freshness.detail}
        </p>
      ) : null}

      {g.readinessReasons?.length ? (
        <div className="mt-3 border-t border-line pt-3">
          <h4 className="text-2xs font-semibold uppercase tracking-[0.08em] text-subtle">
            Why this readiness level
          </h4>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {g.readinessReasons.map((r) => (
              <li key={r}>
                <Badge tone="neutral">{r}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {g.checks?.length ? (
        <div className="mt-3 border-t border-line pt-3">
          <h4 className="text-2xs font-semibold uppercase tracking-[0.08em] text-subtle">
            Governance checks
          </h4>
          <ul className="mt-2 divide-y divide-line">
            {g.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-3 py-1.5 text-2xs">
                <span
                  className={cn(
                    'mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase',
                    c.status === 'passed'
                      ? TONE_STYLE.positive
                      : c.status === 'failed'
                        ? TONE_STYLE.negative
                        : TONE_STYLE.warning,
                  )}
                >
                  {c.status}
                </span>
                <span className="min-w-0">
                  <span className="font-medium text-ink">{c.name}</span>
                  <span className="text-subtle"> {'\u2014'} {c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 border-t border-line pt-3 text-2xs leading-relaxed text-subtle">
        Recommendation confidence is capped at {fixed(g.confidenceCap * 100, 0)}% while the dataset
        sits at this readiness level. Improving quality or freshness raises the ceiling.
      </p>
    </section>
  );
}

function PrivacyCard({ privacy }: { privacy: PrivacyReport }) {
  const masked = privacy.masked_columns ?? [];
  return (
    <section
      aria-labelledby="privacy-heading"
      className="rounded-2xl border border-line bg-surface p-5 shadow-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-accent" aria-hidden />
        <SectionLabel>
          <span id="privacy-heading">Sensitive fields detected</span>
        </SectionLabel>
        <span
          className={cn(
            'ml-auto rounded-md border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide',
            TONE_STYLE.positive,
          )}
        >
          Masked automatically
        </span>
      </div>

      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        {privacy.notice ??
          privacy.summary ??
          'Columns that identify a person or an account are masked before any chart is built, and are excluded from breakdowns. Output stays aggregate unless drill-down is explicitly permitted.'}
      </p>

      {privacy.fields?.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-2xs">
            <caption className="sr-only">Sensitive columns detected and the policy applied</caption>
            <thead>
              <tr className="border-b border-line text-left text-subtle">
                <th scope="col" className="py-1.5 pr-3 font-medium">Column</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Category</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Policy</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Masked as</th>
                <th scope="col" className="py-1.5 text-right font-medium">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {privacy.fields.map((f) => (
                <tr key={f.column}>
                  <th scope="row" className="py-1.5 pr-3 text-left font-medium text-ink">
                    {f.column}
                  </th>
                  <td className="py-1.5 pr-3 text-muted">{titleCase(f.category)}</td>
                  <td className="py-1.5 pr-3 text-muted">{(f.policy ?? f.strategy ?? 'masked').replace(/_/g, ' ')}</td>
                  <td className="py-1.5 pr-3 font-mono text-subtle">{f.example_masked ?? f.sample_masked ?? '\u2014'}</td>
                  <td className="py-1.5 text-right tabular text-muted">
                    {fixed(f.confidence * 100, 0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-2xs text-subtle">No sensitive columns were detected.</p>
      )}

      {masked.length ? (
        <p className="mt-3 flex items-start gap-1.5 border-t border-line pt-3 text-2xs leading-relaxed text-subtle">
          <EyeOff className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          {masked.length} column{masked.length === 1 ? '' : 's'} withheld from charts and
          root-cause breakdowns: {masked.join(', ')}.
        </p>
      ) : null}
    </section>
  );
}

function Item({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <div>
      <dt className="text-subtle">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 font-medium leading-snug text-ink',
          tone === 'negative' && 'text-negative',
          tone === 'warning' && 'text-warning',
          tone === 'positive' && 'text-positive',
        )}
      >
        {value}
      </dd>
      {hint ? <dd className="text-[10px] leading-snug text-subtle">{hint}</dd> : null}
    </div>
  );
}
