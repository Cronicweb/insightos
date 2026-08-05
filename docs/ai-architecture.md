# InsightOS — AI Architecture

> **Status:** Design specification (no runtime behavior change).
> **Scope:** Defines the additive AI layer for InsightOS. This document is the contract that all
> subsequent AI code must satisfy. It is written to be reviewed and approved *before* implementation.
>
> **Amendments:** §13 (Addendum v2) extends this specification with ten additional architectural
> requirements and the AI Trace feature. Where §13 refines an earlier section, §13 governs.

---

## 0. Prime directive

InsightOS is an **Explainable Analytics Platform**, not an AI analytics platform. The deterministic
analytics engine is, and remains, the **single source of truth**.

AI in InsightOS exists only to:

- understand datasets (semantic parsing of *metadata*),
- explain analytics that the deterministic engine already produced,
- answer user questions grounded in those produced artifacts,
- improve natural-language phrasing (optional executive rewrite).

AI **must never**:

- invent or alter a statistic, KPI, anomaly, root cause, forecast value, or recommendation;
- write into any deterministic result object;
- receive the full raw dataset for reasoning;
- become a hard dependency of any existing feature.

Every AI capability is **additive, feature-flagged, and off by default**. With all AI flags off,
InsightOS behaves **byte-identically** to the current production build, and the GitHub Pages demo
deploys and runs unchanged.

---

## 1. Layering overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  UI (Next.js, static export)                                          │
│  existing panels ............................. unchanged              │
│  + Insight Analyst panel (new, flagged)                              │
│  + AI Settings page (new, flagged)                                   │
└───────────────▲───────────────────────────────▲──────────────────────┘
                │ reads deterministic artifacts  │ grounded Q&A / explain
                │                                 │
┌───────────────┴─────────────────┐   ┌───────────┴──────────────────────┐
│  Deterministic Analytics Engine │   │  AI Layer (new, additive)         │
│  (Python core + TS browser)     │   │  ai/provider.ts   (interface)     │
│  - profiling, quality, roles    │   │  ai/providers/*   (groq default)  │
│  - domain, KPI, root cause      │   │  ai/context.ts    (context builder)│
│  - forecast, recommendations    │   │  ai/prompts/*     (prompt registry)│
│  - governance, privacy          │   │  ai/grounding.ts  (guard/validate) │
│  SINGLE SOURCE OF TRUTH         │   │  semantic/model.ts(semantic graph) │
└───────────────▲─────────────────┘   └───────────────────────────────────┘
                │
                │ (one narrow, optional, metadata-only hook)
        ┌───────┴─────────────────────────────┐
        │  AI Semantic Parser (new, flagged)  │
        │  inputs: metadata ONLY              │
        └─────────────────────────────────────┘
```

The AI layer sits **beside** the engine, never inside it. Data flows **engine → AI**, never
**AI → engine numerics**. The one exception is the Semantic Parser, described in §4, which is
strictly bounded to metadata and never sees analytics or raw rows.

---

## 2. The grounding contract

> **Rule G1 — Structured artifacts only.** After the semantic parsing step, every AI interaction
> receives **only** structured artifacts produced by the deterministic engine — never raw rows,
> never the uploaded file.

The artifacts are exactly the fields of the existing `Analysis` contract in
`apps/web/lib/types.ts`:

| Artifact (field on `Analysis`) | Type | Purpose to AI |
| --- | --- | --- |
| `dataset`, `story`, `rows`, `columns` | scalars | dataset framing |
| `schema` | `DatasetSchema` | column names, types, roles (post-parse) |
| `quality` | `QualityReport` | quality dimensions/issues to explain |
| `domain` | `DomainDetection` | detected domain + confidence |
| `scorecard` | `Scorecard` | KPI values, period-over-period |
| `anomalies` | `AnomalyReport` | anomalies to explain |
| `root_causes` | `RootCauseTree[]` | drivers, contributions, p-values, tests |
| `forecasts` | `Forecast[]` | forecast points, intervals, caveats |
| `recommendations` | `RecommendationSet` | recommendations + evidence + rejected alternatives |
| `report` | `ExecutiveReport` | executive summary sections |
| `governance?` | `GovernanceReport` | trust/readiness/confidence caps |
| `privacy?` | `PrivacyReport` | sensitive fields already masked |
| `charts`, `narratives` | specs | chart context for "explain this chart" |
| `ledger?`, `limitations?`, `case_study?` | blocks | supporting evidence |

> **Rule G2 — Masked in, masked out.** The context builder consumes artifacts *after* the existing
> privacy layer (`privacy/detector.py` / `engine/privacy.ts`) has masked sensitive fields. The AI
> never sees an unmasked email, card number, phone, or national ID. Row-level values are only ever
> present in already-masked, aggregate form.

> **Rule G3 — No numeric authorship.** AI output is **text and references**, not values. When an
> answer cites a number, that number is copied verbatim from an artifact and carries a pointer back
> to its source field. The grounding guard (§6) rejects any answer that introduces a numeric claim
> not present in the supplied context.

> **Rule G4 — Determinism preserved.** No AI call is on the analytics critical path. If a provider
> is unconfigured, offline, rate-limited, or returns an error, the deterministic result is displayed
> exactly as today; the AI panel degrades to an honest empty/disabled state.

---

## 3. AI Provider abstraction (`apps/web/lib/ai/provider.ts`)

The rest of InsightOS must **never** depend on a specific AI vendor. All access goes through one
interface. The default implementation is **Groq**; `OpenAI`, `Gemini`, `Claude`, and `Ollama` are
future implementations of the same interface.

```ts
// apps/web/lib/ai/provider.ts  (specification — implemented in Phase 0)

/** Provider-agnostic capabilities. All methods are async and side-effect free. */
export interface AIProvider {
  readonly id: string;                 // "groq" | "openai" | "gemini" | "claude" | "ollama"
  readonly label: string;

