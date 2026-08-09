// InsightOS AI layer - shared chat transport for the non-Groq providers.
//
// groq.ts came first and is deliberately left untouched: the default path keeps
// its exact behaviour. Everything OpenAI, Gemini, Claude and Ollama need that
// differs from it is request/response *shape*, so the difference is expressed as
// data (a ChatSpec) rather than as four near-identical provider classes.
//
// Every call is a plain browser fetch. There is no SDK, no server and no proxy,
// which is what keeps the static export deployable to GitHub Pages.
import type { AIProvider } from '../provider';
import { disabledAnswer } from '../provider';
import { buildGuardedAnswer } from '../grounding';
import {
  answerQuestionPrompt,
  explainInsightPrompt,
  generateSqlPrompt,
  rewriteReportPrompt,
  semanticParsePrompt,
} from '../prompts';
import type { ConnectionResult } from './groq';
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
} from '../types';

/** Everything that differs between one HTTP chat API and the next. */
export interface ChatSpec {
  readonly id: string;
  readonly label: string;
  /** Local runtimes authenticate by being reachable, not by a bearer token. */
  readonly needsKey: boolean;
  readonly defaultBaseUrl: string;
  /** Shown under the base-URL field in AI Settings. */
  readonly baseUrlHint: string;
  chatUrl(base: string, settings: AISettings): string;
  modelsUrl(base: string, settings: AISettings): string;
  headers(settings: AISettings): Record<string, string>;
  body(settings: AISettings, system: string, user: string, jsonMode: boolean): unknown;
  text(payload: unknown): string;
  models(payload: unknown): string[];
}

/** A user-supplied base URL wins; otherwise the vendor default. */
export function baseUrlFor(spec: ChatSpec, settings: AISettings): string {
  const custom = settings.baseUrl?.trim().replace(/\/+$/, '');
  return custom || spec.defaultBaseUrl;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** `choices[0].message.content` - the OpenAI shape, shared by Groq and Ollama. */
export function openAiText(payload: unknown): string {
  const choices = asRecord(payload).choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const message = asRecord(asRecord(choices[0]).message);
  return typeof message.content === 'string' ? message.content : '';
}

/** `data[].id` - the OpenAI model-list shape. */
export function openAiModels(payload: unknown): string[] {
  const data = asRecord(payload).data;
  if (!Array.isArray(data)) return [];
  return data
    .map((m) => asRecord(m).id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export function openAiBody(
  settings: AISettings,
  system: string,
  user: string,
  jsonMode: boolean,
): unknown {
  return {
    model: settings.model,
    temperature: settings.temperature,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };
}

async function chat(
  spec: ChatSpec,
  settings: AISettings,
  system: string,
  user: string,
  jsonMode: boolean,
): Promise<string> {
  const url = spec.chatUrl(baseUrlFor(spec, settings), settings);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...spec.headers(settings) },
    body: JSON.stringify(spec.body(settings, system, user, jsonMode)),
  });
  if (!res.ok) throw new Error(`${spec.label} request failed: ${res.status}`);
  return spec.text(await res.json());
}

/**
 * The same contract GroqProvider implements, parameterised by spec.
 *
 * Failure behaviour is identical to Groq's on purpose: the AI layer is advisory,
 * so every method degrades to the deterministic result rather than throwing.
 */
class SpecChatProvider implements AIProvider {
  readonly id: string;
  readonly label: string;

  constructor(
    private readonly spec: ChatSpec,
    private readonly settings: AISettings,
  ) {
    this.id = spec.id;
    this.label = spec.label;
  }

  async semanticUnderstanding(input: SemanticParseInput): Promise<SemanticModelDraft> {
    const { system, user } = semanticParsePrompt(input);
    try {
      const parsed = JSON.parse(await chat(this.spec, this.settings, system, user, true)) as SemanticModelDraft;
      return parsed?.columns ? parsed : { columns: [] };
    } catch {
      return { columns: [] };
    }
  }

  async explainInsight(request: ExplainRequest): Promise<GroundedAnswer> {
    const { system, user } = explainInsightPrompt(request);
    try {
      const raw = await chat(this.spec, this.settings, system, user, false);
      return buildGuardedAnswer(raw, request.context, this.id, this.settings.strictGrounding);
    } catch {
      return disabledAnswer(this.id);
    }
  }

  async answerQuestion(request: QuestionRequest): Promise<GroundedAnswer> {
    const { system, user } = answerQuestionPrompt(request);
    try {
      const raw = await chat(this.spec, this.settings, system, user, false);
      return buildGuardedAnswer(raw, request.context, this.id, this.settings.strictGrounding);
    } catch {
      return disabledAnswer(this.id);
    }
  }

  async rewriteExecutiveReport(request: RewriteRequest): Promise<string> {
    const { system, user } = rewriteReportPrompt(request);
    try {
      const raw = await chat(this.spec, this.settings, system, user, false);
      return raw.trim() || request.reportText;
    } catch {
      return request.reportText;
    }
  }

  async generateSQL(request: SqlGenRequest): Promise<GeneratedSql> {
    const { system, user } = generateSqlPrompt(request);
    try {
      const parsed = JSON.parse(await chat(this.spec, this.settings, system, user, true)) as GeneratedSql;
      return { sql: parsed.sql ?? '', notes: parsed.notes ?? [] };
    } catch {
      return { sql: '', notes: ['SQL generation failed'] };
    }
  }
}

export function createProviderFromSpec(spec: ChatSpec) {
  return (settings: AISettings): AIProvider => new SpecChatProvider(spec, settings);
}

/**
 * Connection test, mapped onto exactly the ConnectionState vocabulary that
 * testGroqConnection already returns, so the Settings UI needs no new states.
 * No dataset content is ever sent; the key is used only as a request header.
 */
export async function testChatConnection(
  spec: ChatSpec,
  settings: AISettings,
): Promise<ConnectionResult> {
  const provider = spec.id;
  const model = settings.model;
  if (spec.needsKey && !settings.apiKey) {
    return { state: 'invalid_key', provider, model, detail: 'No API key provided' };
  }
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(spec.modelsUrl(baseUrlFor(spec, settings), settings), {
      method: 'GET',
      headers: spec.headers(settings),
    });
  } catch {
    return {
      state: 'network_error',
      provider,
      model,
      detail: spec.needsKey
        ? 'Request failed to send'
        : `Could not reach ${baseUrlFor(spec, settings)}. Is the local runtime started, and started with CORS allowed for this origin?`,
    };
  }
  const latencyMs = Date.now() - started;
  if (res.status === 401 || res.status === 403) {
    return { state: 'invalid_key', provider, model, latencyMs, detail: 'Authentication failed' };
  }
  if (!res.ok) {
    return { state: 'unreachable', provider, model, latencyMs, detail: `Provider returned ${res.status}` };
  }
  try {
    const availableModels = spec.models(await res.json());
    if (availableModels.length > 0 && (!model || !availableModels.includes(model))) {
      return {
        state: 'invalid_model',
        provider,
        model,
        latencyMs,
        detail: model ? 'Selected model not available' : 'No model selected',
        availableModels,
      };
    }
    return { state: 'connected', provider, model, latencyMs, validatedAt: Date.now(), availableModels };
  } catch {
    return { state: 'connected', provider, model, latencyMs, validatedAt: Date.now() };
  }
}
