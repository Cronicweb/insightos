'use client';

// InsightOS — Investigation Graph view (Phase 3, §16).
// Renders the investigation as a clickable node tree (lightweight in-repo SVG, no new deps).
// Click a node to select it; branch/compare/export are driven by the parent workspace.

import * as React from 'react';
import type { InvestigationGraph, InvestigationNode } from '@/lib/ai';
import { childrenOf } from '@/lib/ai';
import { cn } from '@/lib/utils';

function NodeRow({
  graph,
  node,
  depth,
  selectedId,
  onSelect,
  onBranch,
}: {
  graph: InvestigationGraph;
  node: InvestigationNode;
  depth: number;
  selectedId?: string;
  onSelect: (id: string) => void;
  onBranch: (id: string) => void;
}) {
  const kids = childrenOf(graph, node.id);
  const selected = node.id === selectedId;
  return (
    <div>
      <div className="flex items-center gap-2" style={{ paddingLeft: depth * 16 }}>
        {depth > 0 && <span aria-hidden className="text-muted">└</span>}
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          aria-current={selected}
          className={cn(
            'min-h-[44px] flex-1 rounded-lg border px-3 text-left text-sm focus:outline-none focus:ring-2 focus:ring-accent/50',
            selected ? 'border-accent bg-accent/10' : 'border-line hover:bg-elevated',
          )}
        >
          <span className="font-medium">{node.question}</span>
          <span
            className={cn(
              'ml-2 text-xs',
              node.status === 'answered' ? 'text-positive' : node.status === 'error' ? 'text-negative' : 'text-muted',
            )}
          >
            {node.status}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onBranch(node.id)}
          aria-label={`Branch from: ${node.question}`}
          className="min-h-[44px] rounded-lg border border-line px-2 text-xs focus:outline-none focus:ring-2 focus:ring-accent/50"
        >
          + Branch
        </button>
      </div>
      {kids.map((k) => (
        <NodeRow
          key={k.id}
          graph={graph}
          node={k}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
          onBranch={onBranch}
        />
      ))}
    </div>
  );
}

export function InvestigationGraphView({
  graph,
  selectedId,
  onSelect,
  onBranch,
  onExport,
}: {
  graph: InvestigationGraph;
  selectedId?: string;
  onSelect: (id: string) => void;
  onBranch: (id: string) => void;
  onExport: () => void;
}) {
  const root = graph.nodes[graph.rootId];
  return (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Investigation</h3>
        <button
          type="button"
          onClick={onExport}
          className="min-h-[44px] rounded-lg border border-line px-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-accent/50"
        >
          Export
        </button>
      </div>
      {root && (
        <NodeRow
          graph={graph}
          node={root}
          depth={0}
          selectedId={selectedId}
          onSelect={onSelect}
          onBranch={onBranch}
        />
      )}
    </div>
  );
}
