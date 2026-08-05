// InsightOS — Semantic Model (Phase 2, §14).
// Canonical, NON-DESTRUCTIVE concept↔column mapping. Never mutates the dataset,
// never renames physical columns; mappings are stored separately and keyed by original name.
// Advisory: deterministic role/domain inference is always the fallback.

import {
  SEMANTIC_CONFIRM_THRESHOLD,
  type SemanticModelDraft,
  type SemanticMappingProposal,
} from './types';

export type SemanticRole = 'measure' | 'dimension' | 'time' | 'identifier';

export interface SemanticConcept {
  concept: string; // canonical, e.g. "Revenue"
  column: string; // ORIGINAL physical column name (never renamed)
  role: SemanticRole;
  confidence: number;
  reasoning: string;
  evidence: string[];
  conflicts?: Array<{ concept: string; confidence: number }>;
  source: 'ai' | 'deterministic' | 'user';
  confirmed: boolean;
}

export interface SemanticModel {
  version: string;
  analysisKey: string;
  domainHint?: string;
  concepts: SemanticConcept[];
  createdAt: number;
}

let versionCounter = 0;
function nextVersion(): string {
  versionCounter += 1;
  return `sem-${Date.now().toString(36)}-${versionCounter}`;
}

/**
 * Turn an advisory SemanticModelDraft into confirmation proposals.
 * Low-confidence mappings are flagged needsConfirmation (§14.4 / §13.5).
 */
export function draftToProposals(
  draft: SemanticModelDraft,
  threshold = SEMANTIC_CONFIRM_THRESHOLD,
): SemanticMappingProposal[] {
  return (draft.columns ?? []).map((c) => ({
    name: c.name,
    conceptLabel: c.conceptLabel,
    aliasOf: c.aliasOf,
    roleHint: c.roleHint,
    confidence: c.confidence,
    needsConfirmation: c.confidence < threshold,
    confirmed: c.confidence >= threshold ? true : undefined,
  }));
}

/** True if any proposal requires user confirmation before analytics begin (§14.4). */
export function requiresReview(
  proposals: SemanticMappingProposal[],
  threshold = SEMANTIC_CONFIRM_THRESHOLD,
): boolean {
  return proposals.some((p) => p.confidence < threshold && !p.confirmed);
}

/**
 * Build the canonical SemanticModel from confirmed/high-confidence proposals.
 * Rejected or still-unconfirmed low-confidence proposals are omitted, so the engine
 * falls back to deterministic inference for those columns.
 */
export function buildSemanticModel(
  analysisKey: string,
  proposals: SemanticMappingProposal[],
  opts: { domainHint?: string; threshold?: number } = {},
): SemanticModel {
  const threshold = opts.threshold ?? SEMANTIC_CONFIRM_THRESHOLD;
  const concepts: SemanticConcept[] = proposals
    .filter((p) => p.confirmed === true || (p.confidence >= threshold && p.confirmed !== false))
    .map((p) => ({
      concept: p.conceptLabel ?? p.aliasOf ?? p.name,
      column: p.name, // original physical name preserved
      role: p.roleHint ?? 'dimension',
      confidence: p.confidence,
      reasoning: p.aliasOf ? `Mapped to canonical concept "${p.aliasOf}".` : 'Inferred from metadata.',
      evidence: [],
      source: p.confirmed ? 'user' : 'ai',
      confirmed: p.confirmed === true || p.confidence >= threshold,
    }));
  return { version: nextVersion(), analysisKey, domainHint: opts.domainHint, concepts, createdAt: Date.now() };
}

/** Resolve a canonical concept to its ORIGINAL physical column, or undefined (→ deterministic fallback). */
export function resolveColumn(model: SemanticModel | undefined, concept: string): string | undefined {
  return model?.concepts.find((c) => c.concept.toLowerCase() === concept.toLowerCase())?.column;
}
