// InsightOS AI layer — public barrel.
// Additive, inert unless AISettings.enabled. Consumers depend ONLY on these exports,
// never on a concrete provider. See docs/ai-architecture*.md.
//
// UI RULE (§18): application code should talk to AnalystFacade for AI lifecycle concerns,
// not to providers/parsers/caches directly.
// POLICY (§28): every question is classified LOCALLY before any provider call; unsupported and
// injection attempts are refused without an API call.

export * from './types';
export * from './provider';
export * from './registry';
export * from './context';
export * from './grounding';
export * from './prompts';
export * from './settings';
export * from './cache';
export * from './memory';
export * from './policy';
export * from './assistant';
export * from './semantic/model';
export * from './semantic/cache';
export * from './investigation/graph';
export * from './investigation/bookmarks';
export * from './analyst';
export * from './validation';
export * from './compare';
export * from './replay';
export * from './hooks';
export * from './facade';

import type { AIProvider } from './provider';
import { resolveProvider } from './provider';
import { PROVIDER_REGISTRY } from './registry';
import { loadAISettings } from './settings';
import type { AISettings } from './types';

/**
 * Convenience: resolve the active provider from current settings.
 * Returns a NullProvider when AI is disabled/unconfigured, so callers are always safe.
 */
export function getActiveProvider(settings?: AISettings): AIProvider {
  const s = settings ?? loadAISettings();
  return resolveProvider(s, PROVIDER_REGISTRY);
}
