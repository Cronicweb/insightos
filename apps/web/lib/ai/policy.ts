// InsightOS — AI Operating Policy (§28). LOCAL intent classification (rules + keyword/structure
// matching, NO LLM), prompt-injection defense, standard refusal, and system identity.
// Runs BEFORE any provider call so unsupported/malicious prompts never reach the model.

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

// Out-of-scope markers (§28.2). Strong signals a request is general-purpose.
const OUT_OF_SCOPE: RegExp[] = [
  /\b(write|generate|create)\b.*\b(python|java|c\+\+|javascript|code|program|script|function)\b/i,
  /\b(poem|haiku|joke|story|resume|cover\s+letter|essay|song|lyrics)\b/i,
  /\btranslate\b/i,
  /\b(weather|forecast\s+the\s+weather)\b/i,
  /\bquantum|physics|chemistry|biology|astronomy\b/i,
  /\b(who\s+won|history\s+of|capital\s+of|recipe|movie|celebrity)\b/i,
  /\bsolve\b.*\b(equation|integral|derivative|math\s+problem)\b/i,
];

// In-scope class markers (§28.1). Order matters: first strong match wins.
const SCOPE_MARKERS: Array<{ intent: IntentClass; re: RegExp }> = [
  { intent: 'SQL', re: /\b(sql|query|select\b|group\s+by|join)\b/i },
  { intent: 'ROOT_CAUSE', re: /\b(root\s+cause|why\s+did|driver|contribut|caused?)\b/i },
  { intent: 'FORECAST', re: /\b(forecast|predict|projection|trend|next\s+(quarter|month|period))\b/i },
  { intent: 'RECOMMENDATION', re: /\b(recommend|action|next\s+step|should\s+(we|management))\b/i },
  { intent: 'SEMANTIC_MODEL', re: /\b(semantic|concept|mapping|column\s+meaning|data\s+dictionary)\b/i },
  { intent: 'INVESTIGATION', re: /\b(investigat|branch|compare\s+nodes?|decision\s+replay|graph)\b/i },
  { intent: 'INSIGHTOS', re: /\b(insightos|this\s+page|platform|how\s+(do|does)\s+(i|it)|workflow|setting|export)\b/i },
  { intent: 'DATASET', re: /\b(dataset|column|row|record|table|upload|data\s+quality|missing|null)\b/i },
  { intent: 'ANALYSIS', re: /\b(kpi|metric|revenue|retention|churn|anomal|statistic|chart|analysis|confidence)\b/i },
];

/**
 * Classify a user question LOCALLY (§28.4). Deterministic; no LLM. Injection and out-of-scope are
 * refused; otherwise the strongest in-scope marker decides the class. strictMode (default true)
 * refuses anything without a positive in-scope signal; when off, unmatched questions that aren't
 * clearly out-of-scope are treated as ANALYSIS (still grounded downstream).
 */
export function classifyIntent(question: string, strictMode = true): Classification {
  const q = (question ?? '').trim();
  if (!q) return { intent: 'UNSUPPORTED', supported: false, reason: 'out_of_scope' };

  for (const re of INJECTION_PATTERNS) {
    if (re.test(q)) return { intent: 'UNSUPPORTED', supported: false, reason: 'prompt_injection', matched: [re.source] };
  }

  const scopeHit = SCOPE_MARKERS.find((m) => m.re.test(q));

  for (const re of OUT_OF_SCOPE) {
    if (re.test(q)) {
      // Out-of-scope markers win unless there is ALSO a strong in-scope signal.
      if (!scopeHit) return { intent: 'UNSUPPORTED', supported: false, reason: 'out_of_scope', matched: [re.source] };
    }
  }

  if (scopeHit) return { intent: scopeHit.intent, supported: true, matched: [scopeHit.re.source] };

  if (strictMode) return { intent: 'UNSUPPORTED', supported: false, reason: 'out_of_scope' };
  return { intent: 'ANALYSIS', supported: true };
}

/** Build the standard local refusal as a valid InvestigationResponse (no provider call). */
export function refusalResponse(context?: GroundedContext): InvestigationResponse {
  return {
    summary: STANDARD_REFUSAL,
    evidence: [],
    confidence: { level: 'high', basis: 'out-of-scope request refused locally (no AI call)' },
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
