// InsightOS AI layer — grounded context builder.
// Pure selection/trimming from an engine Analysis object. Never invents values.
// NOTE: typed structurally to avoid coupling to the exact Analysis import path; the caller
// passes the existing Analysis object. See docs/ai-architecture.md §5.

import type { ContextFocus, GroundedContext, GroundedFact } from "./types";

/** Minimal structural view of the fields this builder reads from Analysis. */
export interface AnalysisLike {
  dataset?: string;
  key?: string;
  scorecard?: unknown;
  root_causes?: unknown[];
  recommendations?: unknown;
  quality?: { score?: number; grade?: string };
  schema?: {
    columns?: Array<{ name?: string }>;
    measures?: string[];
    dimensions?: string[];
    time_columns?: string[];
  };
  governance?: { decision_readiness?: string; confidence_cap?: number };
  report?: { summary?: string };
}

const REDACTION_NOTE =
  "Sensitive fields were detected and masked by the privacy layer before this context was built. " +
  "Only aggregate, masked values are included.";

function fact(id: string, label: string, value: GroundedFact["value"], sourcePath: string): GroundedFact {
  return { id, label, value, sourcePath };
}

/**
 * Build a task-scoped grounded context. Only the facts relevant to `focus` are included,
 * keeping payloads small and every value traceable via sourcePath.
 */
export function buildContext(analysis: AnalysisLike, focus: ContextFocus): GroundedContext {
  const facts: GroundedFact[] = [];
  const provenance: string[] = [];
  const confidenceNotes: string[] = [];

  if (analysis.quality?.score != null) {
    facts.push(fact("quality.score", "Data quality score", analysis.quality.score, "quality.score"));
  }
  if (analysis.governance?.decision_readiness) {
    confidenceNotes.push(`Decision readiness: ${analysis.governance.decision_readiness}`);
    if (analysis.governance.confidence_cap != null) {
      confidenceNotes.push(`Confidence cap: ${analysis.governance.confidence_cap}`);
    }
  }

  // Focus-specific selection is intentionally conservative in Phase 0; richer extraction
  // per artifact type is added in later phases as panels are wired.
  switch (focus.kind) {
    case "root_cause":
      provenance.push(`root_causes[${focus.index}]`);
      break;
    case "recommendation":
      provenance.push(`recommendations (${focus.id})`);
      break;
    case "report":
      if (analysis.report?.summary) {
        facts.push(fact("report.summary", "Executive summary", analysis.report.summary, "report.summary"));
      }
      break;
    default:
      break;
  }

  // Carried so the grounding guard can name the columns a question asked for
  // but the dataset does not have. Names only - no values, no rows.
  const availableColumns = (analysis.schema?.columns ?? [])
    .map((c) => c?.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);

  return {
    datasetLabel: analysis.dataset ?? analysis.key ?? "dataset",
    focus,
    facts,
    provenance,
    availableColumns: availableColumns.length ? availableColumns : undefined,
    confidenceNotes: confidenceNotes.length ? confidenceNotes : undefined,
    redactionNote: REDACTION_NOTE,
  };
}
