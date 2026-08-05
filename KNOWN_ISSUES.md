# Known Issues

A living record of known limitations, deferred work and deliberate trade-offs in
InsightOS. Every mature project has one; this is ours. Items are grouped by how
we intend to handle them, not merely by severity.

_Last updated: 2026-05-08 (Version 1.0 Release Candidate)._

Related: [Accessibility Audit](docs/accessibility-audit.md) ·
[Performance Audit](docs/performance-audit.md) ·
[Release Candidate Report](docs/release-candidate-report.md).

---

## Confirmed Issues

Real defects or gaps we have verified in source. None is a 1.0 blocker.

### High Priority
- _None._ No high-priority correctness, security or data-integrity issue is
  known at the time of the 1.0 Release Candidate.

### Medium Priority
- **Loading state was not announced to assistive technology** (A-01).
  The analysis loading skeletons had no `role="status"`/`aria-live`.
  **Status: fixed in the RC** (isolated commit, verified by GitHub Actions CI).

### Low Priority
- **`Segmented` control advertises the ARIA tabs pattern without implementing it
  fully** (A-03). It exposes `role="tablist"`/`role="tab"` but has no
  `tabpanel`, `aria-controls`, or arrow-key roving focus. It behaves as a
  segmented toggle. **Deferred to v1.1** because the correct fix changes
  keyboard/interaction behaviour, which the RC "safe, non-functional" rule
  excludes.
- **Colour-contrast ratios are not yet measured** (A-04). The palette appears to
  meet AA but was not instrumented in this pass (no runtime tooling in the build
  sandbox). **Deferred to a measured pass.**
- **Charts lack per-SVG text alternatives** (A-05). Mitigated by the product
  invariant that every chart ships with an adjacent narrative, so meaning is
  always available as text. Adding `role="img"`/`aria-label` to each chart SVG is
  **deferred to v1.1** to keep RC commits small.

---

## Deferred Improvements

Good ideas intentionally postponed to keep the 1.0 surface stable.

- **Runtime accessibility test matrix** — NVDA + VoiceOver + keyboard-only smoke
  checklist per release. The 1.0 audit is a manual/static source review; runtime
  AT testing is deferred.
- **Performance instrumentation** — Lighthouse traces and `performance.now()`
  spans around parse, DuckDB boot/first-query, `analyse()`, and first paint. No
  optimization ships without these numbers (see Performance Audit).
- **DuckDB-WASM idle prefetch** on the landing page to hide first-query latency.
  Additive; deferred until measured.
- **Wire the Experiment and CLV engines into the pipeline/workspace UI.** The
  engines exist in `packages/analytics-core` but are not yet surfaced in the web
  workspace. (Also reflected in the README roadmap.)
- **`aria-live` completion announcements for Insight Analyst answers** (AD-2).
  Additive, but touches the AI runtime path, which the RC "no AI changes" rule
  excludes. v1.1.

---

## Intentional Trade-offs

Design decisions that are **not** bugs — chosen deliberately, documented so
reviewers understand the reasoning.

- **Browser-only, no persistence.** The deployed app has no backend and no
  database. Closing the tab destroys the session, uploaded data and any
  investigation. This is the privacy guarantee ("your data never leaves your
  device"), not a limitation to fix.
- **Deterministic-only analytics.** No LLM ever produces a number, cause or
  recommendation. This caps what the AI can "answer" (it explains, it does not
  compute) — a deliberate correctness/trust trade-off, enforced by a
  response-validation guard.
- **AI is off by default and additive.** With the master flag off, the build is
  byte-identical to the deterministic product. This keeps the demo and Pages
  deployment provider-free, at the cost of the AI being an opt-in extra rather
  than a default experience.
- **In-memory, tab-scoped caches and memory** (LRU 50 answers, 24 turns). Simple
  and private by construction; the trade-off is that nothing survives a reload.
- **Demo JSON is regenerated at deploy time, not committed.** Guarantees the live
  numbers match the code at that commit, at the cost of a longer Pages build.
- **Main-thread CSV parse before DuckDB.** Simpler and correct for typical
  dataset sizes; a streaming parser is deferred until a measurement justifies the
  added complexity.

---

## Future Roadmap

Directional, not committed to a date. See the README roadmap for the canonical
list.

- **v1.1 (product evolution, not architecture):**
  - Accessibility: `Segmented`→radiogroup semantics, chart SVG labels, measured
    contrast pass, AT test matrix, analyst live-region announcements.
  - Performance: measurement suite, then any justified optimizations.
  - Surface the Experiment (A/B) and CLV engines in the workspace UI.
- **Later:**
  - Survival analysis (Kaplan-Meier churn curves with confidence bands).
  - Scheduled monitoring: nightly pipeline runs that alert on new drivers.
  - Power BI custom visual embedding the root-cause tree.

---

## Won't Fix

Things that look like issues but are out of scope by design.

- **"The AI won't answer general questions."** Correct and intended. Insight
  Analyst is scope-restricted by a local intent classifier and refuses
  out-of-scope or injection prompts before any model call. It is not a
  general-purpose assistant, and will not become one.
- **"My data disappeared when I closed the tab."** By design — see Intentional
  Trade-offs. There is no server to persist to.
- **"Contribution percentages exceed 100%."** Intended. Contributions are shares
  of a *net change*, not shares of a whole; clamping them would be incorrect.
  Explained in the methodology and the UI.
- **"A segment moved down but isn't marked the cause."** Intended. A driver must
  move *materially differently from its parent* and survive an FDR-corrected
  significance test — moving in the same direction as the total is not, by
  itself, a cause.
