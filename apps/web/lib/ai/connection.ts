// InsightOS AI layer - one connection test for every provider.
//
// The Settings panel and the Analyst readiness check both need "is this
// configuration actually usable?" without knowing which vendor is selected.
// Groq keeps its original bespoke implementation; everything else routes
// through the shared spec transport. Neither path sends dataset content.
import type { AISettings } from './types';
import { testGroqConnection, type ConnectionResult } from './providers/groq';
import { testChatConnection } from './providers/chat';
import { OPENAI_SPEC } from './providers/openai';
import { GEMINI_SPEC } from './providers/gemini';
import { CLAUDE_SPEC } from './providers/claude';
import { OLLAMA_SPEC } from './providers/ollama';

const SPECS = {
  openai: OPENAI_SPEC,
  gemini: GEMINI_SPEC,
  claude: CLAUDE_SPEC,
  ollama: OLLAMA_SPEC,
} as const;

/** True when the provider is a local runtime and therefore needs no API key. */
export function providerNeedsKey(providerId: string): boolean {
  const spec = SPECS[providerId as keyof typeof SPECS];
  return spec ? spec.needsKey : true;
}

/** The vendor default endpoint, shown as the placeholder in AI Settings. */
export function defaultBaseUrlFor(providerId: string): string {
  return SPECS[providerId as keyof typeof SPECS]?.defaultBaseUrl ?? '';
}

export function baseUrlHintFor(providerId: string): string {
  return SPECS[providerId as keyof typeof SPECS]?.baseUrlHint ?? '';
}

export function testConnection(settings: AISettings): Promise<ConnectionResult> {
  const spec = SPECS[settings.providerId as keyof typeof SPECS];
  return spec ? testChatConnection(spec, settings) : testGroqConnection(settings);
}

export type { ConnectionResult };
