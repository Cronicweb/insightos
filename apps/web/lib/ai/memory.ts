// InsightOS — Conversation memory (Phase 3, §15.2 / §13.3).
// Session-scoped, in-memory, tab-lifetime. Stores REFERENCES to deterministic analysis objects
// (sourcePaths, focus, chart ids) rather than replaying prior prose. Follow-ups reuse structured
// context via contextDelta instead of resending whole prompts.

import type { ContextFocus, ConversationSession, ConversationTurn, GroundedContext } from './types';

const sessions = new Map<string, ConversationSession>();

function key(analysisKey: string): string {
  return analysisKey;
}

export function getSession(analysisKey: string): ConversationSession {
  const k = key(analysisKey);
  let s = sessions.get(k);
  if (!s) {
    s = { id: `conv-${Date.now().toString(36)}`, analysisKey, turns: [] };
    sessions.set(k, s);
  }
  return s;
}

const MAX_TURNS = 24;

export function recordTurn(analysisKey: string, turn: ConversationTurn): ConversationSession {
  const s = getSession(analysisKey);
  const turns = [...s.turns, turn].slice(-MAX_TURNS);
  const next = { ...s, turns };
  sessions.set(key(analysisKey), next);
  return next;
}

export function clearSession(analysisKey: string): void {
  sessions.delete(key(analysisKey));
}

/**
 * Build a contextDelta for a follow-up: reuse the prior grounded context and carry forward only
 * the referenced sourcePaths + the new focus, rather than rebuilding/resending everything (§15.2).
 */
export function contextDelta(
  analysisKey: string,
  prior: GroundedContext,
  newFocus: ContextFocus,
): GroundedContext {
  const s = getSession(analysisKey);
  const priorRefs = new Set<string>();
  for (const t of s.turns) for (const r of t.evidenceRefs ?? []) priorRefs.add(r);
  return {
    ...prior,
    focus: newFocus,
    provenance: Array.from(new Set([...(prior.provenance ?? []), ...priorRefs])),
  };
}
