// InsightOS — Analyst facade (Phase 3, §13.1 / §15 / §16).
// The SINGLE service path from UI to a provider. UI never calls a provider directly.
// Responsibilities (in order): resolve provider → build/reuse grounded context → budget/estimate
// → cache lookup → provider call → grounding guard → assemble InvestigationResponse + AITrace → cache.

import { getActiveProvider } from './index';
import { loadAISettings } from './settings';
import { cacheKey, estimateTokens, getCachedAnswer, setCachedAnswer, hashString } from './cache';
import { recordTurn } from './memory';
import { getCachedSemanticModel } from './semantic/cache';
import type { AITraceExtended, InvestigationResponse } from './investigation/graph';
import type {
  AISettings,
  ContextFocus,
  GroundedAnswer,
  GroundedContext,
  ReasoningSource,
} from './types';
import { DEFAULT_AI_BUDGET } from './types';

/**
 * Prompt-registry version stamp surfaced in the AI Trace (§13.11).
 * Kept local so the facade never depends on prompts.ts internals; the registry split (§13.2)
 * can re-export/override this without changing the facade's public behavior.
 */
export const ANALYST_PROMPT_VERSION = 'analyst-rag-v2';

/** Map a focus/context to the deterministic engines that ground it (for AI Trace §15.3). */
export function reasoningSourcesFor(
  focus: ContextFocus,
  hasSemanticModel: boolean,
  hasSql: boolean,
): ReasoningSource[] {
  const s = new Set<ReasoningSource>();
  if (hasSemanticModel) s.add('Semantic Model');
  switch (focus.kind) {
    case 'root_cause':
      s.add('Root Cause Analysis');
      s.add('Statistical Tests');
      break;
    case 'kpi':
    case 'forecast':
      s.add('KPI Engine');
      break;
    case 'recommendation':
      s.add('Recommendation Engine');
      break;
    case 'anomaly':
      s.add('Statistical Tests');
      break;
    default:
      break;
  }
  if (hasSql) s.add('SQL Query');
  return Array.from(s);
}

function buildTrace(
  context: GroundedContext,
  settings: AISettings,
  answer: GroundedAnswer,
  analysisKey: string,
  cached: boolean,
  estimatedTokens: number,
  hasSql: boolean,
): AITraceExtended {
  const semantic = getCachedSemanticModel(analysisKey);
  return {
    provider: answer.provider,
    model: settings.model,
    grounding: settings.strictGrounding ? 'Strict' : 'Relaxed',
    temperature: settings.temperature,
    promptVersion: ANALYST_PROMPT_VERSION,
    reasoningSources: reasoningSourcesFor(context.focus, Boolean(semantic), hasSql),
    contextSources: context.facts.map((f) => f.sourcePath),
    semanticVersion: semantic?.version,
    analysisHash: hashString(JSON.stringify(context.facts)),
    timestamp: Date.now(),
    cached,
    estimatedTokens,
  };
}

function toInvestigationResponse(
  answer: GroundedAnswer,
  trace: AITraceExtended,
  supportingCharts: string[],
  statisticalTests: string[],
): InvestigationResponse {
  return {
    summary: answer.answer,
    evidence: answer.evidence,
    confidence: answer.confidence,
    supportingCharts,
    statisticalTests,
    nextInvestigation: answer.nextSteps,
    trace,
  };
}

export interface AnalystAskInput {
  analysisKey: string;
  question: string;
  context: GroundedContext;
  supportingCharts?: string[];
  statisticalTests?: string[];
}

/**
 * Ask the analyst a grounded question. Returns a structured InvestigationResponse.
 * Safe when AI is disabled: getActiveProvider() yields a NullProvider whose answer is inert,
 * so this never throws and never leaks data.
 */
export async function ask(input: AnalystAskInput): Promise<InvestigationResponse> {
  const settings = loadAISettings();
  const provider = getActiveProvider(settings);

  const focusKey = JSON.stringify(input.context.focus);
  const analysisHash = hashString(JSON.stringify(input.context.facts));
  const key = cacheKey({
    analysisHash,
    focusKey,
    promptVersion: ANALYST_PROMPT_VERSION,
    question: input.question,
    model: settings.model,
    temperature: settings.temperature,
  });

  const estimated = estimateTokens({ q: input.question, c: input.context });
  const overBudget = estimated > DEFAULT_AI_BUDGET.perRequestTokens;

  const cachedAnswer = getCachedAnswer(key);
  let answer: GroundedAnswer;
  let servedFromCache = false;

  if (cachedAnswer) {
    answer = cachedAnswer;
    servedFromCache = true;
  } else if (overBudget) {
    // Do not silently send an over-budget request; return an honest, grounded fallback.
    answer = {
      ok: true,
      grounded: true,
      provider: provider.id,
      answer:
        'This question needs more context than the current budget allows. Narrow the focus ' +
        '(e.g. a single KPI or root cause) and ask again.',
      evidence: input.context.facts,
      confidence: { level: 'low', basis: 'request exceeded token budget' },
      nextSteps: [],
    };
  } else {
    answer = await provider.answerQuestion({ context: input.context, question: input.question });
    if (answer.ok && answer.grounded) setCachedAnswer(key, answer);
  }

  const hasSql = false;
  const trace = buildTrace(
    input.context,
    settings,
    answer,
    input.analysisKey,
    servedFromCache,
    estimated,
    hasSql,
  );

  // Record the turn as REFERENCES (sourcePaths + focus), not replayed prose (§15.2).
  recordTurn(input.analysisKey, {
    role: 'user',
    text: input.question,
    focus: input.context.focus,
    ts: Date.now(),
  });
  recordTurn(input.analysisKey, {
    role: 'analyst',
    text: answer.answer,
    evidenceRefs: answer.evidence.map((e) => e.sourcePath),
    ts: Date.now(),
  });

  return toInvestigationResponse(
    answer,
    trace,
    input.supportingCharts ?? [],
    input.statisticalTests ?? [],
  );
}
