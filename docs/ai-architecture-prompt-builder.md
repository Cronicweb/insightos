# InsightOS — AI Architecture (Addendum §31: Prompt Builder & Prompt Registry)

> **Final architectural amendment before Release Candidate.** Authoritative appendix to
> `ai-architecture.md`, `-phase2-3.md`, `-integration.md`, `-policy.md`. **Additive only** — no
> existing code is rewritten or replaced; deterministic analytics, Investigation Graph, Analyst
> Facade, Provider Layer, Context Builder, Semantic Parser, and Grounding/Response Validation are
> unchanged. Updated **before** code (§13.10).

---

## 31. Prompt Builder — the single prompt-assembly component

### 31.1 Pipeline (unchanged stages, one new assembly step)
```
User Question → Intent Classification (§28) → AI Context Builder → PROMPT BUILDER (§31)
  → Provider (Groq/…) → Grounding Validation → Response Validation → UI
```
The **Prompt Builder** is the ONLY component that constructs prompts. **Neither UI components nor
providers create prompts.** Providers receive a finalized, provider-agnostic **prompt package**.

### 31.2 Prompt composition (fixed order)
Every AI request is assembled from exactly these parts, in order:
1. **Internal System Prompt** (owned by InsightOS)
2. **Task-specific Prompt** (from the registry)
3. **Grounded Context** (from the Context Builder — never invented)
4. **Conversation Memory** (session-scoped, object-referencing)
5. **Current Page Context** (active InsightOS module)
6. **User Question**

No other component may construct prompts.

### 31.3 Internal System Prompt (intentionally hidden)
The system prompt is an **internal implementation detail** and belongs entirely to InsightOS.
Users must **never** view, edit, replace, override, disable, or upload their own system prompt.
- It lives in `lib/ai/prompts/system.ts`, is **versioned**, and is **frozen** (`Object.freeze`).
- The Prompt Builder is the only reader; it is **never** surfaced in the UI, settings, exports,
  traces, or Decision Replay serialization.
- **Why hidden:** it encodes the prime directive (deterministic engine = source of truth),
  the scope restriction (§28), grounding/citation rules, and anti-injection guardrails. Exposing or
  allowing override would let users turn Insight Analyst into a general-purpose model, break
  grounding guarantees, and enable prompt-injection — exactly what the platform forbids.

### 31.4 Prompt Registry (versioned)
`lib/ai/prompts/registry.ts` catalogs every task prompt with metadata:
`{ id, version, purpose, description, expectedInputs, expectedOutputs, task }` where
`task ∈ { semantic, analyst, sql, rewrite, forecast, recommendation, report }`.
The registry **wraps the existing task templates** in `lib/ai/prompts.ts` (unchanged) — it does not
replace them. New task areas (forecast/recommendation/report) are registered as thin, additive
descriptors that reuse the shared preamble and analyst answer shape.

### 31.5 Current Page Context (auto-injected)
The Builder injects the active module so prompts stay concise and context-aware:
`Overview · Root Cause · Forecast · Recommendations · Executive Report · Insight Analyst ·
SQL Explorer · Investigation Graph · Decision Replay`. This is a short label + optional focus hint,
never raw data.

### 31.6 Provider independence
The Builder emits a neutral `PromptPackage { system, task, context, memory, page, question, meta }`
plus a `toMessages()` helper (role/content array). Switching providers
(**Groq / OpenAI / Gemini / Claude / Ollama**) requires changes only inside the provider adapter's
serialization of a `PromptPackage` — **never** prompt-text changes elsewhere.

### 31.7 Prompt security
The Builder enforces:
- **Internal system-prompt protection** — frozen, non-overridable, never echoed back.
- **Prompt versioning & integrity** — every package stamps `systemVersion` + `registryVersion`; an
  integrity check rejects a tampered/empty system prompt.
- **Composition validation** — required parts present, grounded context is non-empty for grounded
  tasks, and no user-supplied content is allowed to occupy the system slot.
- **Injection protection remains active before provider calls** — the Builder re-runs the §28
  classifier on the user question and refuses (no package produced) on injection/out-of-scope.

### 31.8 Backwards compatibility
`AnalystFacade`, `analyst.ts`, providers, and existing `prompts.ts` exports are untouched. The
Builder is a new, opt-in assembly seam: existing callers keep working; new/updated callers route
through `buildPrompt()`. Inert unless AI is enabled.

---

## 32. Release Candidate transition
With §31 complete, the architecture is **feature-complete**. No further AI subsystems or major
architectural changes. Future work is limited to **production quality, UX refinement, accessibility,
documentation, README, testing, screenshots, demo recording, performance, and bug fixes**. The
deterministic analytics engine remains the permanent source of truth; AI remains an assistant for
semantic understanding, explanation, and investigation only. **InsightOS is now RC.**
