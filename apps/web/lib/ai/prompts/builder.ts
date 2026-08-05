// InsightOS — Prompt Builder (§31). The SINGLE component responsible for assembling every AI
// request. Neither UI components nor providers construct prompts. Additive: does not modify the
// Analyst Facade, providers, Context Builder, or existing prompt templates.
//
// Composition (fixed order, §31.2):
//   1 Internal System Prompt  2 Task Prompt  3 Grounded Context
//   4 Conversation Memory     5 Current Page Context  6 User Question

import type { ConversationTurn, GroundedContext } from '../types';
import { INTERNAL_SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION, assertSystemPromptIntegrity } from './system';
import { getPromptDescriptor, type PromptTask } from './registry';
import { PROMPT_VERSION } from '../prompts';
import { classifyIntent, type Classification } from '../policy';

/** Active InsightOS module injected as page context (§31.5). */
export type PageContext =
  | 'Overview'
  | 'Root Cause'
  | 'Forecast'
  | 'Recommendations'
  | 'Executive Report'
  | 'Insight Analyst'
  | 'SQL Explorer'
  | 'Investigation Graph'
  | 'Decision Replay';

export interface BuildPromptInput {
  task: PromptTask;
  context: GroundedContext;
  question?: string;
  memory?: ConversationTurn[];
  page?: PageContext;
  /** Task-specific instruction text (from the registry/templates layer). */
  taskInstruction: string;
  /** When false, skips the local scope/injection re-check (still runs by default). */
  enforcePolicy?: boolean;
  /** Strict mode for the policy re-check (default true). */
  strict?: boolean;
}

/** Provider-agnostic finalized prompt package (§31.6). Providers serialize this; never build prompts. */
export interface PromptPackage {
  system: string;
  task: string;
  context: string;
  memory: string;
  page: string;
  question: string;
  meta: {
    task: PromptTask;
    systemVersion: string;
    registryVersion: string;
    page?: PageContext;
    composedAt: number;
  };
}

export class PromptCompositionError extends Error {}
export class PromptPolicyRefusal extends Error {
  constructor(public classification: Classification) {
    super('Prompt refused by AI Operating Policy (§28).');
  }
}

function summarizeMemory(memory: ConversationTurn[] = []): string {
  if (!memory.length) return '';
  // Compact, object-referencing memory: role + text + cited sourcePaths (no raw data).
  return memory
    .slice(-6)
    .map((t) => `${t.role}: ${t.text}${t.evidenceRefs?.length ? ` [refs: ${t.evidenceRefs.join(', ')}]` : ''}`)
    .join('\n');
}

/**
 * Assemble a finalized PromptPackage (§31). Enforces internal system-prompt integrity, runs the
 * §28 policy re-check on the user question, and validates composition. Throws PromptPolicyRefusal
 * for out-of-scope/injection (no package is produced) and PromptCompositionError on invalid input.
 */
export function buildPrompt(input: BuildPromptInput): PromptPackage {
  const {
    task,
    context,
    question = '',
    memory,
    page,
    taskInstruction,
    enforcePolicy = true,
    strict = true,
  } = input;

  // §31.7 integrity: the internal system prompt is non-overridable and must be intact.
  assertSystemPromptIntegrity(INTERNAL_SYSTEM_PROMPT);

  // §31.7 injection/scope re-check BEFORE any provider call. Only applies when a user question
  // is present (explain/rewrite tasks may have none).
  if (enforcePolicy && question.trim()) {
    const verdict = classifyIntent(question, strict);
    if (!verdict.supported) throw new PromptPolicyRefusal(verdict);
  }

  // §31.7 composition validation.
  if (!taskInstruction || !taskInstruction.trim()) {
    throw new PromptCompositionError('Missing task instruction.');
  }
  const descriptor = getPromptDescriptor(task); // throws if unknown task
  if (!context || !Array.isArray(context.facts)) {
    throw new PromptCompositionError('Grounded context is required.');
  }

  return {
    system: INTERNAL_SYSTEM_PROMPT,
    task: `TASK[${descriptor.id}]: ${taskInstruction}`,
    context: JSON.stringify({ datasetLabel: context.datasetLabel, focus: context.focus, facts: context.facts, provenance: context.provenance, redactionNote: context.redactionNote }),
    memory: summarizeMemory(memory),
    page: page ? `Current InsightOS module: ${page}.` : '',
    question: question.trim(),
    meta: {
      task,
      systemVersion: SYSTEM_PROMPT_VERSION,
      registryVersion: PROMPT_VERSION,
      page,
      composedAt: Date.now(),
    },
  };
}

/**
 * Provider-agnostic message serialization (§31.6). Adapters (Groq/OpenAI/Gemini/Claude/Ollama)
 * consume this; switching providers never requires prompt-text changes elsewhere.
 */
export function toMessages(pkg: PromptPackage): Array<{ role: 'system' | 'user'; content: string }> {
  const userParts = [pkg.task, pkg.page, pkg.memory ? `Conversation so far:\n${pkg.memory}` : '', `Grounded context:\n${pkg.context}`, pkg.question ? `Question: ${pkg.question}` : '']
    .filter(Boolean)
    .join('\n\n');
  return [
    { role: 'system', content: pkg.system },
    { role: 'user', content: userParts },
  ];
}
