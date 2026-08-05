# InsightOS — AI Architecture (Addendum §18–§26: Integration Milestone)

> **Authoritative appendix to `docs/ai-architecture.md`** (and `-phase2-3.md`). Governed by the prime
> directive (§0) and Addendum v2 (§13). This milestone is about **integration & cohesion**, not new
> features — plus one flagship capability, **Decision Replay** (§26). Per §13.10, the document is
> updated **before** the code. Where this refines an earlier section, this appendix governs.

---

## 18. AnalystFacade — the single orchestration layer (Priority 1)

**No UI component coordinates AI concerns directly.** Providers, semantic parsing, context building,
grounding, caching, SQL generation, and explanation logic are orchestrated **only** by the
`AnalystFacade`. The rest of the app talks to the facade and nothing else.

Lifecycle:
```
Dataset
  ↓  Semantic Cache            (reuse cached SemanticModel; never re-parse — §19)
  ↓  AI Context Builder        (grounded context from deterministic artifacts + semantic model)
  ↓  Provider Resolution       (settings → NullProvider when disabled/unconfigured)
  ↓  Grounding Validation      (numeric guard; strict mode suppresses ungrounded claims — §22)
  ↓  Response Validation       (schema + invention checks; deterministic fallback — §22)
  ↓  Investigation Graph       (node created/answered; branch/compare/bookmark — §20)
  ↓  Answer Cache              (hash(analysis+focus+prompt+model+temp) — §23)
  ↓  UI                        (renders structured InvestigationResponse only)
```

Facade surface (stable, UI-facing):
```ts
export interface AnalystFacade {
  ensureSemanticModel(input: DatasetMetadata): Promise<SemanticReadyState>; // §19 (parse-once)
  startInvestigation(seed: InvestigationSeed): InvestigationGraph;
  ask(nodeId: string, question: string): Promise<InvestigationResponse>;   // full lifecycle
  branch(nodeId: string, question: string): { graph: InvestigationGraph; nodeId: string };
  compare(a: CompareRef, b: CompareRef): CompareResult;                    // §21
  bookmark(nodeId: string, on: boolean): InvestigationGraph;               // §20
  exportInvestigation(): string;                                          // §20 (no raw data)
  replay(investigation: SerializedInvestigation, dataset: DatasetMetadata): Promise<ReplayResult>; // §26
}
```
The facade is **safe when AI is disabled**: provider resolution yields a `NullProvider`, validation
forces the deterministic fallback, and no data leaves the device.

---

## 19. Pipeline integration (Priority 2)

Wire the Semantic Review dialog into the upload pipeline. Canonical end-to-end flow:
```
Upload → Metadata Extraction → Deterministic Profiling → Semantic Cache Lookup
      → AI Semantic Parser (metadata only) → Confidence Evaluation
      → User Review (only if required) → Semantic Model → Deterministic Analytics
      → InsightOS Dashboard → Insight Analyst
```
- **Parse-once:** the Semantic Cache is consulted **before** the AI parser. On a hit, the parser is
  skipped entirely; **no duplicate semantic parsing occurs after upload**.
- Review is shown **only** when confidence < threshold (§14.4). Confirmed model is cached for the
  session and becomes the canonical representation for analytics **and** the analyst.
- With AI off (or semantic parser off), the pipeline degrades to
  `Upload → Metadata → Profiling → Analytics → Dashboard` exactly as today.

---

## 20. Investigation Graph as first-class history (Priority 3)

The graph is the user's **investigation history**, not an implementation detail. Supported:
- **Branching** investigations (multiple children per node) — already in §16.
- **Node comparison** (§21) and **bookmarks** (`InvestigationNode.bookmarked`).
- **Export** (refs/SQL/traces; never raw data) and **revisit** (click any node; jump back).
- **Persistent graph during session** (in-memory, tab-lifetime).
- **Optional persistence hook:** `InvestigationStore` interface (save/load/list) with a default
  no-op/in-memory impl; a future adapter (localStorage/IndexedDB/cloud) can implement it without
  touching the facade or UI.

---

## 21. Compare View (Priority 4)

