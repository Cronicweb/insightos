// InsightOS — Investigation Graph (Phase 3, §16).
// Non-chat investigation as a graph of grounded question nodes. Pure model + operations;
// session-scoped, references deterministic artifacts, never stores raw data.

import type { ContextFocus, GroundedFact, AITrace } from '../types';

export interface AITraceExtended extends AITrace {
  contextSources: string[];
  semanticVersion?: string;
  analysisHash: string;
  timestamp: number;
}

export interface InvestigationResponse {
  summary: string;
  evidence: GroundedFact[];
  confidence: { level: 'high' | 'medium' | 'low'; basis: string };
  supportingCharts: string[]; // existing ChartSpec ids only
  sql?: { sql: string; notes: string[] };
  statisticalTests: string[];
  nextInvestigation: string[];
  trace: AITraceExtended;
}

export interface InvestigationNode {
  id: string;
  parentId?: string;
  question: string;
  focus: ContextFocus;
  response?: InvestigationResponse;
  createdAt: number;
  status: 'pending' | 'answered' | 'error';
}

export interface InvestigationGraph {
  id: string;
  analysisKey: string;
  semanticVersion?: string;
  rootId: string;
  nodes: Record<string, InvestigationNode>;
  createdAt: number;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Create a graph seeded with a root node (typically the dataset or a KPI movement). */
export function createGraph(
  analysisKey: string,
  root: { question: string; focus: ContextFocus },
  semanticVersion?: string,
): InvestigationGraph {
  const rootId = uid('node');
  const rootNode: InvestigationNode = {
    id: rootId,
    question: root.question,
    focus: root.focus,
    createdAt: Date.now(),
    status: 'pending',
  };
  return {
    id: uid('graph'),
    analysisKey,
    semanticVersion,
    rootId,
    nodes: { [rootId]: rootNode },
    createdAt: Date.now(),
  };
}

/** Add a child (branch) under a parent node. Multiple children per node are allowed. */
export function addNode(
  graph: InvestigationGraph,
  parentId: string,
  node: { question: string; focus: ContextFocus },
): { graph: InvestigationGraph; nodeId: string } {
  if (!graph.nodes[parentId]) throw new Error(`Unknown parent node: ${parentId}`);
  const id = uid('node');
  const child: InvestigationNode = {
    id,
    parentId,
    question: node.question,
    focus: node.focus,
    createdAt: Date.now(),
    status: 'pending',
  };
  return { graph: { ...graph, nodes: { ...graph.nodes, [id]: child } }, nodeId: id };
}

/** Attach a grounded response to a node (immutably). */
export function setResponse(
  graph: InvestigationGraph,
  nodeId: string,
  response: InvestigationResponse,
): InvestigationGraph {
  const node = graph.nodes[nodeId];
  if (!node) throw new Error(`Unknown node: ${nodeId}`);
  return {
    ...graph,
    nodes: { ...graph.nodes, [nodeId]: { ...node, response, status: 'answered' } },
  };
}

/** Path from root to a node (for breadcrumb / jump-back). */
export function pathToNode(graph: InvestigationGraph, nodeId: string): InvestigationNode[] {
  const path: InvestigationNode[] = [];
  let cur: InvestigationNode | undefined = graph.nodes[nodeId];
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = cur.parentId ? graph.nodes[cur.parentId] : undefined;
  }
  return path;
}

/** Direct children of a node (branches). */
export function childrenOf(graph: InvestigationGraph, nodeId: string): InvestigationNode[] {
  return Object.values(graph.nodes).filter((n) => n.parentId === nodeId);
}

/** Serialize the graph for export — questions, sourcePaths, SQL, traces. NEVER raw data (§16.2). */
export function exportGraph(graph: InvestigationGraph): string {
  const safe = {
    id: graph.id,
    analysisKey: graph.analysisKey,
    semanticVersion: graph.semanticVersion,
    createdAt: graph.createdAt,
    nodes: Object.values(graph.nodes).map((n) => ({
      id: n.id,
      parentId: n.parentId,
      question: n.question,
      focus: n.focus,
      status: n.status,
      summary: n.response?.summary,
      evidenceRefs: n.response?.evidence.map((e) => e.sourcePath),
      sql: n.response?.sql?.sql,
      statisticalTests: n.response?.statisticalTests,
      trace: n.response?.trace,
    })),
  };
  return JSON.stringify(safe, null, 2);
}

/** Compare two nodes side-by-side (evidence + trace) for the Compare interaction (§16.2). */
export function compareNodes(
  graph: InvestigationGraph,
  aId: string,
  bId: string,
): { a: InvestigationNode; b: InvestigationNode } {
  const a = graph.nodes[aId];
  const b = graph.nodes[bId];
  if (!a || !b) throw new Error('Both nodes must exist to compare.');
  return { a, b };
}
