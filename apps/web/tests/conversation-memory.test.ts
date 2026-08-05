import { describe, it, expect, beforeEach } from 'vitest';
import { getSession, recordTurn, contextDelta, clearSession } from '../lib/ai/memory';
import type { GroundedContext } from '../lib/ai/types';

const K = 'analysis-1';
const base: GroundedContext = {
  datasetLabel: 'sales',
  focus: { kind: 'report' },
  facts: [{ id: 'f1', label: 'Revenue', value: 100, sourcePath: 'scorecard.kpis[0]' }],
  provenance: ['scorecard.kpis[0]'],
  redactionNote: 'masked',
};

describe('conversation memory (§15.2)', () => {
  beforeEach(() => clearSession(K));

  it('records turns as references, not replayed prose', () => {
    recordTurn(K, { role: 'user', text: 'Why did revenue fall?', focus: { kind: 'report' }, ts: 1 });
    recordTurn(K, { role: 'analyst', text: 'Driven by East.', evidenceRefs: ['root_causes[0]'], ts: 2 });
    const s = getSession(K);
    expect(s.turns).toHaveLength(2);
    expect(s.turns[1].evidenceRefs).toContain('root_causes[0]');
  });

  it('contextDelta reuses prior refs + swaps focus without rebuilding facts', () => {
    recordTurn(K, { role: 'analyst', text: 'x', evidenceRefs: ['root_causes[0].children[1]'], ts: 3 });
    const delta = contextDelta(K, base, { kind: 'root_cause', index: 0 });
    expect(delta.facts).toBe(base.facts); // same fact objects reused
    expect(delta.focus).toEqual({ kind: 'root_cause', index: 0 });
    expect(delta.provenance).toContain('scorecard.kpis[0]');
    expect(delta.provenance).toContain('root_causes[0].children[1]');
  });
});
