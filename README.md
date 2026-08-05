<div align="center">

<img src="apps/web/public/icon-192.png" alt="InsightOS" width="96" height="96" />

# InsightOS

### The explainable analytics platform that tells you *why* your metrics moved — and proves it.

**Power BI shows you data. InsightOS runs the investigation.** Point it at any
dataset and it profiles the schema, scores data quality, infers the business
domain, discovers the KPIs, detects anomalies, decomposes *why* a metric moved
into an evidence-backed root-cause tree, forecasts, recommends ranked actions,
and writes the executive report — **deterministically**, with every number
traceable to a statistical test.

[![CI](https://github.com/Cronicweb/insightos/actions/workflows/ci.yml/badge.svg)](https://github.com/Cronicweb/insightos/actions/workflows/ci.yml)
[![Deploy to GitHub Pages](https://github.com/Cronicweb/insightos/actions/workflows/pages.yml/badge.svg)](https://github.com/Cronicweb/insightos/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/python-3.10%20%7C%203.11%20%7C%203.12-3776AB.svg)](https://www.python.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](https://www.typescriptlang.org/)

### [▶ Live demo — cronicweb.github.io/insightos](https://cronicweb.github.io/insightos/)

[Overview](#overview) · [Features](#key-features) · [Architecture](#architecture) · [AI Layer](#ai-architecture-insight-analyst) · [Install](#installation) · [Docs](docs/README.md)

</div>

---

> [!NOTE]
> **Screenshots and the demo GIF referenced below are produced from the running
> application** using the [capture kit](docs/assets/screenshots/README.md). Until
> a maintainer drops the captured assets into `docs/assets/screenshots/`, some
> images may not render — this is intentional, so the README never ships
> fabricated UI imagery.

<div align="center">

![InsightOS end-to-end demo](docs/assets/screenshots/demo.gif)

</div>

## Overview

Most analytics tools stop at description. They render the chart and leave the
hard part — *why did this happen, and what should I do about it* — to a human
who then spends two days slicing pivot tables.

InsightOS is an **enterprise-grade explainable analytics platform**, not a
dashboard. Its core is a **reusable, deterministic analytics engine**: point it
at a dataframe and it produces a complete, defensible investigation without
configuration. Around that core sit two thin consumers — a FastAPI service and a
zero-backend browser client — plus an **optional, flag-gated AI layer** whose
only job is to *explain* the deterministic results, never to invent them.

Three properties define the product:

- **Explainable by construction.** No chart exists without an explanation, and
  that rule is enforced in the type system, not by convention.
- **Deterministic.** The same input always produces the same output. No language
  model produces a single number, causal claim or recommendation.
- **Private by default.** In the browser, your data never leaves the tab.

## Key Features

| | Capability | What it means |
| --- | --- | --- |
| 🔎 | **Automatic profiling** | Schema, types, key candidates, cardinality and distributions with zero configuration. |
| 🩺 | **Data-quality scoring** | Six weighted dimensions collapse to a single 0–100 score and grade, with the columns that cost you points named. |
| 🧭 | **Domain & role inference** | Detects the vertical (sales, marketing, finance, banking, HR, healthcare, manufacturing) and assigns every column a role: measure, dimension, time grain, identifier. |
| 📊 | **KPI discovery** | Computes the metrics the domain implies, period over period, and picks a primary. |
| 🚨 | **Anomaly detection** | Temporal (a period breaking from its own history) and cross-sectional (a segment breaking from its peers). |
| 🌳 | **Root-cause analysis** | Decomposes a metric movement across every dimension, significance-tests each segment with FDR correction, and emits an evidence-backed cause tree. |
| 📈 | **Forecasting** | A model selected from the data, with prediction intervals, a backtest error and explicit caveats. |
| ✅ | **Ranked recommendations** | Ordered by `impact × confidence × urgency`, each carrying the rule that fired and the evidence it consumed. |
| 📝 | **Executive report** | Headline, summary, key numbers, sections and limitations — rendered as Markdown. |
| 🧪 | **Experiment design & readout** | Power/MDE sizing before launch; SRM, CUPED, sequential alpha-spending after. |
| 👥 | **Customer value** | RFM segmentation, cohort retention curves and a discounted lifetime-value model. |
| 🗄️ | **Browser SQL** | DuckDB-WASM executes every calculation as portable SQL you can read, edit and re-run. |
| 🤖 | **Insight Analyst (optional)** | A grounded, explainable assistant over the deterministic results — off by default. |

## Explainable Analytics Philosophy

When revenue falls 18%, "revenue fell 18%" is not an insight. InsightOS asks a
sharper question, and the choice of question is the whole design:

> **Null hypothesis:** this segment moved exactly in line with the total.

A segment is a **driver** only when it moved materially *differently* from the
aggregate it belongs to, and that difference survives a significance test with a
Benjamini-Hochberg false-discovery-rate correction across all segments tested.
Three consequences fall out of that definition:

- **Roles are parent-relative.** The same segment can be a drag globally and an
  engine of growth locally; a tree that reports only signs cannot express that.
- **Contributions can exceed 100%.** They are shares of a *net change*, not
  shares of a whole — clamping them to look tidy would be a lie.
- **"Moved down" ≠ "is the reason it moved down."** The waterfall colours bars
  by the role the engine assigned, not by the sign of the bar.

Each node records its contribution, p-value, sample size, the test used, and an
**explanatory-power** score. The engine also reports the dimensions it examined
and *rejected*, so a reader sees the whole search — not just the winner.

**Verifiable, not merely plausible.** The demo datasets are generated with
planted ground truth: the generator knows which segment it broke and by how
much, serialises it as `groundTruth`, and the test suite asserts the engine
recovers it.

## Deterministic Analytics

Everything the engine produces is deterministic and hand-computed. The
statistical layer is written from first principles — Welch's t-test,
Mann-Whitney U, Benjamini-Hochberg FDR control, robust MAD-based z-scores,
seasonal-trend decomposition, inverse-normal CDF — so the numerics are auditable
and the package installs anywhere. A 189-test suite validates it against
reference values and surfaced three genuine numerical defects during
development. See [Analytics Methodology](docs/methodology.md) for the detail.

**The invariant:** *no chart exists without an explanation.*
`ChartSpec.__post_init__` raises if `narrative is None`, and CI asserts the same
property across the HTTP boundary. A contributor cannot add a chart and forget
the insight panel — the engine will not construct the object.

## AI Architecture (Insight Analyst)

InsightOS ships an **additive, master-flag-gated AI layer**. With AI disabled
the application is byte-identical to the deterministic build; static export,
GitHub Pages and demo mode are unaffected. The AI **understands, explains and
answers** — it never invents a number.

- **Grounded or refused.** Every answer is grounded in cited deterministic
  artifacts, or it is refused. A response-validation guard rejects invented
  KPIs, statistics, confidence values or SQL, and falls back to a deterministic
  explanation.
- **Restricted scope.** A local intent classifier (rules + keywords, no LLM)
  and prompt-injection defense run **before any provider call**, so
  out-of-scope or malicious prompts never reach the model. Insight Analyst is
  intentionally *not* a general-purpose assistant.
- **One prompt assembler.** A single builder composes every prompt from a fixed
  6-part structure; the internal system prompt is frozen, versioned and never
  surfaced. Switching providers (Groq/OpenAI/Gemini/Claude/Ollama) touches only
  an adapter.
- **Transparent.** Every answer carries a trace: reasoning sources, provider,
  model, grounding mode, temperature and prompt version.
- **Semantic Intelligence, Investigation Graph & Decision Replay.** A
  non-destructive concept↔column semantic model, a non-chat graph of grounded
  question nodes, and portable, concept-based replay against new datasets.

Full contract: [AI Architecture](docs/ai-architecture.md) ·
[Phases 2–3](docs/ai-architecture-phase2-3.md) ·
[Integration](docs/ai-architecture-integration.md) ·
[Operating Policy](docs/ai-architecture-policy.md) ·
[Prompt Builder](docs/ai-architecture-prompt-builder.md).

## Browser-Only Processing

The deployed site runs with **no server**. Upload a CSV, Excel, Parquet or JSON
file and the entire pipeline runs inside the browser tab.

> **Your data never leaves your device. All analysis runs locally.**

That is a load-bearing architectural claim, not marketing copy. There is no
upload endpoint in the deployed application; the file is read with the File API,
parsed, and registered as a table in an in-process database. Closing the tab
destroys everything.

```
File picked (CSV / XLSX / Parquet / JSON)
  │  .xlsx flattened to CSV · PapaParse / Arrow IPC
  ▼
Arrow table in tab memory  →  DuckDB-WASM (Web Worker)
  │  SQL profiling: types, cardinality, nulls, keys, ranges
  ▼
Schema + quality → domain classifier → plugin selection
  │
  ▼
KPI discovery · anomaly scan · root cause · forecast · recommendations
  ▼
The same Analysis contract the Python engine emits
```

## Browser SQL

DuckDB-WASM is the real query engine, not a formality. Every profile statistic,
KPI aggregation, dimension rollup and contribution calculation is issued as SQL
against the registered table, and a **SQL console** exposes that SQL so it is not
a black box — you can read it, edit it and run your own queries.

The generated SQL is **portable by construction**: written in the ANSI subset
that ports to **BigQuery** and **Hive** with a bounded set of substitutions. The
console ships seven column-aware recipes (period-over-period growth, top-N per
period, running totals, Pareto, cohort retention, quantiles, `GROUPING SETS`),
each annotated with its BigQuery and Hive equivalent. See
[SQL Execution Model](docs/sql-execution-model.md) and
[SQL Portability](docs/sql-portability.md).

## Privacy Model

Before a single row is displayed, the dataset is scanned for sensitive fields
using column-name heuristics and value-shape detection (Luhn-valid card numbers,
email/phone grammars, national-ID patterns).

| Detected | Treatment |
| --- | --- |
| Email, phone | domain / country-code preserved, local part hashed |
| Card number | last four digits only |
| National ID, SSN | fully redacted |
| Customer / account ID | stable pseudonym, order preserved for joins |
| Address | truncated to region granularity |

Masking is applied at the presentation boundary, so aggregates stay exact while
identifiers never render. **Output is aggregate by default**; row-level
drill-down is an explicit, per-session opt-in. The AI layer only ever receives
already-redacted, grounded context.

## Plugin System

The core engine contains no domain knowledge. Everything a vertical needs is
declared as data in a plugin:

```
packages/analytics-core/insightos/plugins/
  banking.py   marketing.py   sales.py   retail.py
  healthcare.py   hr.py   manufacturing.py
```

Each plugin declares its KPI definitions, the dimensions worth decomposing,
which measures are additive (and therefore contribution-safe), domain-specific
root-cause and recommendation rules, and forecast settings. **Adding a vertical
is a data change, not an engine change.** The domain classifier scores every
registered plugin against the observed schema; a low-confidence match degrades
to the generic plugin rather than guessing.

## Governance Model

Every dataset carries a governance record — source, freshness, owner, quality
score, trust level and a **decision-readiness** verdict — and recommendations
degrade with the data:

| Readiness | Meaning |
| --- | --- |
| Executive ready | quality high, freshness recent, no blocking defects |
| Operational | usable for day-to-day work, known minor defects |
| Exploratory | directionally useful only; do not commit budget on it |
| Blocked | a defect invalidates the metric; recommendations suppressed |

When readiness falls, the engine lowers confidence, widens intervals, and at
`Blocked` refuses to recommend at all — it recommends fixing the data instead.
Every recommendation is an auditable record that lists the **rejected
alternatives** and why each was dismissed.

## Supported Datasets

- **Formats:** CSV, Excel (`.xlsx`), Parquet, JSON — in the browser or via the
  engine/CLI.
- **Verticals (plugins):** banking, marketing, sales, retail, healthcare, HR,
  manufacturing — with a generic fallback for anything else.
- **Shape:** any tabular dataset with at least one measure; a time column
  unlocks temporal anomalies and forecasting; dimensions unlock root-cause
  decomposition.

## Architecture

```
insightos/
├── packages/analytics-core/     the reusable engine — no web dependency
│   └── insightos/
│       ├── statistics/          hand-written tests, FDR, robust z, decomposition
│       ├── profiling/           schema, types, keys, cardinality
│       ├── quality/             six weighted dimensions → 0–100 score
│       ├── kpi/                 role assignment, domain inference, registry
│       ├── anomaly/             temporal + cross-sectional detection
│       ├── root_cause/          the decomposition engine
│       ├── forecast/            model selection, intervals, backtests
│       ├── recommendation/      deterministic rules over computed evidence
│       ├── experiment/ clv/     A/B lifecycle · RFM, cohort, LTV
│       ├── narrative/           template composition (+ optional LLM polish)
│       ├── visualization/       chart specs — data + encoding + narrative
│       ├── reporting/           executive report assembly
│       ├── plugins/             per-vertical KPIs, dimensions and rules
│       ├── pipeline.py          analyse() — the only orchestrator
│       └── cli.py               insightos profile | analyse | demo build
│
├── apps/api/                    FastAPI service over the same engine
├── apps/web/                    Next.js 14 static export (the demo you see)
│   └── lib/ai/                  the additive, flag-gated Insight Analyst layer
├── infra/                       nginx config for the containerised build
└── docs/                        architecture, methodology and AI contract
```

The engine has **no dependency on the web layer, the API, or a database**. It
takes a DataFrame and returns dataclasses; `apps/api` and `apps/web` are two
consumers of one library. See [System Architecture](docs/architecture.md) for
the full contract.

## Screenshots

> Captured from the running app — see the [capture kit](docs/assets/screenshots/README.md).

| Analysis Overview | Root-Cause Tree |
| --- | --- |
| ![Overview](docs/assets/screenshots/overview.png) | ![Root cause](docs/assets/screenshots/root-cause.png) |

| Insight Analyst | Investigation Graph |
| --- | --- |
| ![Insight Analyst](docs/assets/screenshots/insight-analyst.png) | ![Investigation graph](docs/assets/screenshots/investigation-graph.png) |

| Forecast | Executive Report |
| --- | --- |
| ![Forecast](docs/assets/screenshots/forecast.png) | ![Executive report](docs/assets/screenshots/executive-report.png) |

## Installation

### The engine, as a library

```bash
pip install ./packages/analytics-core
```

```python
import pandas as pd
from insightos.pipeline import analyse

df = pd.read_csv("transactions.csv")
result = analyse(df, name="Card Portfolio")

print(result.domain.domain, result.domain.confidence)
print(result.quality.score, result.quality.grade)
for tree in result.root_causes:
    print(tree.metric, tree.narrative.headline)
print(result.report.summary)
```

### The CLI

```bash
insightos profile data.csv
insightos analyse data.csv --out analysis.json
insightos demo build --out apps/web/public/demo
```

## Development

```bash
# 1. install the engine and generate demo data
pip install ./packages/analytics-core
insightos demo build --out apps/web/public/demo

# 2. run the web client
cd apps/web && npm install && npm run dev
```

Quality gates (mirrors CI):

```bash
# engine
cd packages/analytics-core && pip install -e ".[dev]"
pytest -q && ruff check insightos tests

# web client
cd apps/web
npm run typecheck   # tsc --noEmit
npm run test        # vitest
npm run lint        # eslint
```

## Build

```bash
cd apps/web
npm run build       # Next.js static export → apps/web/out
```

The build runs `scripts/copy-duckdb.mjs` first to stage the DuckDB-WASM assets.
Output is a fully static site with no backend requirement.

## Deployment

### Full stack, locally (Docker)

```bash
docker compose up --build
# web → http://localhost:8080
# api → http://localhost:8000/docs
```

### GitHub Pages

The [`pages.yml`](.github/workflows/pages.yml) workflow builds the static site on
every push to `main` (and weekly, to keep demo timeliness scores honest).
Crucially, **the demo JSON is not committed** — the workflow installs the engine
from source and regenerates every analysis at deploy time, so the numbers on the
live site are always produced by the code at that commit. `basePath` is injected
via `NEXT_PUBLIC_BASE_PATH` because project pages are served from `/<repo>`.

## Contributing

Contributions are welcome. The one non-negotiable rule: **analytics must stay
deterministic** — an LLM may rephrase a sentence the engine already produced, but
may never introduce a fact, figure, cause or recommendation. Start with
[CONTRIBUTING.md](CONTRIBUTING.md) and the [documentation index](docs/README.md).

- [Contributing guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md)

## Roadmap

- [x] DuckDB execution backend (shipped as DuckDB-WASM, in-browser)
- [x] Causal-inference module: difference-in-differences for campaign readouts
- [x] Cohort and retention engine with decay curves and steady-state retention
- [x] Semantic layer so metric definitions are declared once and reused
- [x] Insight Analyst: grounded, explainable AI over deterministic results
- [ ] Wire the experiment and CLV engines into the pipeline and workspace UI
- [ ] Survival analysis: Kaplan-Meier churn curves with confidence bands
- [ ] Scheduled monitoring: run the pipeline nightly and alert on new drivers
- [ ] Power BI custom visual that embeds the root-cause tree

## Documentation

The full engineering reference lives in the **[documentation index](docs/README.md)**.
Quick links:

- [System Architecture](docs/architecture.md) — module boundaries and the data contract
- [Analytics Methodology](docs/methodology.md) — the statistics, in detail
- [AI Architecture](docs/ai-architecture.md) — the grounded, flag-gated AI contract
- [SQL Execution Model](docs/sql-execution-model.md) · [SQL Portability](docs/sql-portability.md)

## Acknowledgements

InsightOS stands on a small set of excellent open-source projects:
[DuckDB](https://duckdb.org/) & DuckDB-WASM, [Apache Arrow](https://arrow.apache.org/),
[pandas](https://pandas.pydata.org/), [NumPy](https://numpy.org/),
[Next.js](https://nextjs.org/), [React](https://react.dev/),
[Recharts](https://recharts.org/), [Tailwind CSS](https://tailwindcss.com/) and
[FastAPI](https://fastapi.tiangolo.com/). Thank you to their maintainers.

## License

[MIT](LICENSE) © InsightOS contributors.
