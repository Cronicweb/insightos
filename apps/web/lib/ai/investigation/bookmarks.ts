// InsightOS — Investigation bookmarks (§20). Mark nodes as first-class history highlights.

import type { InvestigationGraph, InvestigationNode } from './graph';

export function setBookmark(
  graph: InvestigationGraph,
  nodeId: string,
  on: boolean,
): InvestigationGraph {
  const node = graph.nodes[nodeId];
  if (!node) throw new Error(`Unknown node: ${nodeId}`);
  return {
    ...graph,
    nodes: { ...graph.nodes, [nodeId]: { ...node, bookmarked: on } },
  };
}

export function listBookmarks(graph: InvestigationGraph): InvestigationNode[] {
  return Object.values(graph.nodes).filter((n) => n.bookmarked);
}
