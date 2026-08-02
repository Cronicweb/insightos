<div align="center">

# InsightOS

**An analytics operating system. Power BI shows you data; InsightOS tells you why it moved.**

[![CI](https://github.com/Cronicweb/insightos/actions/workflows/ci.yml/badge.svg)](https://github.com/Cronicweb/insightos/actions/workflows/ci.yml)
[![Deploy to GitHub Pages](https://github.com/Cronicweb/insightos/actions/workflows/pages.yml/badge.svg)](https://github.com/Cronicweb/insightos/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/python-3.10%20%7C%203.11%20%7C%203.12-3776AB.svg)](https://www.python.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](https://www.typescriptlang.org/)

### [Live demo &rarr; cronicweb.github.io/insightos](https://cronicweb.github.io/insightos/)

</div>

---

## What this is

Most analytics tools stop at description. They render the chart and leave the
hard part - *why did this happen, and what should I do about it* - to a human
who then spends two days slicing pivot tables.

InsightOS is a **reusable analytics engine** that performs that investigation
deterministically. Point it at a dataframe and it will, without configuration:

1. **Profile** the schema - types, primary key candidates, foreign keys, time
   columns, cardinality, distributions.
2. **Score data quality** across six weighted dimensions and tell you which
   columns cost you points.
3. **Infer the business domain** (sales, marketing, finance, banking, HR,
   healthcare, manufacturing) from column semantics, and assign each column an
   analytical **role** - measure, dimension, time grain, identifier.
4. **Discover the KPIs** that domain implies, compute them, and pick a primary.
5. **Detect anomalies** - both temporal (a period breaking from its own history)
   and cross-sectional (a segment breaking from its peers).
6. **Explain the movement.** Given a metric that moved, decompose the change
   across every available dimension, test each segment's contribution for
   significance, correct for multiple comparisons, and emit an evidence-backed
   **root-cause tree**.
7. **Forecast** each KPI with a model selected from the data, a prediction
   interval, a backtest error and an explicit list of caveats.
8. **Recommend actions**, ranked by `impact x confidence x urgency`, each one
   carrying the rule that fired and the evidence rows it consumed.
9. **Write the executive report** - headline, summary, key numbers, sections,
   limitations - as Markdown.

Everything above is **deterministic**. No language model is involved in
producing a single number, causal claim, or recommendation. An optional polish
step may rewrite already-computed sentences for tone; the UI labels whether it
ran. Turn it off and the analysis is byte-identical.

## The signature feature: root-cause analysis

When revenue falls 18%, "revenue fell 18%" is not an insight. InsightOS asks a
sharper question, and the choice of question is the whole design:

> **Null hypothesis:** this segment moved exactly in line with the total.

Not "this segment differs from its own past" - that flags every seasonal
segment. Not "this segment is large" - that flags whichever segment is biggest.
A segment is a **driver** only when it moved materially *differently* from the
aggregate it belongs to, and that difference survives a significance test with a
Benjamini-Hochberg false-discovery-rate correction across all segments tested.

Three consequences fall out of that definition, and all three are visible in the
demo:

- **Roles are parent-relative.** In the banking dataset, `region = East` is the
  dominant driver of the total decline at 193.7% contribution - it fell so far
  that it more than accounts for the whole move, with other regions offsetting.
  One level down, inside `region = Central`, the `Premium` segment is a driver of
  *Central's own growth*. The same segment can be a drag globally and an engine
  locally, and a tree that reports only signs cannot express that.
- **Contributions can exceed 100%.** They are shares of a net change, not shares
  of a whole, and clamping them to look tidy would be a lie.
- **"Moved down" is not the same as "is the reason it moved down."** The
  waterfall colours bars by the role the engine assigned - driver, offset,
  stable - not by the sign of the bar.

Each node records its contribution, its p-value, its sample size, the test used,
and an **explanatory power** score combining dispersion across segments,
concentration of the movement, and the fraction of segments that reached
significance. The engine also reports which dimensions it examined and
*rejected*, so a reader can see the whole search, not just the winner.

## Verifying the claims yourself

The demo datasets are generated with **planted ground truth**: the generator
knows which segment it broke and by how much. That block is serialised into
every payload as `groundTruth`, and the test suite asserts the engine recovers
it. The root-cause engine is therefore not merely plausible - it is measured
against a known answer.

```bash
git clone https://github.com/Cronicweb/insightos.git
cd insightos/packages/analytics-core
pip install -e ".[dev]"
pytest -q          # 62 tests
ruff check insightos tests
```

### Three real bugs the tests caught

A test suite that only ever passes proves nothing. These were found by writing
tests against known-good reference values rather than against the implementation:

| Bug | Symptom | Fix |
| --- | --- | --- |
| `norm_ppf` | Acklam's rational approximation had `e02` where the published coefficient is `e01`, skewing every inverse-normal call in the tails | corrected the exponent; now matches reference quantiles to 1e-9 |
| `welch_t_test` | two constant samples with different means returned `p = 1.0` - perfect separation read as no evidence | detect zero pooled variance and treat non-equal means as maximally significant |
| `rolling_mad_z` | a spike inside a perfectly flat window scored `z = 0`, because MAD was zero and the ratio degenerated | fall back to a scale floor so a deviation from a constant series is unbounded, not undefined |

A fourth bug in `build_forecast_chart` emitted a headline with no supporting
bullets, which would have silently violated the project's core invariant.

## The invariant

**No chart exists without an explanation.** This is enforced in the type system,
not by convention: `ChartSpec.__post_init__` raises if `narrative is None`. A
contributor cannot add a chart and forget the insight panel - the engine will
not construct the object. CI asserts the same property across the HTTP boundary.

## Architecture

```
insightos/
|
|-- packages/analytics-core/        the reusable engine - no web dependency
|   |-- insightos/
|       |-- statistics/             hand-written: t-tests, Mann-Whitney, BH-FDR,
|       |                           robust z, STL-style decomposition, ppf/cdf
|       |-- profiling/              schema, types, keys, cardinality
|       |-- quality/                six weighted dimensions -> 0-100 score
|       |-- kpi/                    role assignment, domain inference, registry
|       |-- anomaly/                temporal + cross-sectional detection
|       |-- root_cause/             the decomposition engine
|       |-- forecast/               model selection, intervals, backtests
|       |-- recommendation/         deterministic rules over computed evidence
|       |-- narrative/              template composition (+ optional LLM polish)
|       |-- visualization/          chart specs - data + encoding + narrative
|       |-- reporting/              executive report assembly
|       |-- io/                     csv / json / parquet loaders
|       |-- demo/                   generators with planted ground truth
|       |-- pipeline.py             analyse() - orchestrates all of the above
|       |-- cli.py                  insightos profile | analyse | demo build
|
|-- apps/api/                       FastAPI service over the same engine
|-- apps/web/                       Next.js 14 static export (the demo you see)
|-- infra/                          nginx config for the containerised build
`-- docs/                           architecture and methodology
```

The engine has **no dependency on the web layer, the API, or a database**. It
takes a DataFrame and returns dataclasses. `apps/api` and `apps/web` are two
consumers of one library, which is the point of shipping it as a framework
rather than an application.

### Data flow

```
DataFrame
   |
   v
profiling ---> schema, types, keys, distributions
   |
   v
quality ------> 0-100 score across 6 dimensions
   |
   v
roles + domain -> what each column MEANS analytically
   |
   v
KPI engine ----> computed metrics, period over period
   |
   +--> anomaly detection ------+
   +--> root-cause decomposition +--> narrative composition
   +--> forecasting ------------+           |
   |                                        v
   +--> recommendation rules --------> chart specs (data + encoding + insight)
                                            |
                                            v
                                    executive report
```

## Running it

### The engine, as a library

```python
import pandas as pd
from insightos.pipeline import analyse, AnalysisOptions

df = pd.read_csv("transactions.csv")
result = analyse(df, name="Card Portfolio")

print(result.domain.domain, result.domain.confidence)
print(result.quality.score, result.quality.grade)

for tree in result.root_causes:
    print(tree.metric, tree.narrative.headline)
    for node in tree.root.children:
        print(" ", node.label, node.contribution_pct, node.p_value)

print(result.report.summary)
```

### The CLI

```bash
pip install ./packages/analytics-core

insightos profile data.csv
insightos analyse data.csv --out analysis.json
insightos demo build --out apps/web/public/demo
```

### The full stack, locally

```bash
docker compose up --build
# web  -> http://localhost:8080
# api  -> http://localhost:8000/docs
```

### The frontend in development

```bash
pip install ./packages/analytics-core
insightos demo build --out apps/web/public/demo
cd apps/web && npm install && npm run dev
```

## Demo mode

The deployed site runs with **no server**. `NEXT_PUBLIC_DATA_MODE=static` makes
the client read pre-computed JSON instead of calling the API; every panel,
chart, tree and report is identical either way, because both paths render the
same engine output.

Crucially, **the JSON is not committed**. The Pages workflow installs the engine
from source and regenerates all three analyses at deploy time, so the numbers on
the live site are always produced by the code at that commit. A committed
fixture would have made every figure on the site unverifiable.

## Technology

| Layer | Choice | Why |
| --- | --- | --- |
| Engine | Python 3.10+, pandas, NumPy | the statistics are hand-written rather than pulled from SciPy, so the numerics are auditable and the package installs anywhere |
| API | FastAPI | typed request/response models over the same dataclasses |
| Web | Next.js 14 (App Router), TypeScript strict, Tailwind | static export, so the whole product is hostable on Pages |
| Charts | Recharts + two hand-built SVG components | no chart library models a marimekko's dual encoding or a role-coloured waterfall correctly |
| Quality | ruff, pytest, ESLint, tsc, GitHub Actions | four CI jobs, three Python versions |
| Delivery | Docker, Compose, GitHub Pages | one command locally, zero-config in the browser |

## Roadmap

- [ ] DuckDB execution backend for datasets that exceed memory
- [ ] Causal-inference module: difference-in-differences for campaign readouts
- [ ] Cohort and retention engine with survival curves
- [ ] Scheduled monitoring: run the pipeline nightly and alert on new drivers
- [ ] Semantic layer so metric definitions are declared once and reused
- [ ] Power BI custom visual that embeds the root-cause tree

## Resume bullets

- Designed and built **InsightOS**, an open-source analytics engine that
  automatically profiles datasets, infers business domain and KPIs, and produces
  evidence-backed root-cause explanations of metric movements - shipped as a
  reusable Python framework with a FastAPI service and a statically-hosted
  Next.js client.
- Implemented the statistical layer from first principles (Welch's t-test,
  Mann-Whitney U, Benjamini-Hochberg FDR control, robust MAD-based z-scores,
  seasonal-trend decomposition, inverse-normal CDF), validated against reference
  values by a 62-test suite that surfaced three genuine numerical defects.
- Built a root-cause decomposition engine that tests each segment against the
  null hypothesis "moved in line with the total", applies multiple-comparison
  correction across all candidate dimensions, and ranks dimensions by an
  explanatory-power score - validated against planted ground truth in synthetic
  datasets.
- Enforced the product's central guarantee - *no chart without an explanation* -
  as a construction-time invariant in the type system and as a CI assertion at
  the HTTP boundary.
- Delivered end to end: Dockerised services, four-job CI across three Python
  versions, and automated GitHub Pages deployment that recomputes all demo
  analytics from source at build time.

## Documentation

- [Architecture](docs/architecture.md) - module boundaries and the data contract
- [Methodology](docs/methodology.md) - the statistics, in detail
- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md)

## License

MIT. See [LICENSE](LICENSE).
