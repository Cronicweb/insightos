import { describe, it, expect, vi } from 'vitest';
import { AnalystFacade } from '@/lib/ai/facade';
import { resolveAskQuestion } from '@/components/analyst/insight-analyst-workspace';
import type { GroundedContext } from '@/lib/ai/types';

/**
 * Regression guard for the original runtime-wiring bug (PR #12):
 * the Ask handler used to send the SELECTED NODE'S TITLE ("What changed and why?") to the
 * provider, discarding the user's typed question. These tests pin the corrected behavior at
 * the exact decision point (resolveAskQuestion) AND at the facade boundary (AnalystFacade.ask).
 */
describe('Ask sends the typed question, not the node title (regression, PR #12)', () => {
  const NODE_TITLE = 'What changed and why?';
  const TYPED = 'What should I fix?';

  it('resolveAskQuestion: typed question wins over the node title', () => {
    expect(resolveAskQuestion(TYPED, NODE_TITLE)).toBe(TYPED);
    // whitespace-only counts as empty and falls back to the node title
    expect(resolveAskQuestion('   ', NODE_TITLE)).toBe(NODE_TITLE);
    // empty input falls back to the node title
    expect(resolveAskQuestion('', NODE_TITLE)).toBe(NODE_TITLE);
    // typed value is trimmed
    expect(resolveAskQuestion('  How can I fix this?  ', NODE_TITLE)).toBe('How can I fix this?');
  });

  it('resolveAskQuestion NEVER returns the node title when the user typed something', () => {
    expect(resolveAskQuestion(TYPED, NODE_TITLE)).not.toBe(NODE_TITLE);
  });

  it('AnalystFacade.ask receives the typed question (simulated Ask click)', async () => {
    const facade = new AnalystFacade('regression-key');
    const graph = facade.startInvestigation({
      analysisKey: 'regression-key',
      question: NODE_TITLE,
      focus: { kind: 'report' },
    });
    const rootId = graph.rootId;

    // The selected node's stored title is the original investigation question.
    expect(graph.nodes[rootId].question).toBe(NODE_TITLE);

    // Spy on the exact method the Ask button ultimately calls.
    const askSpy = vi
      .spyOn(AnalystFacade.prototype, 'ask')
      .mockResolvedValue({} as any);

    const context: GroundedContext = {
      datasetLabel: 'ds',
      focus: { kind: 'report' },
      facts: [],
      provenance: [],
      redactionNote: 'none',
    };

    // Simulate what the Ask handler does: pick the question, then call facade.ask.
    const q = resolveAskQuestion(TYPED, graph.nodes[rootId]?.question);
    await facade.ask(rootId, q, context);

    expect(askSpy).toHaveBeenCalledTimes(1);
    const sentQuestion = askSpy.mock.calls[0][1];
    expect(sentQuestion).toBe(TYPED);          // typed question reached the facade
    expect(sentQuestion).not.toBe(NODE_TITLE); // and NOT the node title (the original bug)

    askSpy.mockRestore();
  });
});
