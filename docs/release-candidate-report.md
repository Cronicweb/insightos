# InsightOS — Version 1.0 Release Candidate Report

**Date:** 2026-05-08 · **Branch:** `feature/ai-insight-analyst` ·
**Status:** Release Candidate (pending CI green + Pages deploy).

> **Verification authority.** The local build sandbox cannot complete
> `npm install` for `apps/web` (out-of-memory, exit 137). Per the RC strategy,
> **GitHub Actions CI is the authoritative verification environment.** This
> report does **not** claim any locally-executed typecheck, lint, test or build
> for the web client. Every code change in this RC is verified only when CI is
> green on the branch/PR.

## 1. Architecture completeness

The InsightOS architecture is **feature complete**. It is a three-part system:

- **Deterministic analytics engine** (`packages/analytics-core`, mirrored in the
  browser as `apps/web/lib/engine/*`): ingest, coercion, quality, KPIs,
  root-cause decomposition, recommendations, anomalies, forecast, ledger,
  case study, report. All numbers, causes and recommendations originate here.
- **Browser client** (`apps/web`, Next.js 14 static export): renders the
  analysis, runs browser SQL via DuckDB-WASM, and hosts the AI layer.
- **AI layer** (`apps/web/lib/ai/*`): an **additive, off-by-default** explanation
  and investigation layer that never computes analytics.

No new AI subsystems, orchestration layers, prompt systems, semantic engines or
investigation models remain to be built. Further AI work is **v1.1 product
evolution**, not architecture.

## 2. AI integration completeness

Verified present in source (file + line counts confirmed):

| Capability | Module | Present |
| --- | --- | --- |
| Prompt Builder | `lib/ai/prompts/builder.ts` | ✓ |
| Prompt Registry | `lib/ai/prompts/registry.ts` | ✓ |
| Internal System Prompt (integrity-checked) | `lib/ai/prompts/system.ts` | ✓ |
| AI Provider Layer | `lib/ai/provider.ts` | ✓ |
| Groq integration | `lib/ai/providers/groq.ts` | ✓ |
| Analyst Facade | `lib/ai/facade.ts` | ✓ |
| AI Context Builder | `lib/ai/context.ts` | ✓ |
| Grounding Validation | `lib/ai/grounding.ts`, `lib/ai/validation.ts` | ✓ |
| AI Operating Policy | `lib/ai/policy.ts` | ✓ |
| Intent Classifier | `lib/ai/policy.ts` (`classifyIntent`) | ✓ |
| Prompt-Injection Protection | `lib/ai/policy.ts` (local patterns, pre-call) | ✓ |
| Strict Investigation Mode | `lib/ai/facade.ts`, `lib/ai/types.ts` | ✓ |
| Insight Analyst | `lib/ai/analyst.ts`, `lib/ai/assistant.ts` | ✓ |
| Investigation Graph | `lib/ai/investigation/graph.ts` + view | ✓ |
| Decision Replay | `lib/ai/replay.ts` + panel | ✓ |
| AI Trace | `components/analyst/ai-trace-panel.tsx` | ✓ |
| Semantic Parser / Review / Confidence | `lib/ai/semantic/model.ts` + review dialog | ✓ |
| Conversation Memory | `lib/ai/memory.ts` | ✓ |
| Answer Cache | `lib/ai/cache.ts` | ✓ |
| Compare | `lib/ai/compare.ts` | ✓ |

**Safety invariants** (in code): the internal system prompt is non-overridable
and integrity-asserted; intent is classified locally (no LLM) and out-of-scope /
injection prompts are refused **before any provider call**; responses are
grounded-validated; the AI never emits a number the engine did not compute.

## 3. Accessibility status

WCAG 2.1 AA manual/static review complete — see `docs/accessibility-audit.md`.

- **0 Critical, 0 High.** Many correct patterns already in place (skip link,
  landmarks, single `h1`, named icon buttons, `focus-visible`, `aria-current`,
  `aria-modal` dialog with Escape + focus management, 44px+ touch targets,
  `sr-only` table captions, `lang="en"`).
- **Fixed in this RC (safe, non-functional):**
  - **A-01 (Medium):** loading state now announced via `role="status"` +
    `aria-live="polite"` + hidden label; decorative skeletons `aria-hidden`.
  - **A-02 (Low):** `Skeleton` primitive forwards div attributes so callers can
    mark it decorative.
