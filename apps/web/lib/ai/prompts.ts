// InsightOS AI layer — prompt registry (versioned static templates).
// Every template opens with the same prime-directive preamble. See docs/ai-architecture.md §7.

import type {
  ExplainRequest,
  QuestionRequest,
  RewriteRequest,
  SemanticParseInput,
  SqlGenRequest,
} from "./types";

export const PROMPT_VERSION = "2026-08-05.1";

const PREAMBLE =
  "You are the Insight Analyst inside InsightOS, an explainable analytics platform. " +
  "The deterministic engine is the single source of truth. " +
  "Use ONLY the context provided. Never invent numbers, KPIs, root causes, or recommendations. " +
  "Cite the source of any figure you mention. If the context does not contain the answer, say so plainly.";

const ANALYST_SHAPE =
  "Structure every answer with four clearly labelled sections: " +
  "Answer, Evidence, Confidence, Next Steps.";

export function semanticParsePrompt(input: SemanticParseInput): { system: string; user: string } {
  const system =
    PREAMBLE +
    " TASK: Infer semantic meaning of columns from METADATA ONLY (names, types, sample values, " +
    "summary statistics). You are NOT given the full dataset. Return JSON ONLY, never prose, " +
    "matching: { domainHint?: string, columns: [{ name, conceptLabel?, roleHint?, aliasOf?, confidence }] }. " +
    "roleHint is one of measure|dimension|time|identifier. This output is ADVISORY; the deterministic " +
    "engine may override it.";
  const user = JSON.stringify(input);
  return { system, user };
}

export function explainInsightPrompt(request: ExplainRequest): { system: string; user: string } {
  const audience = request.audience ?? "default";
  const system =
    PREAMBLE +
    ` Explain the focused analytic result for a ${audience} audience. ` +
    ANALYST_SHAPE;
  const user = JSON.stringify(request.context);
  return { system, user };
}

export function answerQuestionPrompt(request: QuestionRequest): { system: string; user: string } {
  const system = PREAMBLE + " Answer the user's question using only the grounded context. " + ANALYST_SHAPE;
  const user = JSON.stringify({ question: request.question, context: request.context });
  return { system, user };
}

export function rewriteReportPrompt(request: RewriteRequest): { system: string; user: string } {
  const system =
    PREAMBLE +
    " Rewrite the executive report for tone and clarity ONLY. Do not change any figure, claim, " +
    "or recommendation. Preserve all numbers exactly.";
  const user = JSON.stringify({ reportText: request.reportText, context: request.context });
  return { system, user };
}

export function generateSqlPrompt(request: SqlGenRequest): { system: string; user: string } {
  const system =
    PREAMBLE +
    ` Translate the user's question into a single ${request.dialect} SQL query against the given table. ` +
    "Return JSON ONLY: { sql: string, notes: string[] }. Use only the provided columns. " +
    "Do not invent columns. The query runs locally in DuckDB-WASM.";
  const user = JSON.stringify({
    question: request.question,
    tableName: request.tableName,
    schema: request.schema,
  });
  return { system, user };
}
