# Contributing to InsightOS

Thanks for taking the time to contribute. This document explains how the
project is laid out, what quality bar a change is held to, and how to get a
change merged.

## Ground rule: analytics must stay deterministic

InsightOS makes one promise above all others — **every number, every claim and
every recommendation is derived deterministically from the data and can be
traced to a statistical test.** The same input always produces the same output.

This has a practical consequence for contributions:

- A large language model may **rephrase** a sentence the engine has already
  produced. It may never introduce a fact, a figure, a cause or a
  recommendation. See `insightos/narrative/polish.py` — the polish layer is
  strictly optional, is disabled by default, and the un-polished sentence
  remains the source of truth.
- Any new claim in a narrative must be backed by a value the engine computed,
  and ideally by a `TestResult`.

Pull requests that make the engine's output non-reproducible will be rejected,
however good the prose reads.

## Repository layout

```
packages/analytics-core/   The engine. Pure Python, pandas + numpy only.
  insightos/statistics/    Distributions, hypothesis tests, time series.
  insightos/profiling/     Schema, type, key and relationship inference.
  insightos/quality/       Six-dimension data quality scoring.
  insightos/kpi/           Column roles, domain detection, KPI registry.
  insightos/anomaly/       Robust anomaly detection.
  insightos/root_cause/    The signature feature: explainable driver trees.
  insightos/forecast/      Forecasting with a naive benchmark.
  insightos/recommendation/Evidence-linked business recommendations.
  insightos/narrative/     Deterministic sentence generation.
  insightos/reporting/     Executive report assembly.
  insightos/visualization/ Chart specifications, each with a narrative.
apps/web/                  Next.js demo application (static export).
apps/api/                  Optional FastAPI service. Contains no analytics.
docs/                      Architecture and statistical methodology.
```

The engine has **no dependency on the web app or the API**. It is importable
and useful on its own; that is the point of the framework split.

## Local setup

```bash
# Engine
cd packages/analytics-core
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest
ruff check insightos tests

# Demo data (writes apps/web/public/demo)
insightos demo build --out ../../apps/web/public/demo

# Frontend
cd ../../apps/web
npm install
npm run dev
```

## Quality bar

Before opening a pull request:

1. `pytest` passes.
2. `ruff check insightos tests` is clean.
3. `npm run lint && npm run typecheck && npm run build` passes in `apps/web`.
4. New statistical code has a test that would **fail** if the maths were wrong.

That last point is not a formality. Three genuine defects in this codebase were
caught by tests that compared an implementation against published reference
values rather than against itself. A test that asserts the code does what the
code does is worse than no test, because it creates false confidence.

## Commit convention

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(root-cause): rank drivers by explanatory power
fix(statistics): correct Acklam coefficient in norm_ppf
docs(methodology): explain Benjamini-Hochberg control
test(pipeline): assert every chart ships a narrative
chore(ci): drop npm cache until a lockfile exists
```

Allowed types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`,
`ci`, `chore`.

## Pull requests

- Keep the diff focused on one concern.
- Explain **why**, not just what. If you changed a statistical method, say what
  was wrong with the old one.
- If behaviour changes, update `docs/methodology.md`.

## Code of Conduct

By participating you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).
