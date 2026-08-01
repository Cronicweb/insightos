# `insightos` — analytics core

The reusable analytics engine behind [InsightOS](https://github.com/Cronicweb/insightos).
It is a plain Python library: no server, no notebook, no framework. Hand it a
`DataFrame` and it returns a fully-explained analysis object.

```python
import pandas as pd
from insightos import analyse

result = analyse(pd.read_csv("transactions.csv"), name="transactions")

print(result.domain.domain.value)          # 'banking'
print(result.quality.score, result.quality.grade)
print(result.report.summary)               # executive narrative
for tree in result.root_causes:
    print(tree.headline)
```

## What it does

| Module | Responsibility |
| --- | --- |
| `insightos.statistics` | Hypothesis tests, effect sizes, FDR control, robust trend & change-point detection — implemented from primary sources, zero SciPy dependency |
| `insightos.profiling` | Semantic type inference, primary-key discovery, foreign-key inference by value containment |
| `insightos.quality` | Six DAMA dimensions scored into one number, every issue backed by affected rows |
| `insightos.kpi` | Column-role assignment, business-domain detection, domain KPI registry and computation |
| `insightos.anomaly` | Robust-z, CUSUM and seasonal-residual anomaly detection over KPI series |
| `insightos.forecast` | Model selection between naive, drift, Holt and Holt-Winters, validated against a seasonal-naive baseline (MASE) |
| `insightos.root_cause` | The signature engine: recursive, significance-tested attribution of a metric movement to dimension segments |
| `insightos.recommendation` | Deterministic rules over the evidence above, each recommendation carrying its own justification |
| `insightos.narrative` | Template-driven prose generated from computed numbers; optional LLM pass may only rewrite, never add facts |
| `insightos.reporting` | Executive report assembly |
| `insightos.visualization` | Chart specifications — a `ChartSpec` cannot be constructed without a narrative |

## Design rules

1. **Deterministic first.** Every number in every sentence is computed before any
   language is generated. `insightos.narrative.polish` is optional and is
   contractually forbidden from introducing facts.
2. **No claim without a test.** Root-cause drivers are Welch / two-proportion /
   Poisson tested and corrected with Benjamini–Hochberg before they are called
   drivers.
3. **No chart without an explanation.** `ChartSpec.__post_init__` raises if the
   narrative is missing.
4. **Light dependencies.** pandas and numpy only. The statistical distributions
   are implemented directly (Acklam's inverse normal, continued-fraction
   incomplete beta) and unit-tested against published reference quantiles.

## Install

```bash
pip install -e "packages/analytics-core[dev]"
pytest packages/analytics-core/tests -q
ruff check packages/analytics-core/insightos
```

## CLI

```bash
insightos analyse data.csv --out analysis.json
insightos report data.csv --format md
insightos demo build --out apps/web/public/demo
```

MIT licensed.
