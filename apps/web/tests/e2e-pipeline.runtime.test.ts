
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalystFacade } from '@/lib/ai/facade';
import { saveAISettings, clearAISettings } from '@/lib/ai/settings';
import type { GroundedContext, AISettings } from '@/lib/ai/types';

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

// A grounded context whose facts contain the numbers the mocked model will cite,
// so the grounding guard passes (grounded=true).
const context: GroundedContext = {
  datasetLabel: 'Q3 Subscriptions',
  focus: { kind: 'root_cause', index: 0 },
  facts: [
    { id: 'f1', label: 'Churn change', value: 12, sourcePath: 'root_causes[0].contribution_pct' },
    { id: 'f2', label: 'Enterprise segment share', value: 63, sourcePath: 'root_causes[0].children[1].share_pct' },
  ],
  provenance: ['root_causes[0]'],
  redactionNote: 'PII masked upstream',
};

const ENABLED_GROQ: AISettings = {
  enabled: true,
  providerId: 'groq',
  model: 'llama-3.3-70b-versatile',
  temperature: 0.2,
  strictGrounding: true,
  enableExecutiveRewrite: false,
  enableSemanticParser: false,
  strictInvestigationMode: true,
  apiKey: 'gsk_test_key_NOT_REAL',
};

describe('E2E runtime — AI request pipeline', () => {
  beforeEach(() => {
    installLocalStorage();
    clearAISettings();
    vi.restoreAllMocks();
  });

  it('SUPPORTED "What changed and why?" flows User→...→Groq→Grounding→Response', async () => {
    saveAISettings(ENABLED_GROQ);

    // Mock the outbound provider request. Returns a grounded completion citing 12 and 63.
    const calls: { url: string; init: any }[] = [];
    const fetchMock = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      const body = {
        choices: [{ message: { content:
          'Churn rose because the enterprise segment (share 63) drove a change of 12; ' +
          'this is the primary root-cause driver in the deterministic analysis.' } }],
      };
      return { ok: true, status: 200, json: async () => body } as any;
    });
    (globalThis as any).fetch = fetchMock;

    const facade = new AnalystFacade('analysis-key-1');

    // Stage: Intent Classifier (LOCAL) — must be SUPPORTED (ROOT_CAUSE)
    const verdict = facade.classify('What changed and why?');
    expect(verdict.supported).toBe(true);
    expect(verdict.intent).toBe('ROOT_CAUSE');

    // Drive the full ask lifecycle
    const graph = facade.startInvestigation({ analysisKey: 'analysis-key-1', question: 'What changed and why?', focus: { kind: 'root_cause', index: 0 } });
    const rootId = graph.rootId;
    const res = await facade.ask(rootId, 'What changed and why?', context, { knownColumns: ['churn','segment'] });

    // Stage: outbound provider request actually made, to Groq endpoint, with model+auth
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0].url).toBe(GROQ_ENDPOINT);
    const sentBody = JSON.parse(calls[0].init.body);
    expect(sentBody.model).toBe('llama-3.3-70b-versatile');
    expect(String(calls[0].init.headers.Authorization)).toContain('Bearer ');

    // Stage: provider response received & grounded, rendered summary present
    expect(res.summary.toLowerCase()).toContain('enterprise segment');
    expect(res.trace.grounding).toBe('Strict');           // strictGrounding true => Strict (not Refused)

    // Stage: AI Trace fields
    expect(res.trace.provider).toBe('groq');               // Groq, not local-policy
    expect(res.trace.model).toBe('llama-3.3-70b-versatile');
    expect(res.trace.promptVersion).toBe('analyst-v1');
    expect(res.trace.contextSources).toEqual([
      'root_causes[0].contribution_pct',
      'root_causes[0].children[1].share_pct',
    ]);
    expect(res.trace.reasoningSources).toContain('Root Cause Analysis');
    // confidence high => grounding guard verified all numbers
    expect(res.confidence.level).toBe('high');
  });

  it('UNSUPPORTED "Who won the FIFA World Cup?" is refused LOCALLY with NO provider call', async () => {
    saveAISettings(ENABLED_GROQ);
    const fetchMock = vi.fn(async () => { throw new Error('provider should NOT be called'); });
    (globalThis as any).fetch = fetchMock;

    const facade = new AnalystFacade('analysis-key-2');
    const verdict = facade.classify('Who won the FIFA World Cup?');
    expect(verdict.supported).toBe(false);

    const graph = facade.startInvestigation({ analysisKey: 'analysis-key-2', question: 'Who won the FIFA World Cup?' });
    const res = await facade.ask(graph.rootId, 'Who won the FIFA World Cup?', context);

    expect(fetchMock).not.toHaveBeenCalled();              // ZERO provider requests
    expect(res.trace.provider).toBe('local-policy');
    expect(res.trace.grounding).toBe('Refused');
    expect(res.trace.model).toBe('none');
  });
});
