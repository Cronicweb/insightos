# InsightOS — AI Architecture (Addendum §14–§16: Phase 2 & Phase 3)

> **Authoritative appendix to `docs/ai-architecture.md`.** This file extends that specification with
> Phase 2 (Semantic Intelligence), Phase 3 (Insight Analyst), and the AI Investigation Graph. It is
> binding and governed by the same prime directive (§0) and Addendum v2 (§13). Where it refines an
> earlier section, this appendix governs. Per §13.10, this document is updated **before** the code.

---

## 14. Phase 2 — Semantic Intelligence (first-class subsystem)

### 14.1 Canonical pipeline
```
Upload
  ↓
Metadata Extraction            (column names, inferred types, masked samples, summary stats)
  ↓
Deterministic Profiling        (existing profiler — unchanged, always runs)
  ↓
AI Semantic Parser             (metadata-only, flagged; §4 / §13.9)
  ↓
Semantic Confidence            (per-concept score + reasoning + evidence + conflicts)
  ↓
User Confirmation              (ONLY when confidence < threshold; §14.4)
  ↓
Semantic Model                 (canonical representation; cached per session)
  ↓
Deterministic Analytics        (consumes the semantic model — numbers unchanged)
```

### 14.2 The semantic model is canonical — but non-destructive
- The **semantic model becomes the canonical representation** the analytics engine reads from
  (concept → column resolution).
- **Never mutate the uploaded dataset.** The raw frame/table in DuckDB-WASM is read-only to this layer.
- **Never overwrite original column names.** Original names remain the physical keys.
- **Store canonical mappings separately** in a `SemanticModel` object, keyed by original column name.
  The engine resolves a concept (e.g. `Revenue`) to a physical column via this map; if the map is
  absent or a mapping is unconfirmed/rejected, the engine falls back to its existing deterministic
  role/domain inference. Determinism of computed numbers is unchanged either way.

```ts
export interface SemanticConcept {
  concept: string;                 // canonical, e.g. "Revenue" | "Date" | "Customer ID"
  column: string;                  // ORIGINAL physical column name (never renamed)
  role: "measure" | "dimension" | "time" | "identifier";
  confidence: number;              // 0..1
  reasoning: string;               // human-readable why
  evidence: string[];              // e.g. ["numeric values","monetary formatting","transactional distribution","column aliases"]
  conflicts?: Array<{ concept: string; confidence: number }>; // alternative candidates
  source: "ai" | "deterministic" | "user";
  confirmed: boolean;
}

export interface SemanticModel {
  version: string;                 // semanticVersion — surfaced in AI Trace (§15.3)
  analysisKey: string;
  domainHint?: string;
  concepts: SemanticConcept[];     // keyed conceptually; column is the physical join key
  createdAt: number;
}
```

### 14.3 Semantic Confidence — required per concept
Every inferred concept must carry: **confidence score**, **reasoning**, **supporting evidence**, and
**conflicting candidates**. Example:

```
Revenue        Confidence: 96%
Evidence       numeric values · monetary formatting · transactional distribution · column aliases
Alternative    Amount (41%)
```

Confidence is produced by the AI parser but is **advisory** (§4 Rule S1). The deterministic profiler's
own signals are always available as the fallback and as an independent cross-check.

### 14.4 Semantic Review UI (confirmation gate)
- When **any** concept's confidence is **below the configured threshold**
  (`SEMANTIC_CONFIRM_THRESHOLD`, default 0.7), a **review dialog is shown before analytics begin**.
- The dialog lists low-confidence concepts with their reasoning/evidence/conflicts and lets the user:
  **accept**, **edit** (choose a different concept/role or a different column), or **reject** (fall
  back to deterministic inference for that column).
- High-confidence concepts apply automatically (still advisory, still non-destructive).
- **Once confirmed, the semantic model is cached for the session** (tab-lifetime, in-memory; never
  written to disk — consistent with the privacy model).

### 14.5 Performance (§21-Perf)
- **Semantic parsing runs once per uploaded dataset.** The resulting `SemanticModel` is cached and
  reused by all subsequent AI interactions. No repeated provider calls for parsing.
- Metadata extraction and payload assembly run in a **Web Worker** where heavy (§13.8); DuckDB-WASM
  already runs in its worker.

---

## 15. Phase 3 — Insight Analyst (investigation workspace, not a chatbot)

### 15.1 Structured response contract (no free-form chat)
Insight Analyst is an **investigation workspace**. Every response is rendered as fixed, labelled
sections — never a conversational blob:

```ts
export interface InvestigationResponse {
  summary: string;                       // grounded, concise
  evidence: GroundedFact[];              // sourcePath-backed facts
  confidence: { level: "high" | "medium" | "low"; basis: string };
  supportingCharts: string[];            // references to existing ChartSpec ids (no new numbers)
  sql?: GeneratedSql;                    // present for NL→SQL answers; always displayed (§15.4)
  statisticalTests: string[];            // methods read from cited artifacts (e.g. "Welch t-test","BH-FDR")
  nextInvestigation: string[];           // suggested follow-up questions
  trace: AITrace & AITraceExtended;      // §15.3 — always present
}
```

