'use client';

// InsightOS — Insight Analyst workspace (Phase 3, §15–§16).
// Ties the Investigation Graph to grounded response cards. Investigation-first, NOT a chatbot.
// Flagged: renders a disabled notice unless AI is enabled in settings. No provider calls here yet
// beyond the resolved facade (safe NullProvider when disabled).

import * as React from 'react';
import {
  createGraph,
  addNode,
  exportGraph,
  loadAISettings,
  type InvestigationGraph,
} from '@/lib/ai';
import { InvestigationGraphView } from './investigation-graph-view';
import { InvestigationResponseCard } from './investigation-response-card';
import { Card, CardHeader, CardTitle, CardSubtitle, CardBody, Badge } from '@/components/ui/primitives';

export function InsightAnalystWorkspace({ analysisKey }: { analysisKey: string }) {
  const [enabled, setEnabled] = React.useState(false);
  const [graph, setGraph] = React.useState<InvestigationGraph | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | undefined>();

  React.useEffect(() => {
    setEnabled(loadAISettings().enabled);
    const g = createGraph(analysisKey, { question: 'What changed and why?', focus: { kind: 'report' } });
    setGraph(g);
    setSelectedId(g.rootId);
  }, [analysisKey]);

  const branch = React.useCallback(
    (parentId: string) => {
      setGraph((g) => {
        if (!g) return g;
        const { graph: ng, nodeId } = addNode(g, parentId, {
          question: 'Why?',
          focus: { kind: 'question', text: 'Why?' },
        });
        setSelectedId(nodeId);
        return ng;
      });
    },
    [],
  );

  const doExport = React.useCallback(() => {
    if (!graph) return;
    const blob = new Blob([exportGraph(graph)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `investigation-${graph.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [graph]);

  if (!enabled) {
    return (
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Insight Analyst</CardTitle>
            <CardSubtitle>An investigation workspace grounded in deterministic analytics.</CardSubtitle>
          </div>
          <Badge tone="neutral">AI disabled</Badge>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-muted">
            Enable AI in <a className="text-accent underline" href="./settings">AI Settings</a> and add an
            API key to start an investigation. The deterministic dashboard is fully available without AI.
          </p>
        </CardBody>
      </Card>
    );
  }

  if (!graph) return null;
  const selected = selectedId ? graph.nodes[selectedId] : undefined;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
      <InvestigationGraphView
        graph={graph}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onBranch={branch}
        onExport={doExport}
      />
      <div>
        {selected?.response ? (
          <InvestigationResponseCard question={selected.question} response={selected.response} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{selected?.question ?? 'Select a node'}</CardTitle>
              <Badge tone="warning">Pending</Badge>
            </CardHeader>
            <CardBody>
              <p className="text-sm text-muted">
                This node has no grounded answer yet. In a later step the analyst facade will build a
                grounded context from the deterministic analysis and populate Summary / Evidence /
                Confidence / SQL / Statistical Tests / Next Investigation / AI Trace.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