  /** Metadata-only semantic understanding. See §4. Input is NEVER raw rows. */
  semanticUnderstanding(input: SemanticParseInput): Promise<SemanticModelDraft>;

  /** Explain an existing deterministic artifact in plain language. Grounded. */
  explainInsight(request: ExplainRequest): Promise<GroundedAnswer>;

  /** Answer a user question using ONLY the supplied grounded context. */
  answerQuestion(request: QuestionRequest): Promise<GroundedAnswer>;

  /** Optional: rewrite an already-computed executive report for tone. Non-authoritative. */
  rewriteExecutiveReport(request: RewriteRequest): Promise<string>;

  /** Translate a natural-language question into SQL for local DuckDB-WASM execution. */
  generateSQL(request: SqlGenRequest): Promise<GeneratedSql>;
}

export interface AISettings {
  enabled: boolean;                    // master flag — default false
  providerId: string;                  // default "groq"
  model: string;
  temperature: number;                 // default low (e.g. 0.2) for stability
  strictGrounding: boolean;            // default true — reject ungrounded claims
  enableExecutiveRewrite: boolean;     // default false
  enableSemanticParser: boolean;       // default false — see §4
  apiKey?: string;                     // browser-only (localStorage), NEVER committed
}
```

### Provider resolution
- A `resolveProvider(settings): AIProvider` factory returns the configured implementation.
- Unknown/disabled → a `NullProvider` whose methods resolve to a disabled `GroundedAnswer`
  (so callers never branch on "is AI on?" — they always get a valid, safe object).

### Key handling
- The API key is entered by the user on the **AI Settings** page and stored **only** in
  `localStorage` in the browser. It is never bundled, never committed, never sent anywhere except
  directly to the user-chosen provider endpoint from the user's own browser.

---

## 4. The one architectural change: AI Semantic Parser (metadata-only)

This is the **single** place AI touches the ingestion path, and it is tightly bounded.

### 4.1 What it may see (allow-list)
```ts
export interface SemanticParseInput {
  columns: Array<{
    name: string;                 // original column name, e.g. "txn_amt"
    inferredType: string;         // from deterministic profiler
    sampleValues: string[];       // small masked sample (<= N, privacy-filtered)
    summary: {                    // deterministic summary statistics only
      nullFraction?: number;
      distinctCount?: number;
      min?: number | string;
      max?: number | string;
      mean?: number;
      topCategories?: Array<{ value: string; count: number }>;
    };
  }>;
  rowCount: number;
  tableName: string;
}
```

### 4.2 What it may NEVER see (deny-list)
- The full dataset or any full column.
- Unmasked sensitive values (sample values pass through the privacy filter first).
- Any computed analytics (KPIs, root causes, recommendations) — those don't exist yet at this stage.

### 4.3 What it produces
```ts
export interface SemanticModelDraft {
  domainHint?: string;                 // advisory only
  columns: Array<{
    name: string;                      // original name (unchanged key)
    conceptLabel?: string;             // e.g. "Transaction Amount"
    roleHint?: "measure" | "dimension" | "time" | "identifier";
    aliasOf?: string;                  // canonical concept, e.g. "Revenue"
    confidence: number;                // REQUIRED — see §13.5
  }>;
}
```

### 4.4 The hard boundary after parsing
```
upload → deterministic profiler → [AI Semantic Parser (metadata-only, optional)]
       → semantic model (advisory) → DETERMINISTIC ENGINE (unchanged)
       → analytics artifacts → [AI explain / Q&A / rewrite]  (grounded, §2)
