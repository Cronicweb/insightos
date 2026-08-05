import { describe, it, expect } from 'vitest';
import {
  createGraph,
  addNode,
  setResponse,
  pathToNode,
  childrenOf,
  exportGraph,
} from '../lib/ai/investigation/graph';
import type { InvestigationResponse } from '../lib/ai/investigation/graph';

const resp: InvestigationResponse = {
  summary: 'Revenue fell 12% driven by East region.',
  evidence: [{ id: 'e1', label: 'East contribution', value: '68%', sourcePath: 'root_causes[0].root.children[0]' }],
  confidence: { level: 'high', basis: 'BH-corrected significant driver' },
  supportingCharts: ['chart_region_waterfall'],
  sql: { sql: 'SELECT region, SUM(rev) FROM t GROUP BY 1', notes: [] },
  statisticalTests: ['Welch t-test', 'BH-FDR'],
  nextInvestigation: ['Why did East fall?'],
  trace: {
    provider: 'Groq',
    model: 'qwen-3-32b',
    grounding: 'Strict',
    temperature: 0.2,
    promptVersion: 'v1',
    reasoningSources: ['Root Cause Analysis', 'Statistical Tests', 'SQL Query'],
    contextSources: ['root_causes[0]'],
    analysisHash: 'abc123',
    timestamp: 1_700_000_000_000,
  },
};

describe('investigation graph (§16)', () => {
  it('creates a root and branches children', () => {
    let g = createGraph('k1', { question: 'Why did revenue fall?', focus: { kind: 'report' } }, 'sem-1');
    const { graph, nodeId } = addNode(g, g.rootId, { question: 'Why East?', focus: { kind: 'root_cause', index: 0 } });
    g = graph;
    expect(childrenOf(g, g.rootId).map((n) => n.id)).toContain(nodeId);
    expect(pathToNode(g, nodeId).length).toBe(2);
  });

  it('attaches grounded responses and exports without raw data', () => {
    let g = createGraph('k1', { question: 'Why?', focus: { kind: 'report' } });
    g = setResponse(g, g.rootId, resp);
    expect(g.nodes[g.rootId].status).toBe('answered');
    const json = exportGraph(g);
    expect(json).toContain('root_causes[0].root.children[0]'); // evidence ref
    expect(json).toContain('Welch t-test');
    expect(json).not.toContain('SELECT *'); // no raw dump; only the generated SQL string is included
  });
});
