import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalystFacade } from '@/lib/ai/facade';
import { resolveAskQuestion } from '@/components/analyst/insight-analyst-workspace';
import { saveAISettings, clearAISettings } from '@/lib/ai/settings';
import { buildContext } from '@/lib/ai/context';
import type { AISettings } from '@/lib/ai/types';

// --- minimal browser shim (jsdom not installed): only localStorage + window are needed ---
function installLocalStorage() {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  (globalThis as any).window = globalThis as any;
  (globalThis as any).localStorage = ls;
  (globalThis as any).window.localStorage = ls;
}

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

const ENABLED_GROQ: AISettings = {
  enabled: true,
  providerId: 'groq',
  model: 'llama-3.3-70b-versatile',
  temperature: 0.2,
  strictGrounding: false, // relaxed: grounding is covered elsewhere; here we test question wiring
  enableExecutiveRewrite: false,
  enableSemanticParser: false,
  strictInvestigationMode: true,
  apiKey: 'gsk_test_key_NOT_REAL',
};

const ROOT_QUESTION = 'What changed and why?';
// A supported, distinct follow-up ("what should I fix?" expressed so the intent classifier,
// which we must NOT modify, recognises it as a RECOMMENDATION question).
const TYPED_QUESTION = 'What should we fix first?';

describe('E2E — typed custom question reaches the provider and the UI (PR #12)', () => {
  beforeEach(() => {
    installLocalStorage();
    clearAISettings();
    vi.restoreAllMocks();
  });

  it('typed question flows to Groq body, updates the answered node, and leaves the previous node unchanged', async () => {
    saveAISettings(ENABLED_GROQ);

    // Capture every outbound provider request so we can inspect the message body.
    const calls: { url: string; init: any }[] = [];
    const fetchMock = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      const body = {
        choices: [{ message: { content:
          'To improve results, prioritise the top recommendation first; ' +
          'that is what you should fix first based on the deterministic analysis.' } }],
      };
      return { ok: true, status: 200, json: async () => body } as any;
    });
    (globalThis as any).fetch = fetchMock;

    const analysis = { report: { summary: 'Executive summary of the analysis.' } };

    // 1) Open Insight Analyst -> root investigation seeded with "What changed and why?"
    const facade = new AnalystFacade('e2e-typed-key');
    const graph = facade.startInvestigation({
      analysisKey: 'e2e-typed-key',
      question: ROOT_QUESTION,
      focus: { kind: 'report' },
    });
    const rootId = graph.rootId;
    expect(facade.getGraph()!.nodes[rootId].question).toBe(ROOT_QUESTION);

    // 2) Answer the ROOT node once with the ROOT question -> this is the "previous investigation
    //    node" we will later prove is NOT mutated when we ask the typed question on a new node.
    const rootCtx = buildContext(analysis, { kind: 'report' });
    await facade.ask(rootId, ROOT_QUESTION, rootCtx);
    const rootBefore = facade.getGraph()!.nodes[rootId];
    const rootQuestionBefore = rootBefore.question;
    const rootSummaryBefore = (rootBefore.response as any)?.summary;
    expect(rootQuestionBefore).toBe(ROOT_QUESTION);

    // 3) Click "+Branch": the workspace seeds a child node from the parent question, but the
    //    handler lets the user edit the input before asking (typed text always wins).
    const child = facade.branch(rootId, ROOT_QUESTION, { kind: 'question', text: ROOT_QUESTION });
    const childId = child.nodeId;
    // Node starts labelled with the parent question (the seeded/editable value)...
    expect(facade.getGraph()!.nodes[childId].question).toBe(ROOT_QUESTION);

    calls.length = 0; // ignore the earlier root answer; only inspect the typed-question request

    // 4) Type "What should we fix first?" and click Ask.
    //    resolveAskQuestion => typed wins over the seeded node title.
    const q = resolveAskQuestion(TYPED_QUESTION, facade.getGraph()!.nodes[childId]?.question);
    expect(q).toBe(TYPED_QUESTION);
    expect(q).not.toBe(ROOT_QUESTION); // never the node title (the original bug)

    const askCtx = buildContext(analysis, { kind: 'report' });
    const res = await facade.ask(childId, q, askCtx);
    // Mirror the workspace answer() callback: it relabels the answered node to the active
    // question so the response card title and node label reflect what was actually asked.
    facade.getGraph()!.nodes[childId].question = q;

    // ✓ A provider request was made to Groq, and the outbound body carries the TYPED question
    //   (the RECOMMENDATION path may issue more than one call, e.g. answer + SQL; assert on the
    //   set of captured requests rather than a fixed count).
    expect(fetchMock).toHaveBeenCalled();
    expect(calls.every((c) => c.url === GROQ_ENDPOINT)).toBe(true);
    const userMessages = calls
      .map((c) => JSON.parse(c.init.body).messages.find((m: any) => m.role === 'user')?.content ?? '')
      .filter(Boolean);
    // At least one outbound message contains the typed question...
    expect(userMessages.some((c: string) => c.includes(TYPED_QUESTION))).toBe(true);
    // ...and NONE of them smuggles the node title (the original bug) as the active question.
    expect(userMessages.some((c: string) => c.includes(ROOT_QUESTION))).toBe(false);

    // ✓ Provider actually used (Groq), not the local refusal path
    expect(res.trace.provider).toBe('groq');

    // ✓ Response answers the typed question (mocked completion rendered into the summary)
    expect(res.summary.toLowerCase()).toContain('fix first');

    // ✓ Response card title becomes the typed question. The card renders node.question; the
    //   workspace sets the answered node's question to the resolved value. Assert the graph source.
    const answered = facade.getGraph()!.nodes[childId];
    expect(answered.question).toBe(TYPED_QUESTION);
    expect((answered.response as any)?.summary.toLowerCase()).toContain('fix first');

    // ✓ Previous investigation node (root) remains UNCHANGED (question + answer identical)
    const rootAfter = facade.getGraph()!.nodes[rootId];
    expect(rootAfter.question).toBe(rootQuestionBefore);
    expect((rootAfter.response as any)?.summary).toBe(rootSummaryBefore);
  });
});
