import { describe, it, expect } from 'vitest';
import { generateObservations, generateSuggestions, generateTemplates, type DeterministicSummary } from '../lib/ai/assistant';

const summary: DeterministicSummary = {
  kpis: [
    { id: 'revenue', label: 'Revenue', deltaPct: -18, direction: 'down', sourcePath: 'kpis[0]' },
    { id: 'retention', label: 'Retention', deltaPct: 4, direction: 'up', sourcePath: 'kpis[1]' },
  ],
  anomalies: [{ id: 'a1', label: 'Region East', sourcePath: 'anomalies[0]' }],
  recommendations: [{ id: 'r1', label: 'Rebalance marketing spend', confidence: 0.82, sourcePath: 'recos[0]' }],
  qualityIssues: [{ id: 'q1', label: '3% nulls in region', sourcePath: 'quality[0]' }],
  dimensions: ['Region', 'Segment'],
};

describe('Investigation Assistant (§29)', () => {
  it('observations come only from deterministic artifacts with provenance', () => {
    const obs = generateObservations(summary);
    const rev = obs.find((o) => o.title.includes('Revenue'));
    expect(rev?.title).toContain('18%');
    expect(rev?.sourcePath).toBe('kpis[0]');
    // 4% retention is below the 5% threshold, so it is NOT auto-surfaced as an observation.
    expect(obs.find((o) => o.title.includes('Retention'))).toBeUndefined();
    // High-confidence recommendation surfaces.
    expect(obs.find((o) => o.title.includes('marketing'))).toBeDefined();
    obs.forEach((o) => expect(o.sourcePath).toBeTruthy());
  });

  it('suggestions seed focused nodes and reference the top KPI', () => {
    const s = generateSuggestions(summary);
    expect(s.find((x) => x.title.includes('Why did Revenue change'))).toBeDefined();
    expect(s.find((x) => x.title === 'Find hidden anomalies')).toBeDefined();
    expect(s.find((x) => x.title.includes('Compare Region vs Segment'))).toBeDefined();
    expect(s.find((x) => x.title === 'Show confidence')).toBeDefined();
  });

  it('templates build multi-node graphs and only include grounded ones', () => {
    const t = generateTemplates(summary);
    const ids = t.map((x) => x.id);
    expect(ids).toContain('tpl-revenue');   // has KPIs
    expect(ids).toContain('tpl-quality');   // has quality issues
    expect(ids).toContain('tpl-regional');  // has dimensions
    expect(ids).toContain('tpl-actions');   // has recommendations
    t.forEach((tpl) => expect(tpl.steps.length).toBeGreaterThan(0));
  });

  it('omits quality/regional/action templates when their grounding is absent', () => {
    const bare: DeterministicSummary = { kpis: [{ id: 'k', label: 'X', deltaPct: 10, sourcePath: 'kpis[0]' }] };
    const ids = generateTemplates(bare).map((x) => x.id);
    expect(ids).toContain('tpl-revenue');
    expect(ids).not.toContain('tpl-quality');
    expect(ids).not.toContain('tpl-regional');
    expect(ids).not.toContain('tpl-actions');
  });
});
