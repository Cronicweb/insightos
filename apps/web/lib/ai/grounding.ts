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


// ---------------------------------------------------------------------------
// Column grounding.
//
// A number that is not in the context is one failure mode; asking about a
// *dimension the dataset does not have* is the other, and it is the one users
// hit constantly. "Why did revenue fall?" against an orders-and-rating extract
// used to return the same opaque refusal as a hallucinated figure. Naming the
// gap turns a dead end into a next step.
// ---------------------------------------------------------------------------

/** Words that carry no schema meaning, so they must never be reported as a missing column. */
const QUESTION_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "these", "those", "into", "over", "under",
  "what", "why", "how", "when", "where", "which", "who", "whom", "does", "did", "was", "were",
  "are", "is", "be", "been", "being", "has", "have", "had", "can", "could", "would", "should",
  "will", "shall", "may", "might", "must", "about", "than", "then", "there", "here", "any", "all",
  "some", "most", "more", "less", "much", "many", "each", "per", "our", "its", "their", "his",
  "her", "you", "your", "yours", "mine", "ours", "not", "but", "out", "off", "top", "bottom",
  "show", "give", "tell", "explain", "compare", "find", "list", "rank", "break", "down", "across",
  "between", "versus", "vs", "against", "change", "changed", "changes", "increase", "increased",
  "decrease", "decreased", "drop", "dropped", "fall", "fell", "rise", "rose", "grow", "grew",
  "trend", "trends", "driver", "drivers", "cause", "causes", "reason", "reasons", "impact",
  "significant", "anomaly", "anomalies", "outlier", "outliers", "forecast", "forecasts",
  "quality", "data", "dataset", "row", "rows", "column", "columns", "value", "values",
  "total", "sum", "average", "avg", "mean", "median", "count", "share", "percent", "percentage",
  "rate", "ratio", "growth", "last", "first", "next", "previous", "prior", "recent", "period",
  "periods", "month", "months", "week", "weeks", "day", "days", "year", "years", "quarter",
  "quarters", "time", "date", "over", "during", "since", "before", "after", "still", "also",
  "best", "worst", "high", "highest", "low", "lowest", "good", "bad", "better", "worse",
  "analysis", "analyse", "analyze", "insight", "insights", "report", "summary", "metric",
  "metrics", "kpi", "kpis", "please", "give", "want", "need", "like", "look", "see",
]);

/** Normalises "Total_Revenue ($)" and "total revenue" to the same comparable token. */
function normaliseTerm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Very small singulariser - enough to match "orders" against an "order" column. */
function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/** Every token a known column or fact label could plausibly be referred to by. */
function knownTokens(context: GroundedContext): Set<string> {
  const out = new Set<string>();
  const add = (raw: string) => {
    const whole = normaliseTerm(raw);
    if (whole) {
      out.add(whole);
      out.add(singular(whole));
    }
    for (const part of raw.split(/[^A-Za-z0-9]+/)) {
      const token = normaliseTerm(part);
      if (token.length >= 3) {
        out.add(token);
        out.add(singular(token));
      }
    }
  };
  for (const c of context.availableColumns ?? []) add(c);
  for (const f of context.facts) add(f.label);
  add(context.datasetLabel);
  return out;
}

/**
 * Terms a question asked for that match no discovered column and no context fact.
 *
 * Deliberately conservative: only alphabetic words of four characters or more
 * that are not analytical vocabulary are considered, because a false "missing
 * column" claim is worse than saying nothing.
 */
export function findMissingColumnTerms(question: string, context: GroundedContext): string[] {
  if (!(context.availableColumns ?? []).length) return [];
  const known = knownTokens(context);
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const word of question.match(/[A-Za-z][A-Za-z_]{3,}/g) ?? []) {
    const token = normaliseTerm(word);
    if (!token || QUESTION_STOPWORDS.has(token) || QUESTION_STOPWORDS.has(singular(token))) continue;
    if (known.has(token) || known.has(singular(token))) continue;
    // A term is also "known" if it is contained in (or contains) a column token,
    // so "revenues" matches a "revenue_usd" column rather than being reported.
    let related = false;
    for (const candidate of Array.from(known)) {
      if (candidate.length >= 4 && (candidate.includes(token) || token.includes(candidate))) {
        related = true;
        break;
      }
    }
    if (related) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    missing.push(word.replace(/_/g, " "));
    if (missing.length === 4) break;
  }
  return missing;
}

/** Human-readable list: "Orders, Rating and Region". */
function joinList(items: string[], limit = 12): string {
  const shown = items.slice(0, limit);
  const tail = items.length > limit ? ` (and ${items.length - limit} more)` : "";
  if (shown.length === 0) return "";
  if (shown.length === 1) return shown[0] + tail;
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}${tail}`;
}

/**
 * The message shown when strict grounding withholds an answer.
 *
 * Says what was asked for, what exists, and what to do next - the three things
 * the previous single generic sentence left the reader to guess.
 */
export function suppressionMessage(context: GroundedContext, ungrounded: number[]): string {
  const question = context.focus.kind === "question" ? context.focus.text : "";
  const columns = context.availableColumns ?? [];
  const missing = question ? findMissingColumnTerms(question, context) : [];

  if (missing.length && columns.length) {
    return (
      `Strict Grounding withheld this answer. Your question asked about ` +
      `${joinList(missing.map((m) => `"${m}"`))}, which ${missing.length === 1 ? "is" : "are"} not ` +
      `${missing.length === 1 ? "a column" : "columns"} in this dataset. ` +
      `This dataset contains: ${joinList(columns)}. ` +
      `Rephrase the question using those columns, or upload a dataset that includes ` +
      `${joinList(missing.map((m) => `"${m}"`))}.`
    );
  }

  if (ungrounded.length) {
    return (
      `Strict Grounding withheld this answer because it contained ` +
      `${ungrounded.length === 1 ? "a figure" : "figures"} the deterministic analysis never produced ` +
      `(${joinList(ungrounded.map((n) => String(n)), 5)}). ` +
      `Every number shown by InsightOS has to trace back to the engine, so the text was dropped ` +
      `rather than shown alongside evidence it contradicts. The verified evidence is below.` +
      (columns.length ? ` This dataset contains: ${joinList(columns)}.` : "")
    );
  }

  return (
    "Strict Grounding withheld this answer because it could not be traced back to the " +
    "deterministic analysis. Please rely on the evidence below, which comes directly from the engine." +
    (columns.length ? ` This dataset contains: ${joinList(columns)}.` : "")
  );
}

/**
 * Wrap raw provider text into a guarded GroundedAnswer.
 * Under strict grounding, an answer containing ungrounded numbers is flagged and replaced
 * with a safe fallback that points the user to the deterministic evidence.
 */
/**
 * Next steps shown alongside a suppressed answer. When the question named a
 * column the dataset does not have, the first step says so explicitly.
 */
function nextStepsFor(ctx: GroundedContext): string[] {
  const question = ctx.focus.kind === "question" ? ctx.focus.text : "";
  const missing = question ? findMissingColumnTerms(question, ctx) : [];
  const steps = ["Review the supporting evidence", "Open the SQL/root-cause panel for detail"];
  if (missing.length) {
    steps.unshift("Ask the same question about a column this dataset actually has");
  }
  return steps;
}

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
      answer: suppressionMessage(context, ungrounded),
      evidence: context.facts,
      confidence: { level: "low", basis: "ungrounded claim suppressed by strict grounding" },
      nextSteps: nextStepsFor(context),
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
