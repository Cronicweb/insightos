# Performance Audit — InsightOS Web Client

**Scope:** the in-browser analysis path (`apps/web`), from file upload through
DuckDB-WASM, the deterministic engine, rendering, and the AI layer.
**Date:** 2026-05-08 · **Reviewer:** RC engineering pass.

> **Measurement honesty.** The local sandbox cannot run the app (`npm install`
> is OOM-killed), so this audit contains **no runtime numbers captured by me**
> (no Lighthouse traces, no `performance.now()` measurements). It is a
> **static/architectural** review of the hot paths in source. Where the brief
> says "only optimize if measurements justify it," the honest conclusion is:
> **no optimization is justified without measurement**, and the code is already
> structured to avoid the usual browser-analytics performance traps. Concrete
> instrumentation is listed as a deferred task, to be run on a machine (or in
> CI) with the toolchain.

## Executive finding

The performance-sensitive code is **already well-architected**. Every hot path
reviewed applies the right structural optimization (lazy singletons, bounded
caches, reference-based memory, task-scoped payloads, off-main-thread SQL).
**Per the Release Candidate rule, this audit recommends measuring before
changing anything, and implements no speculative optimizations** — the
regression risk of refactoring working, correct code outweighs an unmeasured
marginal gain.

## Path-by-path review

### 1. Upload & ingest
- **Code:** `components/upload/upload-dialog.tsx`, `lib/engine/ingest.ts`,
  `lib/engine/xlsx.ts`, `lib/engine/coerce.ts`.
- **Observed structure:** files are read with the File API and parsed in-tab
  (PapaParse / Arrow IPC; `.xlsx` flattened). No network upload. Coercion is a
  single typed pass.
- **Risk:** very large CSVs parse on the main thread before handing to DuckDB;
  a multi-hundred-MB file could jank the UI during parse.
- **Recommendation:** **measure** parse time for representative large files
  first. Only if it exceeds a UX budget (e.g. >1s main-thread block) consider a
  chunked/streamed parse. **Not implemented** — unmeasured.

### 2. Semantic parsing
- **Code:** `lib/ai/semantic/model.ts` (96 ln), consumed by the Semantic Review.
- **Observed structure:** a non-destructive concept↔column model; pure functions
  over the schema, no per-cell iteration of the full dataset.
- **Risk:** negligible — it operates on schema/column metadata, not row data.
- **Recommendation:** none. No measurement flag raised.

### 3. DuckDB-WASM queries
- **Code:** `lib/duckdb/client.ts`, `lib/engine/sql.ts`, `lib/sql-dialect.ts`.
- **Observed structure (strengths):**
  - **Lazy singleton:** `getDuckDb()` boots the engine **once per tab**
    (`let pending` promise) and reuses it; failures reset `pending` so a retry
    can re-boot.
  - **One long-lived connection** is kept on the handle — the code explicitly
    notes "opening one per query is wasteful."
  - **Own-origin bundles** with `selectBundle` feature-detecting the `eh` build,
    so only one WASM binary is downloaded, and it runs in a **Web Worker**
    (off the main thread).
  - `castBigIntToDouble` / `castTimestampToDate` set at `open()` to avoid
    per-query coercion.
- **Risk:** the first query pays WASM instantiation latency; this is already
  surfaced to the user via the `onProgress` callback ("Selecting bundle",
  "Loading SQL engine", "Ready").
- **Recommendation:** none beyond what exists. Optionally **prefetch** the WASM
  bundle on landing-page idle to hide first-query latency — additive, but
  deferred until measured, since it trades bandwidth for a possibly-small win.

### 4. Analytics execution (deterministic engine)
- **Code:** `lib/engine/index.ts` (353 ln orchestrator) and the `engine/*`
  modules (rootcause 434, recommend 522, ledger 736, quality, kpi, anomaly,
  forecast…).
- **Observed structure:** a single orchestrated pass; each module consumes the
  prior artifacts. Statistics are hand-written and O(n)/O(n log n) in the row or
  segment count.
- **Risk:** root-cause decomposition is combinatorial across dimensions; on a
  wide dataset with many high-cardinality dimensions the segment search can grow.
- **Recommendation:** **measure** decomposition time on a wide, high-cardinality
  dataset. The engine already reports examined-and-rejected dimensions, implying
  a bounded search; only optimize (e.g. cardinality caps) if a measured case
  exceeds budget. **Not implemented** — unmeasured, and this is engine logic that
  the RC rule forbids changing without strong justification.

