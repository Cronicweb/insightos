// InsightOS — Prompt Registry (§31.4). Versioned catalog of task prompts with metadata.
// ADDITIVE: this WRAPS the existing task templates in ../prompts.ts (which remain the source of the
// actual template strings) and registers additional task descriptors. It does not replace them.

import { PROMPT_VERSION } from '../prompts';

export type PromptTask =
  | 'semantic'
  | 'analyst'
  | 'sql'
  | 'rewrite'
  | 'forecast'
  | 'recommendation'
  | 'report';

export interface PromptDescriptor {
  id: string;
  version: string;
  purpose: string;
  description: string;
  expectedInputs: string[];
  expectedOutputs: string[];
  task: PromptTask;
}

/**
 * Registry of supported tasks. version is stamped from the shared PROMPT_VERSION so registry and
 * templates stay in lockstep. forecast/recommendation/report are additive descriptors that reuse
 * the shared analyst answer shape (Answer/Evidence/Confidence/Next Steps).
 */
export const PROMPT_REGISTRY: Readonly<Record<PromptTask, PromptDescriptor>> = Object.freeze({
  semantic: {
    id: 'semantic',
    version: PROMPT_VERSION,
    purpose: 'Infer column semantics from metadata only.',
    description: 'Advisory semantic mapping; never authoritative over the engine.',
    expectedInputs: ['SemanticParseInput (metadata only)'],
    expectedOutputs: ['JSON: { domainHint?, columns:[{name,conceptLabel?,roleHint?,aliasOf?,confidence}] }'],
    task: 'semantic',
  },
  analyst: {
    id: 'analyst',
    version: PROMPT_VERSION,
    purpose: 'Explain a focused analytic result or answer a grounded question.',
    description: 'Grounded explanation with Answer/Evidence/Confidence/Next Steps.',
    expectedInputs: ['GroundedContext', 'optional user question'],
    expectedOutputs: ['Grounded prose with cited sourcePaths'],
    task: 'analyst',
  },
  sql: {
    id: 'sql',
    version: PROMPT_VERSION,
    purpose: 'Translate a question into a single DuckDB-WASM SQL query.',
    description: 'Uses only provided columns; runs locally.',
    expectedInputs: ['SqlGenRequest (schema + question)'],
    expectedOutputs: ['JSON: { sql, notes[] }'],
    task: 'sql',
  },
  rewrite: {
    id: 'rewrite',
    version: PROMPT_VERSION,
    purpose: 'Rewrite an executive report for tone/clarity only.',
    description: 'Never changes any figure, claim, or recommendation.',
    expectedInputs: ['RewriteRequest (reportText + context)'],
    expectedOutputs: ['Tone-adjusted report text, numbers preserved'],
    task: 'rewrite',
  },
  forecast: {
    id: 'forecast',
    version: PROMPT_VERSION,
    purpose: 'Explain a deterministic forecast/projection.',
    description: 'Explanation only; the forecast itself is computed deterministically.',
    expectedInputs: ['GroundedContext (forecast focus)'],
    expectedOutputs: ['Grounded explanation with Answer/Evidence/Confidence/Next Steps'],
    task: 'forecast',
  },
  recommendation: {
    id: 'recommendation',
    version: PROMPT_VERSION,
    purpose: 'Explain and rank deterministic recommendations.',
    description: 'Explanation of engine-produced recommendations; never invents new ones.',
    expectedInputs: ['GroundedContext (recommendation focus)'],
    expectedOutputs: ['Grounded explanation with confidence basis'],
    task: 'recommendation',
  },
  report: {
    id: 'report',
    version: PROMPT_VERSION,
    purpose: 'Explain the executive report at a glance.',
    description: 'Summarizes the already-computed report; no new figures.',
    expectedInputs: ['GroundedContext (report focus)'],
    expectedOutputs: ['Grounded summary with cited figures'],
    task: 'report',
  },
});

export function getPromptDescriptor(task: PromptTask): PromptDescriptor {
  return PROMPT_REGISTRY[task];
}