```

- The Semantic Parser output is **advisory**. It proposes concept labels/aliases; it does **not**
  compute anything. Role/domain resolution still runs through the existing deterministic
  `roles.ts` / `domain.ts`. If the flag is off, the engine uses its current deterministic inference
  exactly as today.
- After this step, **all** analytics, statistics, KPI computation, root-cause analysis, forecasting,
  and recommendations remain fully deterministic and byte-identical to the current engine.
- All later AI interactions consume **only** the structured analysis artifacts (§2), never the
  dataset again.

> **Rule S1 — Advisory, not authoritative.** The semantic draft may relabel/alias for readability
> and may nudge which deterministic rule set applies (e.g. picking the retail plugin), but it can
> never fabricate a measure that the profiler did not detect, and a human/deterministic check can
> override it. Deterministic detection remains the fallback and the source of truth for computation.

---

## 5. AI Context Builder (`apps/web/lib/ai/context.ts`)

A pure function that assembles the minimal grounded payload for a given AI task from an `Analysis`
object. It **selects and trims**; it never invents. See §13.1 for the mandatory single-entry-point rule.

```ts
export interface GroundedContext {
  datasetLabel: string;
  focus: ContextFocus;                 // which artifact(s) the task is about
  facts: GroundedFact[];               // flat list: { id, label, value, sourcePath }
  provenance: string[];                // e.g. ["root_causes[0].root.children[2]"]
  confidenceNotes?: string[];          // from governance/quality
  redactionNote: string;               // states masking already applied
}