### 5. Rendering
- **Code:** `app/page.tsx` (509 ln) + panels/charts.
- **Observed structure:** `React.useMemo` is used for derived values (e.g. the
  selected KPI); charts are presentational SVG (Recharts / custom). Panels
  render off a single `Analysis` object already in memory.
- **Risk:** `page.tsx` holds substantial state; a broad re-render on tab change
  is possible but cheap (charts are small SVG, data is pre-computed).
- **Recommendation:** none required for 1.0. If a measured jank appears on
  low-end devices, memoize the heaviest panels — deferred, unmeasured.

### 6. Investigation Graph
- **Code:** `lib/ai/investigation/graph.ts` (158 ln),
  `components/analyst/investigation-graph-view.tsx`.
- **Observed structure:** a small graph of grounded question nodes with
  session-scoped memory; node counts are human-scale (tens, not thousands).
- **Risk:** negligible at realistic sizes.
- **Recommendation:** none.

### 7. AI Context Builder
- **Code:** `lib/ai/context.ts` (73 ln).
- **Observed structure (strength):** **task-scoped** — `buildContext` includes
  only the facts relevant to the current `focus`, keeping payloads small, and
  every value carries a `sourcePath`. It is a pure function with no data-scale
  iteration.
- **Risk:** none material.
- **Recommendation:** none.

### 8. Prompt Builder
- **Code:** `lib/ai/prompts/builder.ts` (139 ln).
- **Observed structure (strength):** single-pass assembly of a fixed 6-part
  package; memory is summarised to the **last 6 turns**; policy re-check runs
  locally **before** any provider call (also saves needless network round-trips
  on out-of-scope prompts).
- **Risk:** none material; `JSON.stringify` of the trimmed context is bounded by
  the task-scoped facts.
- **Recommendation:** none.

### 9. Caching & memory
- **Code:** `lib/ai/cache.ts` (52 ln), `lib/ai/memory.ts` (55 ln).
- **Observed structure (strengths):**
  - **LRU answer cache**, bounded to `MAX_ENTRIES = 50`, keyed by an FNV-1a hash
    of `analysisHash|focus|promptVersion|question|model|temperature`; a cache
    hit avoids a provider call entirely.
  - **Reference-based conversation memory** bounded to `MAX_TURNS = 24`, storing
    `sourcePath` references rather than replaying prose; `contextDelta` reuses
    prior context instead of rebuilding.
  - `estimateTokens` is a cheap `length/4` heuristic — no tokenizer dependency,
    no network.
- **Risk:** none material.
- **Recommendation:** none.

## What was explicitly NOT done, and why

Per the RC rule ("if a proposed improvement introduces meaningful regression
risk for marginal benefit, document it instead of implementing it"):

- **No refactor of the engine orchestrator or root-cause search** — correct,
  tested, and changing it risks analytics output; forbidden without measurement.
- **No streaming/chunked CSV parser** — unmeasured; adds complexity to a working
  path.
- **No WASM prefetch** — a real idea, but a bandwidth/latency trade that needs a
  measurement to justify.
- **No `React.memo` sprinkling** — speculative; no measured jank.

## Deferred: measurement plan (v1.1)

Run on a toolchain-capable environment or in CI:

1. Lighthouse (mobile + desktop) on the deployed Pages site: TTI, LCP, TBT.
2. `performance.now()` spans around: file parse, `getDuckDb()` first boot,
   first query, full `analyse()`, first paint of the Overview panel.
3. Root-cause decomposition timing on a wide, high-cardinality dataset.
4. Bundle analysis (`@next/bundle-analyzer`) to confirm DuckDB-WASM is loaded
   lazily and not in the initial JS payload.

Only findings backed by these numbers should drive a v1.1 optimization.

## Implementation status (this RC)

| Path | Finding | Action |
| --- | --- | --- |
| Upload/ingest | Possible main-thread parse on huge files | Measure first (deferred) |
| DuckDB | Already lazy singleton + worker + single conn | None (optionally prefetch, deferred) |
| Engine | Combinatorial decomposition on wide data | Measure first (deferred; engine change forbidden without cause) |
| Rendering | Broad re-render possible, cheap | None |
| Context/Prompt/Cache/Memory | Already optimized (scoped, bounded, LRU, refs) | None |

**No performance code changes are made in this Release Candidate.** The audit's
conclusion is that the code is production-appropriate as-is, and any further
work must be measurement-driven in v1.1.
