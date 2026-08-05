'use client';

// InsightOS — Insight Analyst workspace (Phase 3, §15–§16).
// Ties the Investigation Graph to grounded response cards. Investigation-first, NOT a chatbot.
// Flagged: renders a disabled notice unless AI is enabled in settings.
//
// INTEGRATION (wiring only): this workspace now drives the EXISTING AnalystFacade (§18) to
// populate grounded answers. It creates NO new orchestration — it calls facade.startInvestigation,
// facade.branch, buildContext and facade.ask, all of which already exist in lib/ai. When AI is
// disabled the facade resolves a NullProvider, so nothing is sent and the deterministic dashboard
// is unaffected.

import * as React from 'react';
import {
  AnalystFacade,
  buildContext,
  loadAISettings,
  type ContextFocus,
  type InvestigationGraph,
  type InvestigationResponse,
} from '@/lib/ai';
import type { AnalysisLike } from '@/lib/ai/context';
import { InvestigationGraphView } from './investigation-graph-view';
import { InvestigationResponseCard } from './investigation-response-card';
import { Card, CardHeader, CardTitle, CardSubtitle, CardBody, Badge } from '@/components/ui/primitives';

export function InsightAnalystWorkspace({
  analysisKey,
  analysis,
  onOpenSettings,
}: {
  analysisKey: string;
  analysis?: AnalysisLike;
  onOpenSettings?: () => void;
}) {
  const [enabled, setEnabled] = React.useState(false);
  const [hasKey, setHasKey] = React.useState(false);
  const facadeRef = React.useRef<AnalystFacade | null>(null);
  const [graph, setGraph] = React.useState<InvestigationGraph | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | undefined>();
  const [pendingId, setPendingId] = React.useState<string | undefined>();
  const [question, setQuestion] = React.useState('What changed and why?');

  React.useEffect(() => {
    const s = loadAISettings();
    setEnabled(s.enabled);
    setHasKey(Boolean(s.apiKey));
    if (!s.enabled) return;
    const facade = new AnalystFacade(analysisKey);
    facadeRef.current = facade;
    const g = facade.startInvestigation({
      analysisKey,
      question: 'What changed and why?',
      focus: { kind: 'report' },
    });
    setGraph(g);
    setSelectedId(g.rootId);
  }, [analysisKey]);

  // Ask the EXISTING facade to ground a node. buildContext + facade.ask already exist; we only call them.
  const answer = React.useCallback(
    async (nodeId: string, q: string, focus: ContextFocus) => {
      const facade = facadeRef.current;
      if (!facade || !analysis) return;
      setPendingId(nodeId);
      try {
        const context = buildContext(analysis, focus);
        await facade.ask(nodeId, q, context);
        const g = facade.getGraph();
        if (g) setGraph({ ...g });
      } finally {
        setPendingId(undefined);
      }
    },
    [analysis],
  );

  const ask = React.useCallback(() => {
    const facade = facadeRef.current;
    const g = facade?.getGraph();
    if (!facade || !g || !selectedId) return;
    void answer(selectedId, g.nodes[selectedId]?.question ?? question, { kind: 'report' });
  }, [answer, selectedId, question]);

  const branch = React.useCallback(
    (parentId: string) => {
      const facade = facadeRef.current;
      if (!facade) return;
      const res = facade.branch(parentId, 'Why?', { kind: 'question', text: 'Why?' });
      setGraph({ ...res.graph });
      setSelectedId(res.nodeId);
      void answer(res.nodeId, 'Why?', { kind: 'question', text: 'Why?' });
    },
    [answer],
  );

  const doExport = React.useCallback(() => {
    const facade = facadeRef.current;
    if (!facade) return;
    const blob = new Blob([facade.exportInvestigation()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const g = facade.getGraph();
    a.download = `investigation-${g?.id ?? 'export'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

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
            Enable AI in{' '}
            {onOpenSettings ? (
              <button type="button" onClick={onOpenSettings} className="text-accent underline">
                AI Settings
              </button>
            ) : (
              <a className="text-accent underline" href="./settings">AI Settings</a>
            )}{' '}
            and add an API key to start an investigation. The deterministic dashboard is fully
            available without AI.
          </p>
        </CardBody>
      </Card>
    );
  }

  if (!graph) return null;
  const selected = selectedId ? graph.nodes[selectedId] : undefined;

  return (
    <div className="space-y-4">
      {!hasKey ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a provider API key</CardTitle>
            <Badge tone="warning">No key</Badge>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-muted">
              AI is enabled but no API key is set, so answers use the deterministic fallback. Add a
              key in{' '}
              {onOpenSettings ? (
                <button type="button" onClick={onOpenSettings} className="text-accent underline">
                  AI Settings
                </button>
              ) : (
                <a className="text-accent underline" href="./settings">AI Settings</a>
              )}
              .
            </p>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <InvestigationGraphView
          graph={graph}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onBranch={branch}
          onExport={doExport}
        />
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              aria-label="Ask a question about this analysis"
              placeholder="Ask about this analysis…"
              className="min-h-[44px] flex-1 rounded-xl border border-line bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
            <button
              type="button"
              onClick={ask}
              disabled={Boolean(pendingId)}
              className="min-h-[44px] rounded-xl bg-accent px-4 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-60"
            >
              {pendingId ? 'Asking…' : 'Ask'}
            </button>
          </div>

          {selected?.response ? (
            <InvestigationResponseCard
              question={selected.question}
              response={selected.response as InvestigationResponse}
              onNext={(q) => selectedId && answer(selectedId, q, { kind: 'question', text: q })}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{selected?.question ?? 'Select a node'}</CardTitle>
                <Badge tone="warning">{pendingId === selectedId ? 'Working…' : 'Pending'}</Badge>
              </CardHeader>
              <CardBody>
                <p className="text-sm text-muted">
                  Press <span className="font-medium">Ask</span> to have the analyst build a grounded
                  answer from the deterministic analysis (Summary / Evidence / Confidence / Next
                  Investigation / AI Trace). Every answer is validated against the engine output.
                </p>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
