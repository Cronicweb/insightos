// InsightOS AI layer — shared types.
// Additive module. Imports nothing from the existing engine. Inert unless AISettings.enabled.
// See docs/ai-architecture.md for the governing contract.

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
}

/** Metadata-only input for the AI Semantic Parser. NEVER contains full rows. */
export interface SemanticParseInput {
  tableName: string;
  rowCount: number;
  columns: Array<{
    name: string;
    inferredType: string;
    /** Small, privacy-filtered sample of masked values. */
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
    confidence: number;
  }>;
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
  /** Browser-only. NEVER committed or bundled. */
  apiKey?: string;
}

/** Safe defaults: every AI capability OFF. With these defaults the app == current build. */
export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
  providerId: "groq",
  model: "llama-3.3-70b-versatile",
  temperature: 0.2,
  strictGrounding: true,
  enableExecutiveRewrite: false,
  enableSemanticParser: false,
};
