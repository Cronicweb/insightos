'use client';

import * as React from 'react';
import { ShieldCheck, GitBranch, XCircle, ScrollText } from 'lucide-react';
import type { Evidence, Recommendation, RejectedAlternative } from '@/lib/types';
import { fixed, formatPValue } from '@/lib/format';
import { Badge } from '../ui/primitives';

/**
 * The explainability surface for a single recommendation.
 *
 * A recommendation is only useful to an executive if they can interrogate it,
 * so this renders the whole chain: the evidence rows and the tests that
 * produced them, how confident the engine is and why that confidence was
 * capped, which rules fired, what was considered and discarded, who should own
 * the work, whether it needs sign-off, and the timestamped audit trail.
 *
 * Nothing here is generated text. Every value is read straight off the
 * deterministic engine output.
 */
export function ExplainabilityPanel({ rec }: { rec: Recommendation }) {
  const tests = rec.statistical_tests?.length
    ? rec.statistical_tests
    : dedupe(rec.evidence.map((e) => e.method).filter(Boolean) as string[]);
  const rules = rec.rules_fired?.length ? rec.rules_fired : [rec.triggered_by];
  const rejected = normaliseRejected(rec.rejected_alternatives);
  const capped =
    rec.confidence_before_cap != null &&
    rec.confidence_cap != null &&
    rec.confidence_before_cap > rec.confidence;

  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-muted">{rec.rationale}</p>

      <div className="flex flex-wrap gap-2">
        <Badge tone="neutral">confidence {fixed(rec.confidence * 100, 0)}%</Badge>
        {rec.significance != null ? (
          <Badge tone="neutral">significance {formatPValue(rec.significance)}</Badge>
        ) : null}
        <Badge tone="neutral">
          {rec.evidence_count ?? rec.evidence.length} evidence{' '}
          {(rec.evidence_count ?? rec.evidence.length) === 1 ? 'row' : 'rows'}
        </Badge>
        {rec.metric ? <Badge tone="neutral">metric: {rec.metric}</Badge> : null}
        {rec.dimension ? (
          <Badge tone="neutral">
            {rec.dimension}
            {rec.segment ? ` = ${rec.segment}` : ''}
          </Badge>
        ) : null}
      </div>

      {capped ? (
        <p className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-2xs leading-relaxed text-muted">
          <span className="font-semibold text-ink">Confidence capped.</span> The rule engine
          scored this {fixed((rec.confidence_before_cap as number) * 100, 0)}%, reduced to{' '}
          {fixed(rec.confidence * 100, 0)}% by the data governance ceiling of{' '}
          {fixed((rec.confidence_cap as number) * 100, 0)}%.
          {rec.data_quality_impact ? ` ${rec.data_quality_impact}` : ''}
        </p>
      ) : null}

      <Block icon={<ShieldCheck className="h-3.5 w-3.5" />} title="Evidence">
        <EvidenceTable evidence={rec.evidence} />
      </Block>

      {tests.length ? (
        <Block icon={<GitBranch className="h-3.5 w-3.5" />} title="Statistical tests">
          <ul className="flex flex-wrap gap-1.5">
            {tests.map((t) => (
              <li key={t}>
                <Badge tone="neutral">{t}</Badge>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      <Block icon={<GitBranch className="h-3.5 w-3.5" />} title="Rules fired">
        <ul className="flex flex-wrap gap-1.5">
          {rules.map((r) => (
            <li key={r}>
              <Badge tone="neutral">{r}</Badge>
            </li>
          ))}
        </ul>
      </Block>

      <Block icon={<XCircle className="h-3.5 w-3.5" />} title="Rejected alternatives">
        {rejected.length ? (
          <ul className="space-y-1.5">
            {rejected.map((r, i) => (
              <li key={r.id ?? i} className="text-2xs leading-relaxed text-muted">
                <span className="font-medium text-ink">{r.title ?? r.rule ?? 'Candidate'}</span>
                {' \u2014 '}
                {r.reason}
                {r.detail ? ` ${r.detail}` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-2xs text-subtle">
            No competing explanation cleared the significance threshold for this metric.
          </p>
        )}
      </Block>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-3 text-2xs sm:grid-cols-4">
        <Field label="Suggested owner" value={rec.suggested_owner || rec.owner_hint || '\u2014'} />
        <Field
          label="Approval"
          value={
            rec.approval_required
              ? `Required \u00b7 ${rec.approval_authority || 'escalate'}`
              : 'Not required'
          }
        />
        <Field label="Review cadence" value={rec.review_cadence || '\u2014'} />
        <Field label="Success measure" value={rec.success_measure || '\u2014'} />
      </div>

      {rec.audit_trail?.length ? (
        <Block icon={<ScrollText className="h-3.5 w-3.5" />} title="Audit trail">
          <ol className="space-y-1 border-l border-line pl-3">
            {rec.audit_trail.map((entry, i) => (
              <li key={i} className="text-2xs leading-relaxed text-subtle">
                {entry}
              </li>
            ))}
          </ol>
        </Block>
      ) : null}

      {rec.impact_basis ? (
        <p className="text-2xs leading-relaxed text-subtle">
          <span className="font-semibold text-muted">Impact basis:</span> {rec.impact_basis}
        </p>
      ) : null}
    </div>
  );
}

function EvidenceTable({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) {
    return <p className="text-2xs text-subtle">No evidence rows attached.</p>;
  }
  return (
    <table className="w-full text-2xs">
      <caption className="sr-only">Evidence supporting this recommendation</caption>
      <tbody className="divide-y divide-line">
        {evidence.map((e, i) => (
          <tr key={i}>
            <th scope="row" className="py-1.5 pr-3 text-left font-normal text-muted">
              {e.label}
            </th>
            <td className="py-1.5 pr-3 text-right font-medium tabular">
              {typeof e.value === 'number' ? e.value.toLocaleString() : (e.value ?? '\u2014')}
            </td>
            <td className="py-1.5 text-right text-subtle">
              {e.comparison ? `${e.comparison} \u00b7 ` : ''}
              {e.method ?? ''}
              {e.p_value != null ? ` \u00b7 ${formatPValue(e.p_value)}` : ''}
              {e.effect_size != null ? ` \u00b7 d=${fixed(e.effect_size, 2)}` : ''}
              {e.sample_size != null ? ` \u00b7 n=${e.sample_size.toLocaleString()}` : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Block({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h5 className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-subtle">
        <span className="text-accent">{icon}</span>
        {title}
      </h5>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-subtle">{label}</div>
      <div className="mt-0.5 font-medium leading-snug text-ink">{value}</div>
    </div>
  );
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

/**
 * The Python engine emits rejected alternatives as objects; older payloads and
 * the browser engine emit plain strings. Normalising here is what stops a
 * string-vs-object mismatch rendering as "[object Object]".
 */
function normaliseRejected(
  input: Recommendation['rejected_alternatives'],
): RejectedAlternative[] {
  if (!input) return [];
  return input.map((item) =>
    typeof item === 'string' ? { reason: item } : item,
  );
}
