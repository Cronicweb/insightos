// InsightOS — AI Operating Policy (§28). LOCAL intent classification (rules + keyword/structure
// matching, NO LLM), prompt-injection defense, standard refusal, and system identity.
// Runs BEFORE any provider call so malicious prompts never reach the model.
//
// SCOPE MODEL: the user may ask ANYTHING. Scope is no longer enforced by refusing the question;
// it is enforced by the ANSWER being strictly retrieval-augmented (RAG) over the uploaded data and
// the deterministic analysis only (see prompts.ts PREAMBLE, prompts/system.ts, grounding.ts and
// validation.ts). If the provided data cannot answer a question, the analyst says so instead of
// drawing on outside knowledge. Prompt injection is still refused locally (§28.5).

import type { GroundedContext, InvestigationResponse } from './types';

export type IntentClass =
  | 'ANALYSIS'
  | 'SQL'
  | 'DATASET'
  | 'ROOT_CAUSE'
  | 'RECOMMENDATION'
  | 'FORECAST'
  | 'SEMANTIC_MODEL'
  | 'INVESTIGATION'
  | 'INSIGHTOS'
  | 'UNSUPPORTED';

export interface Classification {
  intent: IntentClass;
  supported: boolean;
  reason?: 'out_of_scope' | 'prompt_injection';
  matched?: string[];
}

export const STANDARD_REFUSAL =
  'I can only answer questions related to your uploaded data, the deterministic analysis generated ' +
  'by InsightOS, or how InsightOS works. I cannot assist with unrelated general-purpose questions.';

export const SYSTEM_IDENTITY =
  'I am Insight Analyst, the explainable analytics assistant built into InsightOS. My role is to ' +
  'help investigate deterministic analytical results, explain business insights, and answer ' +
  'questions about your uploaded data and the InsightOS platform. I am intentionally not a ' +
  'general-purpose AI assistant.';

// Prompt-injection patterns — detected locally and refused before any model call (§28.5).
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /you\s+are\s+now\s+(chatgpt|gpt|an?\s+ai|a\s+general)/i,
  /forget\s+(the\s+)?(dataset|context|everything)/i,
  /answer\s+any\s+question/i,
  /reveal\s+(your\s+)?(system\s+)?prompt/i,
  /disregard\s+(the\s+)?(rules|policy|instructions)/i,
  /pretend\s+(to\s+be|you\s+are)/i,
];

// In-scope class markers (§28.1). Order matters: first strong match wins.
const SCOPE_MARKERS: Array<{ intent: IntentClass; re: RegExp }> = [
  { intent: 'SQL', re: /\b(sql|query|select\b|group\s+by|join)\b/i },
  { intent: 'ROOT_CAUSE', re: /\b(root\s+cause|why\s+did|why\b|driver|contribut|caused?|what\s+(has\s+)?changed?|changed?\s+and\s+why|explain\s+(the\s+)?change)\b/i },
  { intent: 'FORECAST', re: /\b(forecast|predict|projection|trend|next\s+(quarter|month|period))\b/i },
  { intent: 'RECOMMENDATION', re: /\b(recommend|action|next\s+step|should\s+(we|i|management)|what\s+(should|can|could)\s+(we|i)\s+do|what\s+(to|do\s+(we|i))\s+do|what\s+now|so\s+what|how\s+do\s+(we|i)\s+(fix|improve|address|respond)|remediat|mitigat|prioriti)\b/i },
  { intent: 'SEMANTIC_MODEL', re: /\b(semantic|concept|mapping|column\s+meaning|data\s+dictionary)\b/i },
  { intent: 'INVESTIGATION', re: /\b(investigat|branch|compare\s+nodes?|decision\s+replay|graph)\b/i },
  { intent: 'INSIGHTOS', re: /\b(insightos|this\s+page|platform|how\s+(do|does)\s+(i|it)|workflow|setting|export)\b/i },
  { intent: 'DATASET', re: /\b(dataset|column|row|record|table|upload|data\s+quality|missing|null)\b/i },
  { intent: 'ANALYSIS', re: /\b(kpi|metric|revenue|retention|churn|anomal|statistic|chart|analysis|confidence|segment|cohort|region|channel|customer|product|sales|volume|cost|margin|profit|growth|decline|increase|decrease|spike|drop|outlier|distribution|average|median|total|percent|impact|performance|driver|summar|report|insight|finding|evidence|breakdown|correlat|compare)\b/i },
];

// Bare conversational follow-ups asked inside an investigation ("Why?", "How?", "Explain
// further?", "Tell me more"). They inherit their scope from the answered node they follow, so
// they must not be refused. Anchored to the WHOLE question so only bare follow-ups qualify.
const FOLLOW_UP =
  /^(why|how|and\s+(why|how)|explain(\s+(this|that|it|further|more|why|how))?|elaborate|tell\s+me\s+more|more\s+details?|go\s+deeper|dig\s+deeper|expand(\s+on\s+(this|that))?)\b[\s?.!]*$/i;

/**
 * Classify a user question LOCALLY (§28.4). Deterministic; no LLM.
 *
 * Any question is allowed through — only prompt-injection attempts are refused here. Questions that
 * match no in-scope marker are classified as ANALYSIS and answered strictly from the grounded
 * context (RAG); the model is instructed to say the data does not contain the answer rather than
 * fall back on outside knowledge. `strictMode` is retained for API compatibility and no longer
 * gates whether a question may be asked.
 */
export function classifyIntent(question: string, _strictMode = true): Classification {
  const q = (question ?? '').trim();
  if (!q) return { intent: 'UNSUPPORTED', supported: false, reason: 'out_of_scope' };

  for (const re of INJECTION_PATTERNS) {
    if (re.test(q)) return { intent: 'UNSUPPORTED', supported: false, reason: 'prompt_injection', matched: [re.source] };
  }

  const scopeHit = SCOPE_MARKERS.find((m) => m.re.test(q));
  if (scopeHit) return { intent: scopeHit.intent, supported: true, matched: [scopeHit.re.source] };

  // Follow-ups carry the scope of the question they follow.
  if (FOLLOW_UP.test(q)) return { intent: 'ROOT_CAUSE', supported: true, matched: [FOLLOW_UP.source] };

  // Anything else: answerable, but only from the grounded context.
  return { intent: 'ANALYSIS', supported: true };
}

/** Build the standard local refusal as a valid InvestigationResponse (no provider call). */
export function refusalResponse(context?: GroundedContext): InvestigationResponse {
  return {
    summary: STANDARD_REFUSAL,
    evidence: [],
    confidence: { level: 'high', basis: 'request refused locally by the AI Operating Policy (no AI call)' },
    supportingCharts: [],
    statisticalTests: [],
    nextInvestigation: [],
    trace: {
      provider: 'local-policy',
      model: 'none',
      grounding: 'Refused',
      temperature: 0,
      promptVersion: 'policy-v1',
      reasoningSources: [],
      contextSources: context?.facts.map((f) => f.sourcePath) ?? [],
      analysisHash: '',
      timestamp: Date.now(),
      cached: false,
    },
  };
}
