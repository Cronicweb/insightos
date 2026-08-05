// InsightOS AI layer — shared types.
// Additive module. Imports nothing from the existing engine. Inert unless AISettings.enabled.
// See docs/ai-architecture.md for the governing contract (incl. §13 Addendum v2).

/** A single grounded fact copied verbatim from a deterministic Analysis artifact. */
export interface GroundedFact {
  id: string;
  label: string;
  value: string | number | null;
  /** Pointer into the Analysis object, e.g. "root_causes[0].root.children[2].contribution_pct". */
  sourcePath: string;
}

/** What an AI task is focused on. Keeps context payloads small and task-scoped. */
export type ContextFocus =
  | { kind: "kpi"; id: string }
  | { kind: "root_cause"; index: number }
  | { kind: "recommendation"; id: string }
  | { kind: "anomaly"; id: string }
  | { kind: "forecast"; metric: string }
  | { kind: "chart"; id: string }
  | { kind: "quality" }
  | { kind: "report" }
  | { kind: "question"; text: string };

/** Minimal grounded payload handed to a provider. Selection/trimming only — never invented. */
export interface GroundedContext {
  datasetLabel: string;
  focus: ContextFocus;
  facts: GroundedFact[];
  provenance: string[];
  confidenceNotes?: string[];
  /** States that privacy masking was already applied upstream. */
  redactionNote: string;
}

/** Which deterministic engines grounded an answer (docs/ai-architecture.md §13.11). */
export type ReasoningSource =
  | "Semantic Model"
  | "Root Cause Analysis"
  | "KPI Engine"
  | "Recommendation Engine"
  | "SQL Query"
  | "Statistical Tests";

/**
 * AI Trace — reasoning transparency attached to every AI answer (§13.11).
 * Populated by the service facade from actual cited sourcePaths and resolved settings;
 * never hand-typed by a prompt or component.
 */
export interface AITrace {
  reasoningSources: ReasoningSource[];
  provider: string; // e.g. "Groq"
  model: string; // e.g. "qwen-3-32b"
  grounding: "Strict" | "Relaxed";
  temperature: number;
  promptVersion: string;
  cached?: boolean;
  estimatedTokens?: number;
}

/** Standard grounded answer shape returned to the UI (post-guard). */
export interface GroundedAnswer {
  ok: boolean;
  answer: string;
  evidence: GroundedFact[];
  confidence: { level: "high" | "medium" | "low"; basis: string };
  nextSteps: string[];
  /** false => grounding guard caught an ungrounded claim. */
  grounded: boolean;
  provider: string;
  /** Reasoning transparency (§13.11). Optional so Phase 0 callers stay valid. */
  trace?: AITrace;
}

/** Metadata-only input for the AI Semantic Parser. NEVER contains full rows. */
export interface SemanticParseInput {
  tableName: string;
  rowCount: number;
  /** Small, privacy-filtered sample of masked values. */
  columns: Array<{
    name: string;
    inferredType: string;
    sampleValues: string[];
    summary: {
      nullFraction?: number;
      distinctCount?: number;
      min?: number | string;
      max?: number | string;
      mean?: number;
      topCategories?: Array<{ value: string; count: number }>;
    };
  }>;
}

/** Advisory output of the Semantic Parser. Never authoritative over the engine. */
export interface SemanticModelDraft {
  domainHint?: string;
  columns: Array<{
    name: string;
    conceptLabel?: string;
    roleHint?: "measure" | "dimension" | "time" | "identifier";
    aliasOf?: string;
    /** REQUIRED confidence per §13.5. */
    confidence: number;
  }>;
}

/** A single proposed semantic mapping with a confirmation gate (§13.5). */
export interface SemanticMappingProposal {
  name: string;
  conceptLabel?: string;
  aliasOf?: string;
  roleHint?: "measure" | "dimension" | "time" | "identifier";
  confidence: number;
  /** True when confidence is below threshold and user confirmation is required. */
  needsConfirmation: boolean;
  confirmed?: boolean;
}

/** Default confidence threshold below which a mapping needs explicit confirmation (§13.5). */
export const SEMANTIC_CONFIRM_THRESHOLD = 0.7;

/** One turn of session-scoped Insight Analyst conversation memory (§13.3). */
export interface ConversationTurn {
  role: "user" | "analyst";
  text: string;
  focus?: ContextFocus;
  /** sourcePaths cited that turn, for follow-up grounding. */
  evidenceRefs?: string[];
  ts: number;
}

/** Session-scoped (tab-lifetime) conversation, never persisted to disk (§13.3). */
export interface ConversationSession {
  id: string;
  analysisKey: string;
  turns: ConversationTurn[];
}

/** Token/cost budget for provider calls (§13.4). */
export interface AIBudget {
  perRequestTokens: number;
  perSessionTokens: number;
}

/** Parts hashed into an AI response cache key (§13.4). */
export interface AICacheKeyParts {
  analysisHash: string;
  focusKey: string;
  promptVersion: string;
  question?: string;
  model: string;
  temperature: number;
}

export interface ExplainRequest {
  context: GroundedContext;
  audience?: "default" | "executive" | "beginner";
}

export interface QuestionRequest {
  context: GroundedContext;
  question: string;
}

export interface RewriteRequest {
  /** Already-computed executive report text. Rewrite is tone-only, non-authoritative. */
  reportText: string;
  context: GroundedContext;
}

export interface SqlGenRequest {
  question: string;
  /** Column names/types only, so the model can target the DuckDB-WASM table. */
  schema: Array<{ name: string; type: string }>;
  tableName: string;
  dialect: "duckdb";
}

export interface GeneratedSql {
  sql: string;
  notes: string[];
}

/** User-configurable AI settings. Persisted in browser localStorage only. */
export interface AISettings {
  enabled: boolean;
  providerId: string;
  model: string;
  temperature: number;
  strictGrounding: boolean;
  enableExecutiveRewrite: boolean;
  enableSemanticParser: boolean;
  /**
   * Strict Investigation Mode (§28.8). When true (default), Insight Analyst answers ONLY in-scope
   * questions (uploaded data / current analysis / InsightOS); unrelated requests are refused
   * LOCALLY with no provider call. Recommended on.
   */
  strictInvestigationMode: boolean;
  /** Browser-only. NEVER committed or bundled. */
  apiKey?: string;
}

/** Known Groq model choices offered in the Settings UI (advisory list; free-text also allowed). */
export const GROQ_MODEL_OPTIONS = [
  "qwen-3-32b",
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
] as const;

/** Safe defaults: every AI capability OFF. With these defaults the app == current build. */
export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
  providerId: "groq",
  model: "qwen-3-32b",
  temperature: 0.2,
  strictGrounding: true,
  enableExecutiveRewrite: false,
  enableSemanticParser: false,
  strictInvestigationMode: true,
};

/** Default budgets (§13.4). Conservative to keep the browser responsive. */
export const DEFAULT_AI_BUDGET: AIBudget = {
  perRequestTokens: 6000,
  perSessionTokens: 60000,
};
