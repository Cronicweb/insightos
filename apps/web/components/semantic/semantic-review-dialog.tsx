'use client';

// InsightOS — Semantic Review dialog (Phase 2, §14.4).
// Shown before analytics begin ONLY when a mapping's confidence is below threshold.
// Lets the user accept / edit / reject each low-confidence concept. Non-destructive:
// rejecting falls back to deterministic inference for that column.

import * as React from 'react';
import type { SemanticMappingProposal } from '@/lib/ai';
import { SEMANTIC_CONFIRM_THRESHOLD } from '@/lib/ai';
import { Card, CardHeader, CardTitle, CardSubtitle, CardBody, Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

const ROLES = ['measure', 'dimension', 'time', 'identifier'] as const;

export function SemanticReviewDialog({
  proposals,
  onConfirm,
  onCancel,
  threshold = SEMANTIC_CONFIRM_THRESHOLD,
}: {
  proposals: SemanticMappingProposal[];
  onConfirm: (resolved: SemanticMappingProposal[]) => void;
  onCancel: () => void;
  threshold?: number;
}) {
  const [items, setItems] = React.useState<SemanticMappingProposal[]>(proposals);
  const lowConf = items.filter((p) => p.confidence < threshold);

  const patch = (name: string, changes: Partial<SemanticMappingProposal>) =>
    setItems((prev) => prev.map((p) => (p.name === name ? { ...p, ...changes } : p)));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="semantic-review-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <Card className="max-h-[85vh] w-full max-w-2xl overflow-auto">
        <CardHeader>
          <div>
            <CardTitle id="semantic-review-title">Review semantic mappings</CardTitle>
            <CardSubtitle>
              For each Original Column below, review the Suggested Concept, its Role, and the
              Confidence score. Confirm, edit, or reject before analytics run. Rejecting falls back
              to deterministic inference.
            </CardSubtitle>
          </div>
          <Badge tone="warning">{lowConf.length} to review</Badge>
        </CardHeader>
        <CardBody className="space-y-3">
          {lowConf.map((p) => (
            <div key={p.name} className="rounded-xl border border-line p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
                    <div className="min-w-0">
                      <dt className="text-2xs uppercase tracking-wide text-muted/70">Original Column</dt>
                      <dd className="truncate text-sm font-semibold">{p.name}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-2xs uppercase tracking-wide text-muted/70">Suggested Concept</dt>
                      <dd className="truncate text-sm font-medium text-muted">
                        {p.conceptLabel ?? p.aliasOf ?? '—'}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-2xs uppercase tracking-wide text-muted/70">Confidence</dt>
                      <dd className="text-sm font-medium">{(p.confidence * 100).toFixed(0)}%</dd>
                    </div>
                  </dl>
                </div>
                <Badge tone={p.confirmed === false ? 'negative' : p.confirmed ? 'positive' : 'neutral'}>
                  {p.confirmed === false ? 'Rejected' : p.confirmed ? 'Accepted' : 'Pending'}
                </Badge>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="text-xs text-muted">
                  Suggested Concept
                  <input
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-line bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                    value={p.conceptLabel ?? ''}
                    onChange={(e) => patch(p.name, { conceptLabel: e.target.value })}
                  />
                </label>
                <label className="text-xs text-muted">
                  Role
                  <select
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-line bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                    value={p.roleHint ?? 'dimension'}
                    onChange={(e) => patch(p.name, { roleHint: e.target.value as SemanticMappingProposal['roleHint'] })}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => patch(p.name, { confirmed: true })}
                  className="min-h-[44px] flex-1 rounded-lg bg-accent px-3 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-accent/50"
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => patch(p.name, { confirmed: false })}
                  className="min-h-[44px] flex-1 rounded-lg border border-line px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-accent/50"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </CardBody>
        <div className="flex items-center justify-end gap-2 border-t border-line p-4">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[44px] rounded-xl border border-line px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-accent/50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(items)}
            className={cn(
              'min-h-[44px] rounded-xl bg-accent px-4 text-sm font-medium text-white',
              'focus:outline-none focus:ring-2 focus:ring-accent/50',
            )}
          >
            Confirm &amp; run analytics
          </button>
        </div>
      </Card>
    </div>
  );
}
