// InsightOS — Session-scoped semantic model cache (Phase 2, §14.5).
// Ensures semantic parsing runs ONCE per uploaded dataset; all later AI interactions reuse it.
// In-memory only, tab-lifetime; never persisted to disk (privacy model).

import type { SemanticModel } from './model';

const cache = new Map<string, SemanticModel>();

export function getCachedSemanticModel(analysisKey: string): SemanticModel | undefined {
  return cache.get(analysisKey);
}

export function setCachedSemanticModel(model: SemanticModel): void {
  cache.set(model.analysisKey, model);
}

export function hasCachedSemanticModel(analysisKey: string): boolean {
  return cache.has(analysisKey);
}

/** Clear on new upload for the same key, or on tab teardown. */
export function clearSemanticModel(analysisKey: string): void {
  cache.delete(analysisKey);
}

export function clearAllSemanticModels(): void {
  cache.clear();
}
