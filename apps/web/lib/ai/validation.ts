// InsightOS — Response validation (§22). Every AI response must pass before rendering.
// Rejects invented KPIs/statistics/confidence/SQL and references to unavailable evidence.
// On failure the caller falls back to a deterministic explanation.

import type { GroundedContext, InvestigationResponse } from './types';

export interface ValidationResult {
  ok: boolean;
  violations: string[];
}

const ALLOWED_CONFIDENCE = new Set(['high', 'medium', 'low']);

/** Extract numeric tokens for cross-checking invented statistics. */
function numbersIn(text: string): string[] {
  return (text.match(/-?\d[\d,]*\.?\d*%?/g) ?? []).map((n) => n.replace(/,/g, ''));
}

/**
 * Validate a response against its grounding context.
 * - evidence sourcePaths must exist in the context
 * - confidence level must be one of the allowed values
 * - any SQL must only reference known columns/concepts
 * - numbers in the summary should appear in the grounded facts (strict mode)
 */
export function validateResponse(
  resp: InvestigationResponse,
  ctx: GroundedContext,
  opts: { strict?: boolean; knownColumns?: string[] } = {},
): ValidationResult {
  const violations: string[] = [];
  const ctxPaths = new Set(ctx.facts.map((f) => f.sourcePath));

  for (const e of resp.evidence) {
    if (!ctxPaths.has(e.sourcePath)) {
      violations.push(`evidence references unavailable sourcePath: ${e.sourcePath}`);
    }
  }

  if (!ALLOWED_CONFIDENCE.has(resp.confidence.level)) {
    violations.push(`invented confidence value: ${resp.confidence.level}`);
  }

  if (resp.sql?.sql && opts.knownColumns && opts.knownColumns.length > 0) {
    const known = new Set(opts.knownColumns.map((c) => c.toLowerCase()));
    const identifiers = (resp.sql.sql.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).map((s) => s.toLowerCase());
    const SQL_KW = new Set([
      'select','from','where','group','by','order','sum','avg','count','min','max','as','and','or',
      'on','join','left','right','inner','outer','having','limit','desc','asc','distinct','case',
      'when','then','else','end','not','in','is','null','between','like','over','partition','with',
    ]);
    for (const id of identifiers) {
      if (SQL_KW.has(id) || /^\d/.test(id)) continue;
      if (!known.has(id)) violations.push(`SQL references unknown column/concept: ${id}`);
    }
  }

  if (opts.strict) {
    const factNums = new Set(ctx.facts.flatMap((f) => numbersIn(String(f.value))));
    for (const n of numbersIn(resp.summary)) {
      if (!factNums.has(n)) violations.push(`summary contains ungrounded number: ${n}`);
    }
  }

  return { ok: violations.length === 0, violations };
}

/** Build a deterministic, always-valid explanation from the grounded context (§22 fallback). */
export function deterministicFallback(
  question: string,
  ctx: GroundedContext,
): InvestigationResponse {
  const top = ctx.facts.slice(0, 5);
  const summary =
    top.length > 0
      ? `Based on the deterministic analysis, ${top.map((f) => `${f.label} = ${f.value}`).join('; ')}.`
      : 'No grounded facts were available for this question.';
  return {
    summary,
    evidence: top,
    confidence: { level: 'high', basis: 'deterministic analysis (no AI narration)' },
    supportingCharts: [],
    statisticalTests: [],
    nextInvestigation: [],
    trace: {
      provider: 'deterministic',
      model: 'none',
      grounding: 'Fallback',
      temperature: 0,
      promptVersion: 'none',
      reasoningSources: [],
      contextSources: ctx.facts.map((f) => f.sourcePath),
      analysisHash: '',
      timestamp: Date.now(),
      cached: false,
    },
  };
}
