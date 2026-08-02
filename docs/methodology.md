# Methodology

Every number InsightOS publishes is computed deterministically. LLMs are permitted only
to rephrase sentences that a deterministic writer has already produced, and they are
never given the ability to introduce a figure, a segment name or a causal claim.

## 1. Profiling and type inference

Types are inferred from parse success rates rather than declared dtypes: a column is
temporal if a high fraction of non-null values parse as dates under a candidate format,
numeric if they parse as numbers, boolean if the distinct set matches a known truth
vocabulary, and categorical otherwise. Primary keys are columns that are unique and
complete; foreign keys are detected by containment of one column's value set inside
another's, weighted by cardinality so that low-cardinality coincidences are rejected.

## 2. Data quality score

Six dimensions, each scored 0-100 and combined with fixed weights:
completeness, uniqueness, validity, consistency, distribution health and timeliness.
The weights are published in the report, so a score is never a black box - the UI shows
the per-dimension contribution and the specific rows or columns that cost points.

## 3. Domain detection

Column names, roles and value vocabularies vote for a domain. Each domain in the
registry declares signal terms and required roles; the score is the normalised weighted
vote, and the result carries `confidence`, the `runner_up`, and the `signals` that fired.
The e-commerce fixture classifies as `sales` at 0.99 confidence, which is correct
behaviour and not a miss: the two domains share their entire KPI vocabulary.

## 4. KPI computation

KPIs come from a registry keyed by domain. A KPI is only computed if the roles it
requires are actually resolved in the dataset, so the system never fabricates a metric it
cannot support. Each result carries its period-over-period delta and an
`isFavourable` flag, because "cost is down 12%" and "revenue is down 12%" are not the
same news.

## 5. Anomaly detection

Two detectors run in parallel. Point anomalies use a rolling **median absolute
deviation** z-score, which does not let the outlier inflate its own baseline the way a
rolling standard deviation does. Level shifts use a cumulative-sum style scan for
sustained mean changes. Severity is `min(statistical_tier, materiality_tier)` - a
6-sigma move on a metric worth 0.2% of revenue is not an executive-level alert - and a
detected level shift suppresses the duplicate point anomalies it necessarily generates.

## 6. Root cause analysis

This is the signature engine.

The null hypothesis for every segment is: *this segment moved exactly in line with the
total.* The engine computes each segment's contribution to the aggregate delta, tests it
against that null, and controls the false discovery rate across all segments in a
dimension with **Benjamini-Hochberg** at q = 0.10. Testing dozens of segments without FDR
control would guarantee spurious "causes" - which is exactly how most dashboards produce
confident nonsense.

Surviving segments are labelled by role relative to their parent:

* **driver** - moved with the total and materially explains it
* **offset** - moved against the total, damping it
* **stable** - tested, not significant, reported so the absence is evidence too

Roles are **parent-relative**, which is what makes the tree readable: in the banking
fixture `region=East` is a driver at 193.7% of the total decline, while inside `Central`
the `Premium` segment is a driver of *Central's own growth*. The tree recurses while the
child dimension still adds explanatory power, measured as

```
0.45 * dispersion + 0.35 * concentration + 0.20 * significant_fraction
```

Dispersion rewards segments that genuinely disagree with each other, concentration
rewards a small number of segments carrying the movement, and the significant fraction
prevents a dimension from splitting purely on noise.

## 7. Forecasting

A damped-trend projection with prediction intervals derived from in-sample residuals.
It is drawn as a **band, not a line**, because a single forecast line invites executives
to read a point estimate as a commitment. The band widens with horizon, as it should.

## 8. Recommendations

Rules are deterministic functions over engine output. Each returns an impact estimate, a
confidence and an urgency, and priority is `impact x confidence x urgency` with a 1.4x
urgency multiplier on risk-flavoured rules (fraud, churn, quality). Every recommendation
carries the evidence that triggered it. **A rule that raises inside its own evaluation
abstains** and records the failure into `rule_errors` rather than emitting a
half-computed action - silence is safer than a confident wrong instruction.

## 9. Narrative

Sentences are assembled from templates bound to computed values: headline, then evidence
bullets, each traceable to a specific statistic. `narrative/polish.py` can route the
finished text through an LLM for fluency, but it is off by default, it never sees the
raw data, and its output is discarded if it changes any numeral present in the input.
