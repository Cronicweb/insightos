import { describe, it, expect } from 'vitest';
import { validateResponse, deterministicFallback } from '../lib/ai/validation';
import type { GroundedContext, InvestigationResponse } from '../lib/ai/types';

const ctx: GroundedContext = {
  datasetLabel: 'sales',
  focus: { kind: 'root_cause', index: 0 },
  facts: [
    { id: 'f1', label: 'Revenue', value: '1200', sourcePath: 'kpis[0]' },
    { id: 'f2', label: 'East share', value: '68%', sourcePath: 'root_causes[0].children[0]' },
  ],
  provenance: ['kpis[0]', 'root_causes[0].children[0]'],
  redactionNote: 'masked',
};

function resp(over: Partial<InvestigationResponse> = {}): InvestigationResponse {
  return {
    summary: 'Revenue 1200 fell, East share 68%.',
    evidence: [{ id: 'f1', label: 'Revenue', value: '1200', sourcePath: 'kpis[0]' }],
    confidence: { level: 'high', basis: 'ok' },
    supportingCharts: [],
    statisticalTests: [],
    nextInvestigation: [],
    trace: {
      provider: 'Groq', model: 'qwen-3-32b', grounding: 'Strict', temperature: 0.2,
      promptVersion: 'analyst-v1', reasoningSources: [], contextSources: ['kpis[0]'],
      analysisHash: 'x', timestamp: 0,
    },
    ...over,
  };
}

describe('response validation (§22)', () => {
  it('passes a grounded response', () => {
    expect(validateResponse(resp(), ctx, { strict: true }).ok).toBe(true);
  });

  it('rejects unavailable evidence refs', () => {
    const r = resp({ evidence: [{ id: 'z', label: 'X', value: '1', sourcePath: 'not_in_ctx[9]' }] });
    const v = validateResponse(r, ctx);
    expect(v.ok).toBe(false);
    expect(v.violations.join()).toContain('not_in_ctx[9]');
  });

  it('rejects ungrounded numbers in strict mode', () => {
    const r = resp({ summary: 'Revenue jumped to 9999.' });
    expect(validateResponse(r, ctx, { strict: true }).ok).toBe(false);
  });

  it('rejects invented confidence values', () => {
    const r = resp({ confidence: { level: 'certain' as unknown as 'high', basis: 'x' } });
    expect(validateResponse(r, ctx).ok).toBe(false);
  });

  it('deterministicFallback is always valid', () => {
    const fb = deterministicFallback('Why?', ctx);
    expect(validateResponse(fb, ctx, { strict: true }).ok).toBe(true);
    expect(fb.trace.grounding).toBe('Fallback');
  });
});
