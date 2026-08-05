import { describe, it, expect } from 'vitest';
import {
  draftToProposals,
  requiresReview,
  buildSemanticModel,
  resolveColumn,
} from '../lib/ai/semantic/model';
import type { SemanticModelDraft } from '../lib/ai/types';

const draft: SemanticModelDraft = {
  domainHint: 'retail',
  columns: [
    { name: 'rev', conceptLabel: 'Revenue', roleHint: 'measure', confidence: 0.96 },
    { name: 'dt', conceptLabel: 'Date', roleHint: 'time', confidence: 0.9 },
    { name: 'x1', conceptLabel: 'Amount', roleHint: 'measure', confidence: 0.41 },
  ],
};

describe('semantic model (§14)', () => {
  it('flags only low-confidence mappings for review', () => {
    const proposals = draftToProposals(draft, 0.7);
    expect(proposals.find((p) => p.name === 'rev')!.needsConfirmation).toBe(false);
    expect(proposals.find((p) => p.name === 'x1')!.needsConfirmation).toBe(true);
    expect(requiresReview(proposals, 0.7)).toBe(true);
  });

  it('omits rejected/unconfirmed low-confidence mappings (deterministic fallback)', () => {
    const proposals = draftToProposals(draft, 0.7).map((p) =>
      p.name === 'x1' ? { ...p, confirmed: false } : p,
    );
    const model = buildSemanticModel('k1', proposals, { domainHint: 'retail' });
    expect(model.concepts.some((c) => c.column === 'x1')).toBe(false);
    // preserves ORIGINAL column names, never renames
    expect(resolveColumn(model, 'Revenue')).toBe('rev');
    expect(resolveColumn(model, 'Date')).toBe('dt');
  });

  it('includes an edited+accepted low-confidence mapping', () => {
    const proposals = draftToProposals(draft, 0.7).map((p) =>
      p.name === 'x1' ? { ...p, conceptLabel: 'Discount', confirmed: true } : p,
    );
    const model = buildSemanticModel('k1', proposals);
    expect(resolveColumn(model, 'Discount')).toBe('x1');
  });
});
