// InsightOS AI layer — provider abstraction.
// The rest of InsightOS must NEVER depend on a specific AI vendor. All access goes through here.
// See docs/ai-architecture.md §3.

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
} from "./types";

/** Provider-agnostic capabilities. All methods async and side-effect free. */
export interface AIProvider {
  readonly id: string;
  readonly label: string;
  semanticUnderstanding(input: SemanticParseInput): Promise<SemanticModelDraft>;
  explainInsight(request: ExplainRequest): Promise<GroundedAnswer>;
  answerQuestion(request: QuestionRequest): Promise<GroundedAnswer>;
  rewriteExecutiveReport(request: RewriteRequest): Promise<string>;
  generateSQL(request: SqlGenRequest): Promise<GeneratedSql>;
}

/** A disabled answer used whenever AI is off/unconfigured, so callers never branch on availability. */
export function disabledAnswer(providerId: string): GroundedAnswer {
  return {
    ok: false,
    answer: "AI features are disabled. Enable them in AI Settings and provide an API key.",
    evidence: [],
    confidence: { level: "low", basis: "AI layer disabled" },
    nextSteps: [],
    grounded: true,
    provider: providerId,
  };
}

/**
 * NullProvider — the default resolution when AI is disabled or misconfigured.
 * Every method resolves to a safe, inert value. No network calls. No throws.
 */
export class NullProvider implements AIProvider {
  readonly id = "null";
  readonly label = "Disabled";
  async semanticUnderstanding(): Promise<SemanticModelDraft> {
    return { columns: [] };
  }
  async explainInsight(): Promise<GroundedAnswer> {
    return disabledAnswer(this.id);
  }
  async answerQuestion(): Promise<GroundedAnswer> {
    return disabledAnswer(this.id);
  }
  async rewriteExecutiveReport(request: RewriteRequest): Promise<string> {
    // Non-authoritative: return the engine text unchanged when disabled.
    return request.reportText;
  }
  async generateSQL(): Promise<GeneratedSql> {
    return { sql: "", notes: ["AI disabled"] };
  }
}

/**
 * Resolve the configured provider. Returns NullProvider whenever AI is off, no key is present,
 * or the provider id is unknown — guaranteeing the deterministic path is never blocked.
 */
/**
 * Providers that run on the user's own machine and therefore have no API key to
 * check. Kept here rather than imported from the registry so this module stays
 * free of runtime dependencies on any vendor.
 */
const KEYLESS_PROVIDERS = new Set(["ollama"]);

export function resolveProvider(
  settings: AISettings,
  registry: Record<string, (s: AISettings) => AIProvider>,
): AIProvider {
  if (!settings.enabled) return new NullProvider();
  if (!settings.apiKey && !KEYLESS_PROVIDERS.has(settings.providerId)) return new NullProvider();
  const factory = registry[settings.providerId];
  if (!factory) return new NullProvider();
  try {
    return factory(settings);
  } catch {
    return new NullProvider();
  }
}
