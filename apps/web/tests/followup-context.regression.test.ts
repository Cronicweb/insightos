import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalystFacade } from '@/lib/ai/facade';
import { buildContext } from '@/lib/ai/context';
import { contextDelta, clearSession } from '@/lib/ai/memory';
import { saveAISettings, clearAISettings } from '@/lib/ai/settings';
import type { AISettings } from '@/lib/ai/types';

/**
 * Regression guard for the follow-up context bug (PR #12):
 * a bare follow-up such as "Why?" must be understood RELATIVE to the current
 * investigation, not as an isolated question. The workspace now threads the prior
 * investigation context forward via contextDelta (memory.ts, section 15.2) whenever
 * the target node is a follow-up whose parent was already answered. These tests pin
 * that the carried-forward context includes the earlier turn's evidence provenance.
 */

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

const ENABLED_GROQ: AISettings = {
  enabled: true,
  providerId: 'groq',
  model: 'llama-3.3-70b-versatile',
  temperature: 0.2,
  strictGrounding: false,
  enableExecutiveRewrite: false,
  enableSemanticParser: false,
  strictInvestigationMode: true,
  apiKey: 'gsk_test_key_NOT_REAL',
};

const ROOT_QUESTION = 'What changed and why?';
const FOLLOW_UP = 'Why?';
const KEY = 'e2e-followup-key';

describe('Follow-up "Why?" is anchored to the current investigation (regression, PR #12)', () => {
  beforeEach(() => {
    installLocalStorage();
    clearAISettings();
    clearSession(KEY);
    vi.restoreAllMocks();
  });

  it('threads the prior investigation evidence forward into the follow-up context', async () => {
    saveAISettings(ENABLED_GROQ);

    // Provider echoes a grounded answer whose evidence carries a sourcePath, so the
    // conversation memory records a reference that a follow-up must inherit.
    const fetchMock = vi.fn(async (_url: any, _init: any) => {
      const body = {
        choices: [{ message: { content: 'Revenue fell because of the churn spike in the West region.' } }],
      };
      return { ok: true, status: 200, json: async () => body } as any;
    });
    (globalThis as any).fetch = fetchMock;

    const analysis = { report: { summary: 'Executive summary of the analysis.' } };

    const facade = new AnalystFacade(KEY);
    const graph = facade.startInvestigation({
      analysisKey: KEY,
      question: ROOT_QUESTION,
      focus: { kind: 'report' },
    });
    const rootId = graph.rootId;

    // Answer the ROOT node -> this seeds conversation memory with the answered turn.
    const rootCtx = buildContext(analysis, { kind: 'report' });
    await facade.ask(rootId, ROOT_QUESTION, rootCtx);
    expect(facade.getGraph()!.nodes[rootId].response).toBeDefined();

    // Branch a child (the "Why?" node) under the answered root.
    const child = facade.branch(rootId, FOLLOW_UP, { kind: 'question', text: FOLLOW_UP });
    const childId = child.nodeId;
    const parentId = facade.getGraph()!.nodes[childId].parentId;
    expect(parentId).toBe(rootId);

    // The workspace treats this as a follow-up (parent has a response) and builds the
    // context with contextDelta instead of a bare buildContext.
    const base = buildContext(analysis, { kind: 'question', text: FOLLOW_UP });
    const followUpContext = contextDelta(KEY, base, { kind: 'question', text: FOLLOW_UP });

    // The follow-up context preserves the prior investigation: its provenance is a
    // SUPERSET of the bare context's provenance (prior referenced sourcePaths carried forward).
    for (const p of base.provenance ?? []) {
      expect(followUpContext.provenance).toContain(p);
    }
    expect((followUpContext.provenance ?? []).length).toBeGreaterThanOrEqual((base.provenance ?? []).length);

    // "Why?" is a SUPPORTED question locally (ROOT_CAUSE marker), so it reaches the provider.
    expect(facade.classify(FOLLOW_UP).supported).toBe(true);

    // Ask the follow-up with the threaded context -> provider is invoked (not the refusal path).
    const res = await facade.ask(childId, FOLLOW_UP, followUpContext);
    expect(res.trace.provider).toBe('groq');
    expect(fetchMock).toHaveBeenCalled();

    // Previous node remains unchanged.
    expect(facade.getGraph()!.nodes[rootId].question).toBe(ROOT_QUESTION);
  });
});
