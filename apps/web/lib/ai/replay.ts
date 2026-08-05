// InsightOS — Decision Replay (§26). Serialize an investigation as a portable, concept-based
// analytical workflow and replay it against a NEW dataset, then compare old-vs-new.
// Contains NO raw data; concept refs (not physical column names) make it schema-portable.

import type { ContextFocus } from './types';
import type { InvestigationGraph, InvestigationNode } from './investigation/graph';
import type { SemanticModel } from './semantic/model';
import { resolveColumn } from './semantic/model';
import type { CompareResult } from './compare';

export interface ReplayStep {
  question: string;
  focus: ContextFocus;
  conceptRefs: string[];
  sql?: string;
  filters?: Array<{ concept: string; op: string; value: string }>;
}

export interface SerializedInvestigation {
  version: string;
  createdAt: number;
  seedQuestion: string;
  steps: ReplayStep[];
}

export interface ReplayResult {
  serialized: SerializedInvestigation;
  unmapped: string[]; // concepts absent in the new dataset's semantic model
  reboundSql: Array<{ question: string; sql?: string }>;
  comparison: CompareResult[];
}

/** Serialize a graph into a portable, concept-based workflow (§26). No raw data. */
export function serializeInvestigation(
  graph: InvestigationGraph,
  conceptsForNode: (n: InvestigationNode) => string[] = () => [],
): SerializedInvestigation {
  const ordered = Object.values(graph.nodes).sort((x, y) => x.createdAt - y.createdAt);
  const seed = graph.nodes[graph.rootId];
  return {
    version: 'replay-v1',
    createdAt: Date.now(),
    seedQuestion: seed?.question ?? '',
    steps: ordered.map((n) => ({
      question: n.question,
      focus: n.focus,
      conceptRefs: conceptsForNode(n),
      sql: n.response?.sql?.sql,
      filters: undefined,
    })),
  };
}

/**
 * Re-bind a step's concepts to the NEW dataset's semantic model. Concepts that do not resolve are
 * reported as unmapped (never silently guessed — §26).
 */
export function rebindStep(
  step: ReplayStep,
  newModel: SemanticModel,
): { sql?: string; unmapped: string[] } {
  const unmapped: string[] = [];
  let sql = step.sql;
  for (const concept of step.conceptRefs) {
    const col = resolveColumn(newModel, concept);
    if (!col) {
      unmapped.push(concept);
      continue;
    }
    if (sql) {
      // Replace {{concept}} placeholders with the resolved physical column.
      sql = sql.split(`{{${concept}}}`).join(col);
    }
  }
  return { sql, unmapped };
}

/**
 * Replay a serialized investigation against a new dataset's semantic model. Produces re-bound SQL
 * and the set of unmapped concepts. Actual execution + old/new comparison are performed by the
 * facade using the deterministic engine (this module stays pure/data-free).
 */
export function planReplay(
  serialized: SerializedInvestigation,
  newModel: SemanticModel,
): { reboundSql: Array<{ question: string; sql?: string }>; unmapped: string[] } {
  const unmapped = new Set<string>();
  const reboundSql = serialized.steps.map((step) => {
    const { sql, unmapped: u } = rebindStep(step, newModel);
    u.forEach((c) => unmapped.add(c));
    return { question: step.question, sql };
  });
  return { reboundSql, unmapped: Array.from(unmapped) };
}
