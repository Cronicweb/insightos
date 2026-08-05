import { describe, it, expect } from 'vitest';
import { planReplay, serializeInvestigation } from '../lib/ai/replay';
import { buildSemanticModel } from '../lib/ai/semantic/model';
import { createGraph, setResponse } from '../lib/ai/investigation/graph';
import type { SemanticMappingProposal } from '../lib/ai/types';

const proposals: SemanticMappingProposal[] = [
  { name: 'revenue_usd', conceptLabel: 'Revenue', roleHint: 'measure', confidence: 0.98, needsConfirmation: false, confirmed: true },
  { name: 'order_region', conceptLabel: 'Region', roleHint: 'dimension', confidence: 0.95, needsConfirmation: false, confirmed: true },
];

describe('decision replay (§26)', () => {
  it('rebinds concept placeholders to the NEW dataset columns', () => {
    const serialized = {
      version: 'replay-v1', createdAt: 0, seedQuestion: 'Why did revenue fall?',
      steps: [{
        question: 'By region?', focus: { kind: 'root_cause' as const, index: 0 },
        conceptRefs: ['Revenue', 'Region'],
        sql: 'SELECT {{Region}}, SUM({{Revenue}}) FROM t GROUP BY 1',
      }],
    };
    const newModel = buildSemanticModel('new', proposals);
    const { reboundSql, unmapped } = planReplay(serialized, newModel);
    expect(unmapped).toHaveLength(0);
    expect(reboundSql[0].sql).toContain('order_region');
    expect(reboundSql[0].sql).toContain('revenue_usd');
    expect(reboundSql[0].sql).not.toContain('{{');
  });

  it('reports unmapped concepts instead of guessing', () => {
    const serialized = {
      version: 'replay-v1', createdAt: 0, seedQuestion: 'q',
      steps: [{ question: 'q', focus: { kind: 'report' as const }, conceptRefs: ['Churn'], sql: 'SELECT {{Churn}}' }],
    };
    const newModel = buildSemanticModel('new', proposals);
    const { unmapped } = planReplay(serialized, newModel);
    expect(unmapped).toContain('Churn');
  });

  it('serializes a graph without raw data', () => {
    let g = createGraph('k', { question: 'Why?', focus: { kind: 'report' } });
    g = setResponse(g, g.rootId, {
      summary: 's', evidence: [], confidence: { level: 'high', basis: 'b' },
      supportingCharts: [], statisticalTests: [], nextInvestigation: [],
      sql: { sql: 'SELECT {{Revenue}}', notes: [] },
      trace: { provider: 'p', model: 'm', grounding: 'Strict', temperature: 0, promptVersion: 'v', reasoningSources: [], contextSources: [], analysisHash: '', timestamp: 0 },
    });
    const s = serializeInvestigation(g, () => ['Revenue']);
    expect(s.steps[0].sql).toContain('{{Revenue}}');
    expect(s.steps[0].conceptRefs).toContain('Revenue');
  });
});
