# InsightOS v1.0 — Release Notes

_Release Candidate · 2026-05-08_

> **Verification note.** This release is verified by **GitHub Actions CI**, which
> is the authoritative build/test/deploy gate. The development sandbox could not
> run the web toolchain locally (memory constraints), so no local verification is
> claimed; the v1.0 tag is cut only after CI is green and GitHub Pages deploys.

## Project overview

**InsightOS turns a spreadsheet into a decision.** Upload a CSV, Excel, JSON or
Parquet file and InsightOS produces a full analyst-grade workup — quality
scorecard, KPIs, **root-cause decomposition**, recommendations, anomalies,
forecast, an audit ledger and an executive report — **entirely in your browser**.
No data ever leaves your device.

The defining principle: **every number, cause and recommendation is computed by a
deterministic engine, not a language model.** The optional AI layer *explains*
and helps you *investigate* those results; it never invents them.

## Major features

- **One-file-to-insight workflow.** Drag in a dataset; get a complete, structured
  analysis with a headline narrative on every chart.
- **Root-cause analysis.** Statistically-guarded decomposition that attributes a
  KPI's movement to the segments actually driving it (FDR-corrected; a segment
  must move *materially differently from its parent* to be named a cause).
- **Browser SQL.** Query your data with DuckDB-WASM directly in the tab — no
  server, no upload.
- **Governance & explainability.** Sensitive-column detection with masking,
  decision-readiness and confidence caps, and per-recommendation evidence.
- **Executive report & export.** A shareable brief, CSV export and print-to-PDF.
- **Accessible by design.** Skip links, landmark regions, keyboard-navigable
  dialogs, visible focus, 44px+ touch targets, screen-reader-announced loading.

## AI integration highlights (optional, off by default)

- **Insight Analyst** — ask grounded questions about *your* analysis; answers are
  built only from computed facts, each traceable to a `sourcePath`.
- **Investigation Graph & Decision Replay** — branch an investigation into a
  graph of grounded questions, and replay how a decision was reached.
- **AI Trace** — see exactly what context and prompt produced an answer.
- **Semantic Review** — a non-destructive concept↔column model you can confirm.
- **Safety first:** a local intent classifier and prompt-injection defense refuse
  out-of-scope prompts **before any model call**; the internal system prompt is
  non-overridable; responses are grounding-validated; **the AI never emits a
  number the engine did not compute.** Groq is the reference provider; the
  provider layer is pluggable.

## Architecture summary

- **`packages/analytics-core`** — the deterministic Python engine (also mirrored
  in TypeScript for the browser).
- **`apps/api`** — a thin FastAPI surface exposing the analysis contract.
- **`apps/web`** — a Next.js 14 static-export client: rendering, DuckDB-WASM SQL,
  and the additive AI layer (`lib/ai/*`).

## Browser-only processing

The deployed product has **no backend and no database**. Your file is parsed,
analysed and queried inside the tab; DuckDB runs in a Web Worker in WASM linear
memory and dies with the tab. **Nothing is uploaded.**

## Deterministic analytics philosophy

Trust comes from reproducibility. The same input yields the same output, every
time, with an audit ledger explaining each step. The AI layer is a lens on those
deterministic results — never their source.

## Privacy model

- Data never leaves the device.
- No persistence: closing the tab clears everything (session, uploads,
  investigations, AI memory/cache).
- AI is opt-in; with it off, the build is byte-identical to the deterministic
  product.
- When AI is on, only aggregate, privacy-masked facts are placed in context.

## Known limitations

See [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md). In brief:

- No persistence across reloads (by design).
- The AI is scope-restricted and will not answer general-purpose questions
  (by design).
- Some accessibility refinements are deferred to v1.1 (`Segmented` semantics,
  per-chart SVG labels, a measured contrast pass).
- Performance is architecturally sound but not yet instrumented with runtime
  measurements (deferred to v1.1).
- The Experiment (A/B) and CLV engines exist but are not yet surfaced in the web
  UI.

## Upgrade notes

This is the **initial 1.0** release — there is no prior version to upgrade from.

- Requirements: a modern browser with WebAssembly (all current browsers).
- The AI layer is **off by default**; enable it and configure a provider (Groq)
  in **AI Settings** if you want explanations/investigation.
- Deployment: static export to GitHub Pages; demo datasets are regenerated at
  deploy time.

## Planned roadmap for v1.1

v1.1 is **product evolution, not architecture** — the AI architecture is frozen
as of 1.0.

- **Accessibility:** `Segmented` → radiogroup semantics; `role="img"`/`aria-label`
  on chart SVGs; a measured colour-contrast pass; a runtime NVDA/VoiceOver/keyboard
  test matrix; polite live-region announcements for analyst answers.
- **Performance:** a measurement suite (Lighthouse + `performance.now()` spans +
  bundle analysis), then only measurement-justified optimizations (e.g. optional
  DuckDB-WASM prefetch, streaming CSV parse for very large files).
- **Analytics surface:** wire the existing Experiment (A/B) and CLV engines into
  the workspace UI.
- **Later:** survival analysis (Kaplan-Meier churn curves), scheduled monitoring
  with alerts, and a Power BI custom visual for the root-cause tree.

---

**Thank you** for using InsightOS. Your data stays yours — the insights are ours
to compute, together.
