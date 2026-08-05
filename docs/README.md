<div align="center">

# InsightOS Documentation

**The engineering reference for an enterprise-grade explainable analytics platform.**

[Live demo](https://cronicweb.github.io/insightos/) · [Repository](https://github.com/Cronicweb/insightos) · [README](../README.md)

</div>

---

This is the documentation index for InsightOS. Start here whether you are
evaluating the platform, integrating the engine, or contributing to it. The
documents below are grouped by concern and ordered so that each builds on the
one before it.

> **Reading order for newcomers:** [Architecture](architecture.md) →
> [Analytics Methodology](methodology.md) → [AI Architecture](ai-architecture.md) →
> [SQL Execution Model](sql-execution-model.md).

## Architecture

Start here to understand how the system is layered and where analytical
judgement lives.

| Document | What it covers |
| --- | --- |
| [System Architecture](architecture.md) | Module boundaries, the strictly-downward dependency direction, and the single data contract every consumer renders. |
| [Analytics Methodology](methodology.md) | The hand-written statistics — hypothesis tests, FDR control, robust z-scores, seasonal decomposition — in full detail. |

## Analytics Engine

The deterministic core. Every number, causal claim and recommendation is
produced here and can be traced to a statistical test.

| Document | What it covers |
| --- | --- |
| [Analytics Methodology](methodology.md) | Profiling, quality scoring, KPI discovery, anomaly detection, forecasting and the recommendation rules. |
| [System Architecture](architecture.md) | How the engine orchestrates those modules through the single `pipeline.analyse()` entry point. |

## AI Layer (Insight Analyst)

The additive, flag-gated AI layer. With AI disabled the product is
byte-identical to the deterministic build — the AI understands, explains and
answers, but never invents a number.

| Document | What it covers |
| --- | --- |
| [AI Architecture](ai-architecture.md) | §1–§13 + Addendum v2 — the governing contract: grounding, tracing, budgets, caching, safe defaults. |
| [AI — Phases 2–3](ai-architecture-phase2-3.md) | §14–§16 — Semantic Intelligence, Insight Analyst and the Investigation Graph. |
| [AI — Integration](ai-architecture-integration.md) | §18–§27 — facade, pipeline integration, grounding & response validation, Compare View, Decision Replay. |
| [AI — Operating Policy](ai-architecture-policy.md) | §28–§30 — local intent classification, prompt-injection defense, refusal and system identity. |
| [AI — Prompt Builder & Registry](ai-architecture-prompt-builder.md) | §31–§32 — the single prompt assembler, the frozen internal system prompt, and the Release Candidate. |

## Semantic Engine

| Document | What it covers |
| --- | --- |
| [AI — Phases 2–3](ai-architecture-phase2-3.md) | The non-destructive concept↔column semantic model, confidence thresholds and the confirmation gate (§14 / §13.5). |

## Privacy

| Document | What it covers |
| --- | --- |
| [System Architecture](architecture.md#privacy) | Sensitive-field detection, presentation-boundary masking, and aggregate-by-default output. |
| [AI Architecture](ai-architecture.md) | How grounded context is redacted before it ever reaches a provider. |

## Governance

| Document | What it covers |
| --- | --- |
| [System Architecture](architecture.md) | The dataset governance record: source, freshness, ownership, quality, trust and the decision-readiness verdict that degrades recommendations with the data. |

## Plugin System

| Document | What it covers |
| --- | --- |
| [System Architecture](architecture.md#plugins) | How each vertical declares its KPIs, dimensions, additive measures and rules as data, keeping the core engine domain-agnostic. |

## Investigation Graph

| Document | What it covers |
| --- | --- |
| [AI — Phases 2–3](ai-architecture-phase2-3.md) | The non-chat investigation model: grounded question nodes, branching and session-scoped memory (§16). |
| [AI — Integration](ai-architecture-integration.md) | Bookmarks, history, Compare View and how nodes carry their trace (§18–§27). |

## Decision Replay

| Document | What it covers |
| --- | --- |
| [AI — Integration](ai-architecture-integration.md#decision-replay) | Serializing an investigation as a portable, concept-based workflow and replaying it against a new dataset (§26). |

## SQL & Portability

| Document | What it covers |
| --- | --- |
| [SQL Execution Model](sql-execution-model.md) | How DuckDB-WASM executes every profile, KPI and contribution query in the browser tab. |
| [SQL Portability](sql-portability.md) | The construct-translation reference across DuckDB, BigQuery and Hive. |

## Deployment

| Document | What it covers |
| --- | --- |
| [System Architecture](architecture.md) | The static-export model and why demo JSON is regenerated from source at deploy time. |
| [Contributing](../CONTRIBUTING.md) | Local stack, Docker Compose and the GitHub Pages workflow. |

## Developer Guide

| Document | What it covers |
| --- | --- |
| [Contributing](../CONTRIBUTING.md) | Repository layout, the deterministic-analytics ground rule, and the quality bar for a change. |
| [Code of Conduct](../CODE_OF_CONDUCT.md) | Community expectations. |
| [Security Policy](../SECURITY.md) | How to report a vulnerability. |

---

<div align="center">

Every document in this index maps to code in the repository. If a document and
the code disagree, the code is correct — please
[open an issue](https://github.com/Cronicweb/insightos/issues).

</div>