Generic, type-aware side-by-side comparison with **automatic difference highlighting**. One diff
engine, five comparators:
- two **investigation nodes** (summary/evidence/SQL/trace)
- two **semantic mappings** (concept/role/column/confidence)
- two **time periods** (KPI deltas)
- two **SQL queries** (normalized token diff)
- two **recommendation sets** (added/removed/changed)

```ts
export type CompareKind = 'node' | 'semantic' | 'period' | 'sql' | 'recommendations';
export interface CompareResult { kind: CompareKind; rows: CompareRow[]; }
export interface CompareRow { field: string; a?: string; b?: string; status: 'same' | 'changed' | 'added' | 'removed'; }
```

---

## 22. Grounding & response validation (Priority 5)

**Every AI response passes validation before rendering.** Reject responses that:
- invent KPIs, statistics, or confidence values not present in the grounding context
- invent SQL that references unknown tables/columns
- reference unavailable evidence (sourcePaths not in context)

On failure, **gracefully fall back to a deterministic explanation** (templated from the analysis
artifacts) and mark the trace `grounding: 'Fallback'`. Numeric guard (§13-grounding) still applies.
```ts
export interface ValidationResult { ok: boolean; violations: string[]; }
export function validateResponse(resp: InvestigationResponse, ctx: GroundedContext): ValidationResult;
```

---

## 23. Performance (Priority 6)
- Semantic parsing occurs **once** (§19); AI context is reused via `contextDelta` (§15.2).
- Investigation graph is **lightweight** (plain objects; O(1) node ops; DOM tree render, no heavy libs).
- SQL generation is **cached** (keyed by question+semantic version+analysis hash).
- Repeated explanations reuse the **answer cache** (§13.4). The facade exposes a `profile()` hook
  returning stage timings (parse/context/provider/validate/render) for the pipeline profiler.

---

## 24. User experience (Priority 7)
AI **disappears into the workflow**. The product reads as *"I am investigating my data,"* never
*"I am using AI."* No "AI" labels in the primary flow; the analyst is an investigation surface, the
graph is history, and the AI Trace is an optional "how this was produced" disclosure — present for
transparency, never in the way.

---

## 25. Future extension hooks (Priority 8) — interfaces only, not implemented
- `SemanticParser` interface → multiple/pluggable parsers
- `AuthProvider` hook → enterprise authentication
- `ExecutionBackend` hook → cloud execution (default: local DuckDB-WASM)
- `CollaborationAdapter` → collaborative investigations
- `Scheduler` → scheduled analyses
- `DocumentPack` / `Retriever` → RAG document packs
All are typed seams with safe defaults; none change current behavior.

---

## 26. Decision Replay (flagship, Priority — research-grade)

Turn an investigation into a **reusable analytical workflow**. An investigation serializes its
**structure** — questions, SQL, semantic mapping (by concept, not physical name), filters, analysis
focus — so it can be **replayed against a new dataset** and compared old-vs-new.
```
Investigation → SQL → Semantic Model (by concept) → Filters → Analysis → Compare Old vs New
```
```ts
export interface SerializedInvestigation {
  version: string;
  createdAt: number;
  seedQuestion: string;
  steps: Array<{
    question: string;
    focus: ContextFocus;
    conceptRefs: string[];      // canonical concepts (portable across datasets)
    sql?: string;               // parameterized on concepts, not physical columns
    filters?: Array<{ concept: string; op: string; value: string }>;
  }>;
}
export interface ReplayResult {
  graph: InvestigationGraph;    // re-run against new data
  comparison: CompareResult[];  // per-step old-vs-new (§21)
  unmapped: string[];           // concepts absent in the new dataset's semantic model
}
```
- Replay re-resolves each **concept → physical column** via the *new* dataset's semantic model, so a
  workflow authored on one schema runs on another. Concepts with no mapping are surfaced as `unmapped`
  (never silently guessed).
- Fully grounded and deterministic-first: replay executes real SQL/analytics locally; AI only narrates.
- Serialized form contains **no raw data** — safe to export/share/version like code.

---

## 27. Stability (Priority 9) — reaffirmed
Deterministic analytics, GitHub Pages deployment, browser-only processing, backwards compatibility,
feature flags, and **zero regression** are all preserved. Everything in §18–§26 is additive and
flag-gated; with AI off the app is byte-identical to today. No engine module or deployment is modified.