- `supportingCharts` reference **existing** engine `ChartSpec`s by id; the analyst never fabricates a
  chart or a number. `statisticalTests` are read from the cited root-cause/anomaly artifacts.

### 15.2 Conversation memory references objects, not text (§13.3 refined)
- History stores **references to deterministic analysis objects** (sourcePaths, focus, chart ids,
  concept versions) — **not replayed prose**.
- Follow-ups ("Why?", "Show evidence.", "Compare with last month.") **reuse structured context**:
  the builder produces a `contextDelta` from the referenced objects rather than resending whole
  prompts. This bounds tokens and avoids repeated provider round-trips for unchanged context.

### 15.3 AI Trace — full inspectable provenance
Every AI explanation exposes an inspectable trace. Extends §13.11:

```ts
export interface AITraceExtended {
  promptVersion: string;
  contextSources: string[];        // sourcePaths / artifact ids fed to the model
  reasoningSources: ReasoningSource[];
  semanticVersion?: string;        // SemanticModel.version used
  analysisHash: string;            // hash of the grounding context / analysis
  timestamp: number;               // ISO/epoch
  // plus §13.11: provider, model, grounding, temperature, cached?, estimatedTokens?
}
```

The UI renders a collapsible **"How this was produced"** panel: Provider · Model · Grounding Mode ·
Prompt Version · Context Sources · Reasoning Sources · Semantic Version · Analysis Hash · Timestamp.

### 15.4 NL→SQL — never a black box
- Generated SQL is **always displayed**.
- Users can **inspect, copy, edit, and rerun** it. Rerun executes locally in DuckDB-WASM (no server).
- Edited SQL runs as-is; results render in a table/chart. The `sql` block travels in the
  `InvestigationResponse` and the AI Trace records that "SQL Query" was a reasoning source.

---

## 16. AI Investigation Graph (the flagship interaction model)

Instead of a linear chat, an investigation is a **graph of question nodes** — think Git history /
Obsidian graph, but for business investigations.

### 16.1 Model
```ts
export interface InvestigationNode {
  id: string;
  parentId?: string;               // enables branching (multiple children per node)
  question: string;                // e.g. "Why?" scoped to the parent's focus
  focus: ContextFocus;             // what this node investigates
  response?: InvestigationResponse;// grounded answer (§15.1)
  createdAt: number;
  status: "pending" | "answered" | "error";
}

export interface InvestigationGraph {
  id: string;
  analysisKey: string;
  semanticVersion?: string;
  rootId: string;                  // typically the dataset / a KPI movement
  nodes: Record<string, InvestigationNode>;
  createdAt: number;
}
```

Example investigation:
```
Upload Dataset
   └─ Revenue ↓
        └─ Why? ── Region: East
                     └─ Why? ── Enterprise Customers
                                  └─ Why? ── Campaign Ended
```

### 16.2 Interactions
- **Click any previous node** to revisit its grounded answer and trace.
- **Jump back** to an ancestor and continue from there.
- **Branch**: ask a different "Why?" from the same node, creating a sibling path.
- **Compare**: view two nodes/branches side by side (their evidence + traces).
- **Export**: serialize the graph (questions, sourcePaths, SQL, traces — **no raw data**) to JSON /
  Markdown for sharing or audit.

### 16.3 Grounding & performance
- Each node is a **grounded** `InvestigationResponse` (§2, §15.1). Nodes reference deterministic
  artifacts; the graph never stores or transmits raw rows.
- Node context is built via `contextDelta` from the parent (§15.2) and the cached `SemanticModel`
  (§14.5), so drilling deeper reuses structure and minimizes provider calls. Answered nodes are
  cached (§13.4) and re-render instantly.
- The graph is **session-scoped** and in-memory; export is explicit and user-initiated.

### 16.4 UI placement
- Ships as a new **Insight Analyst** panel/route, flagged and off by default. It sits alongside the
  existing panels; existing pages and the deterministic dashboard are untouched.

---

## 17. Backward-compatibility & deployment (reaffirmed)
- All of §14–§16 is **additive and flagged**. With `enabled=false` (and `enableSemanticParser=false`),
  none of it runs: no semantic parse, no review dialog, no analyst, no graph. The app is byte-identical
  to the current deterministic build.
- **No deterministic analytics module is modified**; computed numbers are unchanged. The semantic model
  only changes *which physical column a concept resolves to*, with deterministic fallback always present.
- **GitHub Pages / static export / demo mode unchanged** — pure client-side TS, no server, no new heavy
  dependencies; graph rendering uses lightweight in-repo SVG (consistent with existing hand-built charts).
- Any change to §14–§16 updates this document first (§13.10).
