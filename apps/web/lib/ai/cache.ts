// InsightOS — AI response cache + token estimation (Phase 2/3, §13.4).
// Avoids repeated provider calls; keys by analysis hash + focus + prompt version + model/temp.
// In-memory, tab-scoped, LRU-bounded.

import type { AICacheKeyParts, GroundedAnswer } from './types';

/** Cheap, deterministic string hash (FNV-1a) for cache keys / analysis hashing. */
export function hashString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Heuristic token estimate (~4 chars/token). No network. */
export function estimateTokens(payload: unknown): number {
  const s = typeof payload === 'string' ? payload : JSON.stringify(payload ?? '');
  return Math.ceil(s.length / 4);
}

export function cacheKey(parts: AICacheKeyParts): string {
  return hashString(
    [parts.analysisHash, parts.focusKey, parts.promptVersion, parts.question ?? '', parts.model, parts.temperature].join('|'),
  );
}

const MAX_ENTRIES = 50;
const store = new Map<string, GroundedAnswer>();

export function getCachedAnswer(key: string): GroundedAnswer | undefined {
  const v = store.get(key);
  if (v) {
    // LRU touch
    store.delete(key);
    store.set(key, v);
  }
  return v;
}

export function setCachedAnswer(key: string, answer: GroundedAnswer): void {
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value as string | undefined;
    if (oldest) store.delete(oldest);
  }
  store.set(key, answer);
}

export function clearAnswerCache(): void {
  store.clear();
}