export function buildContext(analysis: Analysis, focus: ContextFocus): GroundedContext;
```

Design rules:
- Each `GroundedFact` carries a `sourcePath` pointer into the `Analysis` object so answers are
  traceable and the guard (§6) can verify every cited number.
- Context is **task-scoped** (explain-this-KPI builds a small context; whole-report Q&A a larger
  one) to keep payloads small and within provider limits.
- The builder runs client-side; no artifact leaves the browser except to the user's chosen provider.

---

## 6. Grounding guard (`apps/web/lib/ai/grounding.ts`)

Post-processes every `GroundedAnswer` before it reaches the UI:

- **Numeric verification:** every number in the answer must match a `value` present in the supplied
  `GroundedContext.facts` (within formatting tolerance). Unmatched numbers → answer flagged
  `ungrounded` and, under `strictGrounding`, suppressed with a safe fallback.
- **Citation enforcement:** answers must reference at least one `sourcePath` when making a claim.
- **Shape enforcement:** Insight Analyst answers must contain the four required sections
  (Answer / Evidence / Confidence / Next Steps).

```ts
export interface GroundedAnswer {
  ok: boolean;
  answer: string;
  evidence: GroundedFact[];
  confidence: { level: "high" | "medium" | "low"; basis: string };
  nextSteps: string[];
  grounded: boolean;                   // false → guard caught an ungrounded claim
  provider: string;
  trace?: AITrace;                     // §13.11 — reasoning sources + provider metadata
}
```

---

## 7. Prompt management (`apps/web/lib/ai/prompts/`)

- Prompts are **versioned, static templates** kept out of component code, one file per task
  (`semantic-parse.ts`, `explain-insight.ts`, `answer-question.ts`, `rewrite-report.ts`,
  `generate-sql.ts`). See §13.2 for the mandatory per-module split and version stamping.
- Every template begins with the same **system preamble** stating the prime directive: *use only
  provided context; never invent numbers, KPIs, or recommendations; cite sources; if unknown, say so.*
- Templates request **structured JSON** for machine-consumed tasks (semantic parse, SQL gen) and
  return prose only for human-facing explanation tasks. Semantic parsing returns **JSON only, never
  prose** (per brief F4).
- Prompt inputs are always a `GroundedContext` or `SemanticParseInput` — never a raw file.

---

## 8. AI-assisted semantic parsing vs. deterministic analytics

| Aspect | AI Semantic Parsing (§4) | Deterministic Analytics (engine) |
| --- | --- | --- |
| Input | Metadata only (names, types, sample values, summary stats) | Full dataset via DuckDB-WASM / pandas |
| Output | Advisory concept labels/aliases (JSON) | Numbers: KPIs, root causes, forecasts, recommendations |
| Authority | Advisory; deterministic fallback wins | **Single source of truth** |
| Determinism | Not required (labels only) | **Required, reproducible, auditable** |
| Runs when | `enableSemanticParser` flag on | Always |
| Failure mode | Fall back to deterministic roles/domain | N/A — always runs |
| Sees raw data? | No (metadata sample only) | Yes (locally, in-browser) |
| Sees analytics? | No (runs before analytics) | Produces analytics |

The two never overlap: the parser shapes *how columns are named/understood*; the engine decides
*what the numbers are*. Explanation AI (§2–§6) only ever describes the engine's numbers.

---

## 9. Feature flags & defaults

All flags live in `AISettings`, persisted in browser `localStorage`, all default **off/safe**:

| Flag | Default | Effect when off |
| --- | --- | --- |
| `enabled` | `false` | Entire AI layer inert; UI hides AI panels; app == current build |
| `enableSemanticParser` | `false` | Deterministic roles/domain only (current behavior) |
| `enableExecutiveRewrite` | `false` | Report shown verbatim from engine (current behavior) |
| `strictGrounding` | `true` | (Safety on by default) ungrounded claims suppressed |

> **Invariant D1 — Off == today.** With `enabled=false`, no AI module is imported at runtime,
> no network call is made, and every existing panel, chart, tree, report, and demo dataset behaves
> exactly as it does now.

---

## 10. Deployment & demo-mode invariants

- **Static export preserved.** The AI layer is pure client-side TypeScript. No server, no API route,
  no build step change that affects the Next.js static export or `NEXT_PUBLIC_DATA_MODE=static`.
- **GitHub Pages unchanged.** The `pages.yml` workflow, demo regeneration, and `.nojekyll` output
  are untouched. AI features require a user-supplied key at runtime and are absent from the demo
  path unless a user opts in on their own device.
- **Demo mode always works.** The bundled demo datasets and their pre-computed deterministic
  analyses render with zero AI dependency.
- **No new heavy dependencies.** The provider layer uses the browser `fetch` API against the user's
  chosen endpoint; no vendor SDK is required to ship the default Groq implementation.

---

## 11. Backward-compatibility checklist (enforced in every AI PR)

- [ ] No existing file's public behavior changes with AI flags off.
- [ ] No existing type in `lib/types.ts` is removed or narrowed (only additive types introduced).
- [ ] No deterministic module (`statistics`, `root_cause`, `kpi`, `recommendation`, `forecast`,
      `quality`, `governance`, `privacy`) is modified in numeric behavior.
- [ ] Demo datasets untouched; demo analyses still regenerate identically in CI.
- [ ] `npm run typecheck`, `vitest`, `next build` all green; Python `pytest`/`ruff` untouched & green.
- [ ] GitHub Pages deploy succeeds; static export unaffected.
- [ ] No API key or secret committed.

---

## 12. Implementation roadmap (post-approval)

1. **Phase 0 — Scaffolding:** `ai/provider.ts` interface, `providers/groq.ts` default,
   `ai/context.ts`, `ai/grounding.ts`, `ai/prompts/*`, `semantic/model.ts` types. All inert. ✅
2. **Phase 1 — AI Settings page:** provider/model/temperature/grounding/rewrite/API-key UI,
   `localStorage` persistence, master flag. All AI off by default.
3. **Phase 2 — Semantic layer:** metadata-only parser wired as an advisory, flagged pre-step,
   with confidence scores and low-confidence confirmation (§13.5).
4. **Phase 3 — Insight Analyst:** grounded explain/Q&A panel (Answer/Evidence/Confidence/Next Steps)
   + conversation memory (§13.3) + AI Trace (§13.11) + NL→SQL executed locally in DuckDB-WASM.
5. **Phase 4 — Docs & accessibility:** README sections, ARIA/keyboard/44px audit on new components.

Each phase is a separate, reviewable, CI-green PR that upholds the checklist in §11.

---

## 13. Architecture Addendum v2 (authoritative)

This addendum incorporates ten additional architectural requirements plus the **AI Trace** feature.
It is binding on all AI implementation from Phase 1 onward. Where it refines an earlier section,
this addendum governs.

### 13.1 Single AI Context Builder — the only path to a provider
`AIContextBuilder` is the **sole** assembler of grounded context and the **sole** caller of any
`AIProvider`. **No UI component may import or call a provider directly.** Components call a thin
`useInsightAnalyst()` / service facade that internally: (a) builds context via `AIContextBuilder`,
(b) applies budgeting/caching (§13.4), (c) invokes the resolved provider, (d) runs the grounding
guard, (e) attaches the AI Trace (§13.11). Enforcement: an ESLint boundary rule (or a documented
review gate) forbids importing `ai/providers/*` outside `ai/`.

### 13.2 Prompt Registry — versioned, per-task modules
Prompts move into `apps/web/lib/ai/prompts/` as **one module per task**: `semantic.ts`, `analyst.ts`,
`explain.ts`, `sql.ts`, `rewrite.ts`. Each exports a template plus a `version` string and a shared
`PREAMBLE`. **Prompts must never be hardcoded inside providers or UI components.** Providers receive
already-composed `{system, user}` payloads from the registry. (Phase 0's single `prompts.ts` will be
split into this directory in Phase 3; the barrel keeps the public import path stable.)

### 13.3 Conversation Memory — session-scoped
Insight Analyst maintains a **session-scoped** (in-memory, tab-lifetime) conversation history so
follow-ups like *"Why?"*, *"Show evidence."*, *"Compare with last month."* resolve against prior
turns without rebuilding context from scratch.

```ts
export interface ConversationTurn {
  role: "user" | "analyst";
  text: string;
  focus?: ContextFocus;
  evidenceRefs?: string[];      // sourcePaths cited that turn
  ts: number;
}
export interface ConversationSession {
  id: string;                   // per analysis/tab
  analysisKey: string;
  turns: ConversationTurn[];    // capped (e.g. last N) to bound tokens
}
```

- Memory is **never persisted to disk** and dies with the tab (consistent with the privacy model).
- Only prior *turns and their cited sourcePaths* are carried forward — never raw data.
- A `contextDelta` strategy re-uses the previous `GroundedContext` and appends only what a follow-up
  needs, avoiding full rebuilds.

### 13.4 AI Cost Control — budgeting, estimation, caching
Before any provider call the facade must:
- **Estimate tokens** for the composed prompt (`estimateTokens(payload)` heuristic) and compare
  against a per-request and per-session **budget**; over-budget requests are trimmed (smaller
  context scope) or blocked with a clear message — never silently sent.
- **Cache responses** (optional, default on) in an in-memory LRU keyed by
  `hash(analysisKey + focus + promptVersion + question + model + temperature)`. Repeated
  explanations reuse the previous `GroundedAnswer`. Cache is tab-scoped and cleared on new upload.

```ts
export interface AIBudget { perRequestTokens: number; perSessionTokens: number; }
export function estimateTokens(payload: unknown): number;   // heuristic, no network
export interface AICacheKeyParts { analysisHash: string; focusKey: string; promptVersion: string;
  question?: string; model: string; temperature: number; }
```

### 13.5 Semantic Confidence — confirmation gate for low-confidence mappings
The Semantic Parser returns a `confidence` (0–1) for **every** inferred concept (already required in
§4.3). Mappings below a threshold (default `0.7`) are marked `needsConfirmation` and are **excluded
from the active semantic model until the user explicitly confirms** them in the UI. High-confidence
mappings apply automatically but remain advisory (§4, Rule S1). Unconfirmed/declined mappings fall
back to deterministic role/domain inference.

```ts
export interface SemanticMappingProposal {
  name: string; conceptLabel?: string; aliasOf?: string;
  roleHint?: "measure" | "dimension" | "time" | "identifier";
  confidence: number; needsConfirmation: boolean; confirmed?: boolean;
}
```

### 13.6 Explainability — every answer exposes its basis
Every `GroundedAnswer` must expose, via its `trace` (§13.11) and `evidence`:
- **Source deterministic objects used** (sourcePaths → artifacts)
- **Confidence** (level + basis, aligned with governance caps)
- **Supporting evidence** (the `GroundedFact[]`)
- **SQL** (when applicable, e.g. NL→SQL answers)
- **Statistical methods referenced** (e.g. Welch t-test, Poisson, BH-FDR — read from the cited
  root-cause/anomaly artifacts, never invented).

### 13.7 Extensibility — vendor-agnostic by construction
Future providers (OpenAI, Gemini, Claude, Ollama) are added **only** by implementing `AIProvider`
and registering a factory in `registry.ts`. **No analytics or UI code changes** to add a provider.
The registry is the single extension point; consumers depend on the interface, never a concrete class.

### 13.8 Performance — Web Workers for heavy work
The main thread must stay responsive. **Heavy AI preprocessing, semantic-parse payload assembly,
and DuckDB operations run in Web Workers** where appropriate (DuckDB-WASM already runs in a worker;
§13 extends this to metadata sampling and large context assembly). Provider network calls are async
and non-blocking; the UI shows progress and never freezes.

### 13.9 Privacy — metadata-only egress (hard rule)
Only **metadata** may ever leave the browser to an external provider: column names, inferred types,
**masked** sample values, and summary statistics. **Entire datasets and raw PII must never be
transmitted.** This is enforced at the type level (`SemanticParseInput`, `GroundedContext` carry no
raw rows) and re-checked by an egress assertion before any `fetch` to a provider. Sample values are
always drawn *after* the privacy layer masks sensitive fields.

### 13.10 Documentation — this doc is authoritative
`docs/ai-architecture.md` is the single source of truth for the AI layer. **Any architectural
change must update this document in the same PR, before or alongside the code change.** Implementation
that diverges from this spec is a bug in the code, not the doc.

### 13.11 AI Trace — reasoning transparency (ship before any AI chat)
Every AI answer carries an **AI Trace**: a small, expandable section exposing which deterministic
engines grounded the answer and the exact provider settings used. This ships as part of the answer
contract so transparency exists from the very first AI feature.

```ts
export type ReasoningSource =
  | "Semantic Model" | "Root Cause Analysis" | "KPI Engine"
  | "Recommendation Engine" | "SQL Query" | "Statistical Tests";

export interface AITrace {
  reasoningSources: ReasoningSource[];   // ticked sources actually used to ground the answer
  provider: string;                      // e.g. "Groq"
  model: string;                         // e.g. "qwen-3-32b"
  grounding: "Strict" | "Relaxed";       // from strictGrounding
  temperature: number;                   // e.g. 0.2
  promptVersion: string;                 // registry version stamp
  cached?: boolean;                      // served from §13.4 cache
  estimatedTokens?: number;              // from §13.4 estimator
}
```

**UI:** rendered as a collapsed "Reasoning Source" disclosure under each answer, listing the ticked
engines and a compact provider/model/grounding/temperature summary. Example:

```
▸ Reasoning Source
  ✓ Semantic Model      ✓ Root Cause Analysis   ✓ KPI Engine
  ✓ Recommendation Eng. ✓ SQL Query             ✓ Statistical Tests
  Provider: Groq   Model: qwen-3-32b   Grounding: Strict   Temperature: 0.2
```

The trace is populated by the service facade (§13.1) from the actual sourcePaths cited and the
resolved `AISettings` — never hand-typed by a prompt or component.

### 13.12 Addendum backward-compatibility
All §13 additions are additive and flagged. With `enabled=false`, none of conversation memory,
budgeting, caching, semantic confirmation, or AI Trace runs. Deterministic analytics, demo mode,
and GitHub Pages deployment remain unchanged and regression-free.
