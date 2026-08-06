// InsightOS AI layer — default Groq provider (client-side fetch, no SDK, no server).
// Implements AIProvider. All prompts are grounded; see docs/ai-architecture.md.
// The API key is supplied at runtime from browser localStorage and never committed.
import type { AIProvider } from "../provider";
import { disabledAnswer } from "../provider";
import { buildGuardedAnswer } from "../grounding";
import {
  answerQuestionPrompt,
  explainInsightPrompt,
  generateSqlPrompt,
  rewriteReportPrompt,
  semanticParsePrompt,
} from "../prompts";
import type {
  AISettings,
  ExplainRequest,
  GeneratedSql,
  GroundedAnswer,
  QuestionRequest,
  RewriteRequest,
  SemanticModelDraft,
  SemanticParseInput,
  SqlGenRequest,
} from "../types";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

async function chat(
  settings: AISettings,
  system: string,
  user: string,
  jsonMode: boolean,
): Promise<string> {
  const res = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey ?? ""}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: settings.temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Groq request failed: ${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

export class GroqProvider implements AIProvider {
  readonly id = "groq";
  readonly label = "Groq";
  constructor(private readonly settings: AISettings) {}

  async semanticUnderstanding(input: SemanticParseInput): Promise<SemanticModelDraft> {
    const { system, user } = semanticParsePrompt(input);
    try {
      const raw = await chat(this.settings, system, user, true);
      const parsed = JSON.parse(raw) as SemanticModelDraft;
      return parsed?.columns ? parsed : { columns: [] };
    } catch {
      // Advisory only: on any failure, produce an empty draft so the engine's
      // deterministic role/domain inference remains the source of truth.
      return { columns: [] };
    }
  }

  async explainInsight(request: ExplainRequest): Promise<GroundedAnswer> {
    const { system, user } = explainInsightPrompt(request);
    try {
      const raw = await chat(this.settings, system, user, false);
      return buildGuardedAnswer(raw, request.context, this.id, this.settings.strictGrounding);
    } catch {
      return disabledAnswer(this.id);
    }
  }

  async answerQuestion(request: QuestionRequest): Promise<GroundedAnswer> {
    const { system, user } = answerQuestionPrompt(request);
    try {
      const raw = await chat(this.settings, system, user, false);
      return buildGuardedAnswer(raw, request.context, this.id, this.settings.strictGrounding);
    } catch {
      return disabledAnswer(this.id);
    }
  }

  async rewriteExecutiveReport(request: RewriteRequest): Promise<string> {
    const { system, user } = rewriteReportPrompt(request);
    try {
      const raw = await chat(this.settings, system, user, false);
      // Tone-only rewrite; if empty, fall back to the deterministic report text.
      return raw.trim() || request.reportText;
    } catch {
      return request.reportText;
    }
  }

  async generateSQL(request: SqlGenRequest): Promise<GeneratedSql> {
    const { system, user } = generateSqlPrompt(request);
    try {
      const raw = await chat(this.settings, system, user, true);
      const parsed = JSON.parse(raw) as GeneratedSql;
      return { sql: parsed.sql ?? "", notes: parsed.notes ?? [] };
    } catch {
      return { sql: "", notes: ["SQL generation failed"] };
    }
  }
}

/** Factory for the provider registry. */
export function createGroqProvider(settings: AISettings): AIProvider {
  return new GroqProvider(settings);
}

// ----------------------------------------------------------------------------
// Connection test (browser-only). Validates the API key + model against Groq
// WITHOUT sending any dataset content. The key is used solely for the request
// Authorization header and is NEVER logged, stored elsewhere, or returned.
// Reuses the same GROQ_ENDPOINT/base as chat(); no new provider abstraction.
// ----------------------------------------------------------------------------
export type ConnectionState =
  | 'not_connected'
  | 'connecting'
  | 'connected'
  | 'invalid_key'
  | 'invalid_model'
  | 'unreachable'
  | 'network_error';

export interface ConnectionResult {
  state: ConnectionState;
  provider: string;
  model: string;
  latencyMs?: number;
  validatedAt?: number;
  detail?: string;
  /**
   * Exact model IDs returned by GET /openai/v1/models for this key.
   * Populated on any authenticated response (connected OR invalid_model) so the
   * Settings UI can offer a real, live-sourced dropdown. Never hardcoded.
   */
  availableModels?: string[];
}

const GROQ_MODELS_ENDPOINT = 'https://api.groq.com/openai/v1/models';

/**
 * Test connectivity for the given settings. Returns a mapped ConnectionState.
 * - Verifies auth via the models endpoint (401/403 -> invalid_key).
 * - Confirms the configured model id exists (missing -> invalid_model).
 * - Any thrown fetch error -> network_error; non-2xx server -> unreachable.
 */
export async function testGroqConnection(settings: AISettings): Promise<ConnectionResult> {
  const provider = 'groq';
  const model = settings.model;
  if (!settings.apiKey) {
    return { state: 'invalid_key', provider, model, detail: 'No API key provided' };
  }
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(GROQ_MODELS_ENDPOINT, {
      method: 'GET',
      headers: { Authorization: `Bearer ${settings.apiKey}` },
    });
  } catch {
    return { state: 'network_error', provider, model, detail: 'Request failed to send' };
  }
  const latencyMs = Date.now() - started;
  if (res.status === 401 || res.status === 403) {
    return { state: 'invalid_key', provider, model, latencyMs, detail: 'Authentication failed' };
  }
  if (!res.ok) {
    return { state: 'unreachable', provider, model, latencyMs, detail: `Provider returned ${res.status}` };
  }
  // Confirm the selected model is available to this key, and surface the full list.
  try {
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const availableModels = (data.data ?? [])
      .map((m) => m.id)
      .filter(Boolean) as string[];
    const ids = new Set(availableModels);
    // A model must be explicitly chosen from the live list. An empty/absent model,
    // or one not present in the returned list, is reported as invalid_model so the
    // UI can force a re-selection. Never silently continue with an invalid model.
    if (availableModels.length > 0 && (!model || !ids.has(model))) {
      return {
        state: 'invalid_model',
        provider,
        model,
        latencyMs,
        detail: model ? 'Selected model not available' : 'No model selected',
        availableModels,
      };
    }
    return {
      state: 'connected',
      provider,
      model,
      latencyMs,
      validatedAt: Date.now(),
      availableModels,
    };
  } catch {
    // If the list can't be parsed, auth still succeeded: treat as connected.
    return { state: 'connected', provider, model, latencyMs, validatedAt: Date.now() };
  }
}