- **Deferred to v1.1 (documented):** A-03 `Segmented` tabs-pattern completeness,
  A-04 measured colour contrast, A-05 per-chart SVG labels.

## 4. Performance status

Static/architectural review complete — see `docs/performance-audit.md`.

- Hot paths are **already optimized**: lazy per-tab DuckDB singleton with a
  single long-lived connection running in a Web Worker; LRU-bounded FNV-1a answer
  cache; reference-based, bounded conversation memory; task-scoped context;
  single-pass prompt assembly.
- **No speculative optimizations were made.** Any future optimization must be
  driven by the deferred measurement plan (Lighthouse + `performance.now()`
  spans + bundle analysis). This is the correct, conservative RC posture.

## 5. Testing status

- **Engine (`packages/analytics-core`):** CI runs `ruff` + `pytest` on Python
  3.10 / 3.11 / 3.12.
- **API contract (`apps/api`):** CI smoke-tests `/health`, `/datasets`, and the
  marketing analysis contract, asserting the headline invariant (every chart has
  a narrative headline).
- **Web client (`apps/web`):** CI runs the web job (typecheck / lint / test /
  build / Pages export). **Not run locally** (sandbox OOM) — CI is authoritative.

## 6. Build status

- **Local:** not attainable in the sandbox (`npm install` OOM). Explicitly not
  claimed.
- **CI:** the `web` job in `.github/workflows/ci.yml` performs the production
  build; this RC is complete only when that job is green.

## 7. GitHub Pages status

- The web client is a static export configured for Pages (`NEXT_PUBLIC_BASE_PATH`
  handling in `lib/duckdb/client.ts` and elsewhere). Demo JSON is regenerated at
  deploy time so published numbers match the deployed commit.
- **Definition of done includes a successful Pages deployment** following CI.

## 8. Known issues & deferred improvements

See `KNOWN_ISSUES.md`. Headlines:

- **Confirmed:** 0 High; A-01 (fixed); A-03/A-04/A-05 Low (deferred).
- **Deferred:** runtime AT test matrix, performance instrumentation, DuckDB
  prefetch, wiring Experiment/CLV engines into the UI, analyst live-region.
- **Intentional trade-offs:** browser-only/no persistence; deterministic-only
  analytics; AI off by default; in-memory caches; deploy-time demo JSON.
- **Won't fix:** general-purpose AI answers; tab-close data loss; >100%
  contribution shares; same-direction-as-total not a cause.

## 9. Release readiness

**Ready to promote to 1.0 upon CI green + Pages deploy.** All documentation is
complete; all in-scope accessibility fixes are landed as isolated commits; the
performance posture is conservative and documented; the AI architecture is
feature-complete with its safety invariants in code.

## 10. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Web CI fails on the two a11y commits | Low | Low | Changes are additive ARIA + a widened prop type; trivially revertable; CI is the gate before merge |
| Local verification gap masks an issue | Low–Med | Med | CI runs full typecheck/lint/test/build/export; nothing merges without green CI |
| Unmeasured perf edge case on huge datasets | Low | Med | Documented in perf audit; measurement plan deferred to v1.1; no user-facing regression introduced |
| Deferred a11y items (A-03/04/05) | Med | Low | Documented in KNOWN_ISSUES; none is a blocker; narrative-beside-chart mitigates A-05 today |
| Provider/network variability (AI on) | Med | Low | AI is opt-in; failures are contained to the AI layer; deterministic product unaffected |

**Overall residual risk: LOW.** The RC ships documentation and additive,
low-risk accessibility improvements only; the deterministic engine, AI
architecture, analytics, layout and workflows are untouched.

## 11. Sign-off checklist (Definition of Done)

- [x] Accessibility audit complete (`docs/accessibility-audit.md`)
- [x] Performance audit complete (`docs/performance-audit.md`)
- [x] Known issues documented (`KNOWN_ISSUES.md`)
- [x] Safe accessibility fixes landed as isolated commits (A-01, A-02)
- [x] Release Candidate report (this document)
- [x] Release notes (`RELEASE_NOTES_v1.0.md`)
- [ ] **GitHub Actions CI green on the branch/PR** *(authoritative — pending)*
- [ ] **GitHub Pages deployment succeeds** *(pending)*

When the two pending items are green, mark the **AI subsystem STABLE**, the
**architecture FEATURE COMPLETE**, and transition InsightOS to **v1.0**.
