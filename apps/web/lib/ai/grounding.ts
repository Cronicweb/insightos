// InsightOS AI layer — grounding guard.
// Verifies every AI answer against the supplied grounded context BEFORE it reaches the UI.
// See docs/ai-architecture.md §6.

import type { GroundedAnswer, GroundedContext, GroundedFact } from "./types";

/** Extract numeric tokens from free text for verification against context facts. */
function numbersIn(text: string): number[] {
  const matches = text.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? [];
  return matches
    .map((m) => Number(m.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));
}

function factNumbers(facts: GroundedFact[]): number[] {
  const out: number[] = [];
  for (const f of facts) {
    if (typeof f.value === "number" && Number.isFinite(f.value)) out.push(f.value);
    else if (typeof f.value === "string") {
      for (const n of numbersIn(f.value)) out.push(n);
    }
  }
  return out;
}

/** True if `n` matches any context number within a small relative tolerance. */
function isGrounded(n: number, allowed: number[]): boolean {
  return allowed.some((a) => {
    if (a === n) return true;
    const denom = Math.max(Math.abs(a), Math.abs(n), 1);
    return Math.abs(a - n) / denom < 0.01;
  });
}

/**
 * Verify that every number in an answer exists in the grounded context.
 * Returns the list of ungrounded numbers (empty => fully grounded).
 */
export function findUngroundedNumbers(answer: string, context: GroundedContext): number[] {
  const allowed = factNumbers(context.facts);
  return numbersIn(answer).filter((n) => !isGrounded(n, allowed));
}

/**
 * Wrap raw provider text into a guarded GroundedAnswer.
 * Under strict grounding, an answer containing ungrounded numbers is flagged and replaced
 * with a safe fallback that points the user to the deterministic evidence.
 */
export function buildGuardedAnswer(
  raw: string,
  context: GroundedContext,
  provider: string,
  strict: boolean,
): GroundedAnswer {
  const ungrounded = findUngroundedNumbers(raw, context);
  const grounded = ungrounded.length === 0;

  if (strict && !grounded) {
    return {
      ok: true,
      grounded: false,
      provider,
      answer:
        "The generated explanation referenced figures that are not present in the " +
        "deterministic analysis, so it was withheld. Please rely on the evidence below, " +
        "which comes directly from the engine.",
      evidence: context.facts,
      confidence: { level: "low", basis: "ungrounded claim suppressed by strict grounding" },
      nextSteps: ["Review the supporting evidence", "Open the SQL/root-cause panel for detail"],
    };
  }

  return {
    ok: true,
    grounded,
    provider,
    answer: raw.trim(),
    evidence: context.facts,
    confidence: {
      level: grounded ? "high" : "medium",
      basis: grounded ? "all figures traced to engine artifacts" : "grounding not strictly enforced",
    },
    nextSteps: [],
  };
}
