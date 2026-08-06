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
//
// READINESS GUARD: the Ask action is enabled ONLY when the provider is fully configured and
// validated — AI enabled, API key present, a successful provider validation, a model selected,
// and that model present in the live provider list. Otherwise Ask is disabled with a clear reason,
// so a question can never fall through to a confusing "Provider = local-policy / No AI Call" state.
import * as React from 'react';
import {
  AnalystFacade,
  buildContext,
  contextDelta,
  loadAISettings,
  type ContextFocus,
  type InvestigationGraph,
  type InvestigationResponse,
} from '@/lib/ai';
import type { AnalysisLike } from '@/lib/ai/context';
import { testGroqConnection } from '@/lib/ai/providers/groq';
import { InvestigationGraphView } from './investigation-graph-view';
import { InvestigationResponseCard } from './investigation-response-card';
import { Card, CardHeader, CardTitle, CardSubtitle, CardBody, Badge } from '@/components/ui/primitives';

/**
 * Pure question selector for the Ask action (extracted so it can be unit-tested without a DOM).
 *
 * REGRESSION GUARD: the user's typed question ALWAYS wins. The selected node's stored title is
 * used only as a fallback when the input is empty. This is the exact decision point of the
 * original bug (where the node title was sent to the provider instead of the typed question).
 * Never overwrite typed input with the node title.
 */
export function resolveAskQuestion(typedQuestion: string, nodeTitle?: string): string {
  const typed = typedQuestion.trim();
  if (typed.length > 0) return typed;
  return nodeTitle ?? typedQuestion;
}

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
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Provider readiness (browser-only validation; no dataset content is ever sent here).
  // 'unknown' until we validate; then either 'ready' or a specific not-ready reason.
  const [readiness, setReadiness] = React.useState<
    | { state: 'unknown' }
    | { state: 'ready' }
    | { state: 'not_ready'; reason: string }
  >({ state: 'unknown' });
  const [validating, setValidating] = React.useState(false);

  // Validate the saved provider settings against the provider (key + model existence).
  // Reuses the existing testGroqConnection flow; sends NO dataset content.
  const validate = React.useCallback(async () => {
    const s = loadAISettings();
    if (!s.enabled) {
      setReadiness({ state: 'not_ready', reason: 'AI is disabled. Enable AI in AI Settings first.' });
      return;
    }
    if (!s.apiKey) {
      setReadiness({ state: 'not_ready', reason: 'No API key. Add your provider API key in AI Settings.' });
      return;
    }
    if (!s.model) {
      setReadiness({ state: 'not_ready', reason: 'No model selected. Choose a model in AI Settings.' });
      return;
    }
    setValidating(true);
    try {
      const result = await testGroqConnection(s);
      if (result.state === 'connected') {
        setReadiness({ state: 'ready' });
      } else if (result.state === 'invalid_model') {
        setReadiness({
          state: 'not_ready',
          reason: 'Selected model is not available. Pick a valid model in AI Settings.',
        });
      } else if (result.state === 'invalid_key') {
        setReadiness({ state: 'not_ready', reason: 'Invalid API key. Update your key in AI Settings.' });
      } else {
        setReadiness({
          state: 'not_ready',
          reason: 'Provider not validated. Run Test Connection in AI Settings.',
        });
      }
    } finally {
      setValidating(false);
    }
  }, []);

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
    // Validate provider readiness before allowing any Ask.
    void validate();
  }, [analysisKey, validate]);

  const ready = readiness.state === 'ready';

  // Ask the EXISTING facade to ground a node. buildContext + facade.ask already exist; we only call them.
  const answer = React.useCallback(
    async (nodeId: string, q: string, focus: ContextFocus) => {
      const facade = facadeRef.current;
      if (!facade || !analysis) return;
      // Hard guard: never dispatch a question unless the provider is validated-ready.
      if (!ready) return;
      setPendingId(nodeId);
      try {
        // Build the task-scoped grounded context, then — for a FOLLOW-UP whose parent was
        // already answered — thread the prior investigation context forward via the existing
        // contextDelta (§15.2). This anchors bare questions like "Why?" to the CURRENT
        // investigation instead of treating them as isolated questions. Wiring only: no new
        // orchestration, and the deterministic engine / prompt builder are untouched.
        const base = buildContext(analysis, focus);
        const g0 = facade.getGraph();
        const parentId = g0?.nodes[nodeId]?.parentId;
        const isFollowUp = Boolean(parentId && g0?.nodes[parentId!]?.response);
        const context = isFollowUp ? contextDelta(analysisKey, base, focus) : base;
        await facade.ask(nodeId, q, context);
        const g = facade.getGraph();
        if (g) {
          // Reflect the ACTIVE question on the answered node so the response card title and the
          // investigation node label show what was actually asked (not the seeded placeholder).
          // UI-state only: the Investigation Graph structure/provenance is untouched.
          const node = g.nodes[nodeId];
          if (node) node.question = q;
          setGraph({ ...g });
        }
      } finally {
        setPendingId(undefined);
      }
    },
    [analysis, ready],
  );

  const ask = React.useCallback(() => {
    const facade = facadeRef.current;
    const g = facade?.getGraph();
    if (!facade || !g || !selectedId) return;
    if (!ready) return;
    // BUGFIX (runtime wiring): send the user's typed question to the provider, NOT the
    // selected node's stored title. Investigation context is preserved via `focus` and the
    // target node; we only replace the ACTIVE question. See resolveAskQuestion().
    const q = resolveAskQuestion(question, g.nodes[selectedId]?.question);
    void answer(selectedId, q, { kind: 'report' });
    // UX: clear the box and keep focus so follow-up questions can be typed immediately.
    setQuestion('');
    inputRef.current?.focus();
  }, [answer, selectedId, question, ready]);

  // Submit on Enter for quick follow-ups (Shift+Enter is left free for future multiline).
  const onInputKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        ask();
      }
    },
    [ask],
  );

  const branch = React.useCallback(
    (parentId: string) => {
      const facade = facadeRef.current;
      if (!facade) return;
      if (!ready) return;
      // Initialize the branch input with the PARENT question, then let the user edit it.
      // Once edited, the typed text always wins (resolveAskQuestion) — the node title is
      // never forced back onto the provider request.
      const parentQuestion = facade.getGraph()?.nodes[parentId]?.question ?? 'Why?';
      const res = facade.branch(parentId, parentQuestion, { kind: 'question', text: parentQuestion });
      setGraph({ ...res.graph });
      setSelectedId(res.nodeId);
      // Seed the editable input and focus it; do NOT auto-dispatch, so the user can refine first.
      setQuestion(parentQuestion);
      inputRef.current?.focus();
    },
    [ready],
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
              'AI Settings'
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
  const askDisabled = Boolean(pendingId) || validating || !ready;
  const notReadyReason =
    readiness.state === 'not_ready' ? readiness.reason : 'AI is not ready. Configure and validate your provider in AI Settings first.';
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
              AI is enabled but no API key is set. Add a key in{' '}
              {onOpenSettings ? (
                <button type="button" onClick={onOpenSettings} className="text-accent underline">
                  AI Settings
                </button>
              ) : (
                'AI Settings'
              )}
              .
            </p>
          </CardBody>
        </Card>
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[35fr_65fr]">
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
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={onInputKeyDown}
              aria-label="Ask a question about this analysis"
              placeholder="Ask about this analysis…"
              disabled={!ready}
              className="min-h-[44px] flex-1 rounded-xl border border-line bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={ask}
              disabled={askDisabled}
              aria-disabled={askDisabled}
              title={!ready ? notReadyReason : undefined}
              className="min-h-[44px] rounded-xl bg-accent px-4 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-60"
            >
              {pendingId ? 'Asking…' : validating ? 'Validating…' : 'Ask'}
            </button>
          </div>
          {/* Readiness explanation — makes clear WHY Ask is blocked, and never lets a question
              fall through to a confusing local-policy / no-AI-call state. */}
          {!ready && !validating ? (
            <div
              role="status"
              aria-live="polite"
              className="rounded-xl border border-line bg-elevated/40 p-3 text-xs text-negative"
            >
              {notReadyReason}{' '}
              {onOpenSettings ? (
                <button type="button" onClick={onOpenSettings} className="text-accent underline">
                  Open AI Settings
                </button>
              ) : null}{' '}
              <button
                type="button"
                onClick={() => void validate()}
                className="text-accent underline"
              >
                Re-check
              </button>
            </div>
          ) : null}
          {selected?.response ? (
            <InvestigationResponseCard
              question={selected.question}
              response={selected.response as InvestigationResponse}
              onNext={(q) => selectedId && ready && answer(selectedId, q, { kind: 'question', text: q })}
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
