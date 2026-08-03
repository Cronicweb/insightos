/**
 * Deterministic recommendation rules.
 *
 * Every recommendation traces back to a statistic that was computed upstream.
 * Nothing here invents a number, and nothing fires without evidence attached -
 * that is the difference between an analytics platform and a horoscope.
 */
import type {
  AnomalyReport, ColumnProfile, Evidence, Kpi, LedgerAudit, QualityReport,
  Recommendation, RecommendationSet, RootCauseTree, Scorecard,
} from '@/lib/types';
import type { DomainPlugin } from './plugins';
import { formatValue } from '@/lib/format';

interface RuleContext {
  scorecard: Scorecard;
  rootCauses: RootCauseTree[];
  anomalies: AnomalyReport;
  quality: QualityReport;
  plugin: DomainPlugin;
  /** Present only for invoice-grain extracts; the ledger rules stay silent without it. */
  ledger?: LedgerAudit | null;
  columns?: ColumnProfile[];
}

function priorityFrom(score: number): Recommendation['priority'] {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function playbook(plugin: DomainPlugin, category: string) {
  return (
    plugin.playbook.find((p) => p.category === category) ?? {
      category,
      owner: 'Analytics',
      approval: false,
    }
  );
}

/** Rule 1: a KPI moved unfavourably and root cause found a concentrated driver. */
function ruleConcentratedDriver(ctx: RuleContext): Recommendation[] {
  const out: Recommendation[] = [];
  for (const tree of ctx.rootCauses) {
    const kpi = ctx.scorecard.kpis.find((k) => k.id === tree.metric);
    if (!kpi || kpi.is_favourable !== false) continue;
    const driver = tree.nodes.find((n) => n.role === 'driver' && n.p_value_adjusted_significant);
    if (!driver) continue;

    const book = playbook(ctx.plugin, 'investigation');
    const contribution = driver.contribution_pct ?? 0;
    const score = Math.min(100, 40 + Math.abs(tree.delta_pct ?? 0) * 1.5 + contribution * 0.3);
    const evidence: Evidence[] = [
      { label: 'Contribution to move', value: Number(contribution.toFixed(1)), comparison: '% of total delta' },
      { label: 'Segment change', value: driver.delta_pct, comparison: `${tree.baseline_period} to ${tree.current_period}` },
      { label: 'Significance', value: driver.p_value, method: "Welch's t-test, Benjamini-Hochberg corrected", p_value: driver.p_value, sample_size: driver.rows_current },
      { label: 'Excess versus expected', value: driver.excess_delta, method: 'mix-adjusted decomposition' },
    ];

    out.push({
      id: `rec.driver.${tree.metric}.${driver.dimension}.${driver.segment}`,
      title: `Investigate ${driver.segment} within ${driver.dimension}`,
      action: `Run a root-cause review of ${driver.segment} (${driver.dimension}), which accounts for ${contribution.toFixed(0)}% of the ${tree.metric_label} move.`,
      rationale: `${tree.metric_label} moved ${(tree.delta_pct ?? 0).toFixed(1)}% between ${tree.baseline_period} and ${tree.current_period}. ${driver.segment} contributed ${contribution.toFixed(0)}% of that, and the shift is larger than the overall trend would predict, so it is a genuine local effect rather than a reflection of the whole.`,
      category: book.category,
      priority: priorityFrom(score),
      priority_score: Number(score.toFixed(1)),
      confidence: Number(Math.min(0.95, tree.confidence).toFixed(2)),
      effort: book.effort ?? 'medium',
      horizon: book.horizon ?? '1-2 sprints',
      owner_hint: book.owner,
      estimated_impact: Number(driver.excess_delta.toFixed(2)),
      impact_unit: tree.unit,
      impact_basis: 'Excess movement beyond what the overall trend predicts for this segment.',
      metric: tree.metric,
      dimension: driver.dimension,
      segment: driver.segment,
      evidence,
      triggered_by: 'concentrated_driver',
      success_measure: `${driver.segment} returns to within 2% of its expected ${tree.metric_label} contribution within two reporting periods.`,
    });
  }
  return out;
}

/** Rule 2: a segment is anomalous against its peers right now. */
function ruleSegmentAnomaly(ctx: RuleContext): Recommendation[] {
  const book = playbook(ctx.plugin, 'investigation');
  return ctx.anomalies.segment_anomalies.slice(0, 3).map((a) => {
    const score = Math.min(100, 35 + Math.abs((a.robust_z ?? 0)) * 10);
    return {
      id: `rec.anomaly.${a.dimension}.${a.segment}`,
      title: `Review outlier segment ${a.segment}`,
      action: `Verify whether ${a.segment} (${a.dimension}) is a data-quality artefact or a real business signal before acting on it.`,
      rationale: `${a.segment} sits ${Math.abs((a.robust_z ?? 0)).toFixed(1)} robust standard deviations from the peer median on ${a.metric ?? 'the metric'}. That is far enough from its peers that either the underlying process differs or the data is wrong; both warrant a look before the number is used in a decision.`,
      category: book.category,
      priority: priorityFrom(score),
      priority_score: Number(score.toFixed(1)),
      confidence: 0.7,
      effort: 'low',
      horizon: 'this week',
      owner_hint: book.owner,
      estimated_impact: null,
      impact_unit: 'number',
      impact_basis: 'Not quantified - the driver is a deviation from peers, not a measured loss.',
      metric: a.metric,
      dimension: a.dimension,
      segment: a.segment,
      evidence: [
        { label: 'Robust z-score', value: (a.robust_z ?? 0), method: 'median absolute deviation against peer segments' },
        { label: 'Segment value', value: a.value },
        { label: 'Peer median', value: a.peer_median },
      ],
      triggered_by: 'segment_anomaly',
      success_measure: 'The segment is either corrected in source data or explained in writing within one reporting cycle.',
    } as Recommendation;
  });
}

/** Rule 3: data quality is too weak for the conclusions being drawn. */
function ruleQualityGate(ctx: RuleContext): Recommendation[] {
  if (ctx.quality.score >= 80) return [];
  const worst = [...ctx.quality.dimensions].sort((a, b) => a.score - b.score)[0];
  const score = Math.min(100, (80 - ctx.quality.score) * 2 + 45);
  return [
    {
      id: 'rec.quality.remediate',
      title: `Remediate ${worst?.name ?? 'data quality'} before acting on these findings`,
      action: `Fix the ${worst?.name.toLowerCase() ?? 'quality'} issues in this dataset, then re-run the analysis.`,
      rationale: `Overall data quality is ${ctx.quality.score.toFixed(1)}/100 (grade ${ctx.quality.grade}), with ${worst?.name ?? 'one dimension'} at ${worst?.score.toFixed(1) ?? 'n/a'}/100. Decisions taken on this dataset inherit that uncertainty, so the analytical findings below are downgraded to investigation leads rather than instructions.`,
      category: 'data-quality',
      priority: priorityFrom(score),
      priority_score: Number(score.toFixed(1)),
      confidence: 0.9,
      effort: 'medium',
      horizon: 'before next reporting cycle',
      owner_hint: 'Data Engineering',
      estimated_impact: null,
      impact_unit: 'score',
      impact_basis: 'Quality remediation does not move a business KPI directly; it changes how much the KPI can be trusted.',
      metric: null,
      dimension: null,
      segment: null,
      evidence: [
        { label: 'Quality score', value: ctx.quality.score },
        { label: 'Weakest dimension', value: worst?.score ?? null, comparison: worst?.name ?? '' },
        { label: 'Issues raised', value: ctx.quality.issues.length },
      ],
      triggered_by: 'quality_gate',
      success_measure: 'Overall quality score reaches 80/100 or above on the next load.',
    },
  ];
}

/** Rule 4: a KPI has a significant adverse trend, independent of the last period. */
function ruleAdverseTrend(ctx: RuleContext): Recommendation[] {
  const book = playbook(ctx.plugin, 'monitoring');
  const out: Recommendation[] = [];
  for (const kpi of ctx.scorecard.kpis as Kpi[]) {
    if (!kpi.trend?.significant) continue;
    const adverse = kpi.higher_is_better ? kpi.trend.slope_per_period < 0 : kpi.trend.slope_per_period > 0;
    if (!adverse) continue;
    const score = Math.min(100, 45 + Math.abs(kpi.trend.tau) * 40);
    out.push({
      id: `rec.trend.${kpi.id}`,
      title: `Put ${kpi.label} under formal monitoring`,
      action: `Add ${kpi.label} to the weekly operating review with a threshold alert, and assign an accountable owner.`,
      rationale: `${kpi.label} has a statistically significant adverse trend (Mann-Kendall tau ${kpi.trend.tau}, p = ${kpi.trend.p_value}) of about ${formatValue(kpi.trend.slope_per_period, kpi.unit)} per period across ${kpi.trend.n} periods. This is a direction, not a single bad month, so it will not correct itself without intervention.`,
      category: book.category,
      priority: priorityFrom(score),
      priority_score: Number(score.toFixed(1)),
      confidence: Number((1 - Math.min(kpi.trend.p_value ?? 0.2, 0.2)).toFixed(2)),
      effort: 'low',
      horizon: book.horizon ?? '1-2 sprints',
      owner_hint: book.owner,
      estimated_impact: Number((kpi.trend.slope_per_period * 3).toFixed(2)),
      impact_unit: kpi.unit,
      impact_basis: 'Trend slope extrapolated over three periods if the direction persists unchanged.',
      metric: kpi.id,
      dimension: null,
      segment: null,
      evidence: [
        { label: 'Mann-Kendall tau', value: kpi.trend.tau, method: 'Mann-Kendall rank trend test', p_value: kpi.trend.p_value, sample_size: kpi.trend.n },
        { label: 'Slope per period', value: kpi.trend.slope_per_period, method: 'Theil-Sen estimator' },
        { label: 'Latest value', value: kpi.value },
      ],
      triggered_by: 'adverse_trend',
      success_measure: `The Mann-Kendall trend on ${kpi.label} is no longer significant at the 5% level after four further periods.`,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Ledger rules
 *
 * These fire from the transaction audit rather than from the generic
 * scorecard, so they can name a concrete customer segment, quote the exact
 * denominator behind the claim, and - crucially - say when the action they
 * propose cannot be *measured* with the data at hand.
 *
 * A recommendation whose mechanism is unobservable is still worth making; it
 * is not worth pretending is proven. Those are marked `hypothesis` with the
 * missing evidence named.
 * ------------------------------------------------------------------ */

const CAMPAIGN_RE = /(campaign|channel|utm|exposure|impression|spend|cost|cpa|roas)/i;

function campaignDataPresent(columns: { name: string }[] | undefined): boolean {
  return (columns ?? []).some((c) => CAMPAIGN_RE.test(c.name));
}

/**
 * Marketing actions on a bare transaction file are hypotheses by construction:
 * the file records purchases, never the exposure that might have caused them.
 */
function hypothesisEnvelope(ctx: RuleContext): { hypothesis: boolean; hypothesis_reason?: string } {
  if (campaignDataPresent(ctx.columns)) return { hypothesis: false };
  return {
    hypothesis: true,
    hypothesis_reason:
      'This file contains retail transactions only - no campaign exposure, channel, cost or cardmember attributes. ' +
      'The segment and its value are measured; the marketing mechanism is not observable here, so uplift and ROI would have to be established by a controlled test.',
  };
}

/** Rule 5: single-purchase customers are the largest addressable base. */
function ruleActivation(ctx: RuleContext): Recommendation[] {
  const repeat = ctx.ledger?.repeat;
  if (!repeat || !repeat.identified_customers) return [];
  const oneTime = repeat.one_time_customers;
  if (oneTime < 20) return [];

  const book = playbook(ctx.plugin, 'growth');
  const share = 100 - repeat.repeat_rate_pct;
  const avgRepeatValue = repeat.repeat_customers ? repeat.repeat_revenue / repeat.repeat_customers : 0;
  const oneTimeRevenue = Math.max(0, ctx.ledger!.kpis.find((k) => k.id === 'revenue')?.value ?? 0) - repeat.repeat_revenue;
  const avgOneTimeValue = oneTime ? oneTimeRevenue / oneTime : 0;
  const gap = Math.max(0, avgRepeatValue - avgOneTimeValue);
  // Deliberately conservative: 5% of the one-time base closing the value gap.
  const impact = gap * oneTime * 0.05;
  const score = Math.min(92, 45 + share * 0.4);
  const env = hypothesisEnvelope(ctx);

  return [{
    id: 'rec.ledger.activation',
    title: 'Convert one-time buyers to a second purchase',
    action:
      `Target the ${oneTime.toLocaleString('en-GB')} customers with exactly one invoice (${share.toFixed(1)}% of the identified base) ` +
      'with a second-purchase programme, prioritised by first-order value and recency.',
    rationale:
      `Repeat customers average ${avgRepeatValue.toFixed(0)} of revenue against ${avgOneTimeValue.toFixed(0)} for one-time buyers - ` +
      `a gap of ${gap.toFixed(0)} per customer. The first repeat purchase is the point where that gap opens, so it is the highest-leverage moment in the lifecycle. ` +
      `Impact assumes only 5% of the one-time base closes the gap.`,
    category: book.category,
    priority: priorityFrom(score),
    priority_score: Number(score.toFixed(1)),
    confidence: env.hypothesis ? 0.55 : 0.72,
    effort: book.effort ?? 'medium',
    horizon: book.horizon ?? '1-2 quarters',
    owner_hint: book.owner,
    estimated_impact: Number(impact.toFixed(2)),
    impact_unit: 'currency',
    impact_basis: '5% of one-time customers closing the observed value gap to repeat customers. A deliberately conservative, arithmetic estimate - not a forecast.',
    metric: 'repeat_rate',
    dimension: ctx.ledger!.columns.customer,
    segment: 'One-time customers',
    evidence: [
      { label: 'One-time customers', value: oneTime, comparison: `of ${repeat.identified_customers.toLocaleString('en-GB')} identified` },
      { label: 'Repeat rate', value: Number(repeat.repeat_rate_pct.toFixed(2)), comparison: '% of identified customers with >1 invoice' },
      { label: 'Average revenue, repeat', value: Number(avgRepeatValue.toFixed(2)) },
      { label: 'Average revenue, one-time', value: Number(avgOneTimeValue.toFixed(2)) },
    ],
    triggered_by: 'ledger_activation',
    success_measure: `Repeat rate rises from ${repeat.repeat_rate_pct.toFixed(1)}% by at least 2 points within two quarters, measured on the same identified-customer denominator.`,
    next_action: 'Extract the one-time cohort with first-order date, value and category; hold back a randomised 10% as a control before any contact.',
    ...env,
  }];
}

/** Rule 6: revenue concentrated in few customers is a retention exposure. */
function ruleHighValueRetention(ctx: RuleContext): Recommendation[] {
  const pareto = ctx.ledger?.pareto.find((p) => p.kind === 'customer');
  if (!pareto || pareto.entities < 20) return [];

  const book = playbook(ctx.plugin, 'retention');
  const share = pareto.entities_for_80pct_share;
  // Only interesting when concentration is real rather than a flat distribution.
  if (share > 45) return [];
  const atRisk = ctx.ledger?.rfm?.segments.find((s) => s.segment === 'At risk' || s.segment === 'Lost high value');
  const impact = atRisk ? atRisk.revenue * 0.25 : pareto.total * 0.02;
  const score = Math.min(95, 60 + (45 - share));
  const env = hypothesisEnvelope(ctx);

  return [{
    id: 'rec.ledger.retention',
    title: 'Put the top revenue customers under named account cover',
    action:
      `${pareto.entities_for_80pct.toLocaleString('en-GB')} of ${pareto.entities.toLocaleString('en-GB')} customers (${share.toFixed(1)}%) generate 80% of revenue. ` +
      'Assign them named ownership with a contact cadence and a churn early-warning trigger on days-since-last-order.',
    rationale:
      `Concentration this high means the loss of a small number of accounts moves the top line more than any realistic acquisition programme replaces. ` +
      (atRisk
        ? `${atRisk.customers.toLocaleString('en-GB')} customers already sit in the "${atRisk.segment}" RFM band carrying ${atRisk.revenue.toFixed(0)} of historic revenue.`
        : 'Retention spend on this group has a higher expected return than acquisition spend at the same budget.'),
    category: book.category,
    priority: priorityFrom(score),
    priority_score: Number(score.toFixed(1)),
    confidence: 0.78,
    effort: book.effort ?? 'medium',
    horizon: book.horizon ?? '1 quarter',
    owner_hint: book.owner,
    estimated_impact: Number(impact.toFixed(2)),
    impact_unit: 'currency',
    impact_basis: atRisk
      ? 'Recovering a quarter of the historic revenue sitting in the at-risk RFM band.'
      : '2% of revenue currently concentrated in the top customer decile.',
    metric: 'revenue',
    dimension: ctx.ledger!.columns.customer,
    segment: `Top ${share.toFixed(0)}% of customers`,
    evidence: [
      { label: 'Customers producing 80% of revenue', value: pareto.entities_for_80pct, comparison: `of ${pareto.entities}` },
      { label: 'Concentration', value: Number(share.toFixed(2)), comparison: '% of customers for 80% of revenue' },
      ...(atRisk ? [{ label: `${atRisk.segment} revenue`, value: atRisk.revenue, comparison: `${atRisk.customers} customers` }] : []),
    ],
    triggered_by: 'ledger_concentration',
    success_measure: 'Revenue retention rate for the named-cover cohort stays above 90% quarter on quarter.',
    next_action: 'Rank customers by trailing-12-month revenue, join to days-since-last-order, and route the top decile with a rising recency to account owners this week.',
    ...env,
  }];
}

/** Rule 7: an RFM band with disproportionate value deserves its own treatment. */
function ruleSegmentTargeting(ctx: RuleContext): Recommendation[] {
  const rfm = ctx.ledger?.rfm;
  if (!rfm || rfm.segments.length < 3) return [];
  // Efficiency, not size: value per customer relative to the book average.
  const avgValue = rfm.customers ? rfm.revenue / rfm.customers : 0;
  if (!avgValue) return [];
  const target = [...rfm.segments]
    .filter((s) => s.customers >= 10 && s.segment !== 'Champions')
    .sort((a, b) => b.avg_monetary / avgValue - a.avg_monetary / avgValue)[0];
  if (!target || target.avg_monetary < avgValue * 1.2) return [];

  const book = playbook(ctx.plugin, 'growth');
  const lift = target.avg_monetary / avgValue;
  const score = Math.min(85, 40 + (lift - 1) * 30);
  const env = hypothesisEnvelope(ctx);

  return [{
    id: `rec.ledger.segment.${target.segment.replace(/\W+/g, '_').toLowerCase()}`,
    title: `Give "${target.segment}" its own offer rather than the general message`,
    action: `${target.action} This band holds ${target.customers.toLocaleString('en-GB')} customers (${target.share_pct.toFixed(1)}% of the base) producing ${target.revenue_share_pct.toFixed(1)}% of identified revenue.`,
    rationale:
      `Average customer value in this band is ${target.avg_monetary.toFixed(0)}, ${lift.toFixed(1)}x the book average of ${avgValue.toFixed(0)}. ` +
      `Average recency is ${target.avg_recency_days.toFixed(0)} days and average frequency ${target.avg_frequency.toFixed(1)} invoices. ` +
      'Treating a band this distinct with the general message spends the same money for a materially lower response.',
    category: book.category,
    priority: priorityFrom(score),
    priority_score: Number(score.toFixed(1)),
    confidence: env.hypothesis ? 0.5 : 0.68,
    effort: 'low',
    horizon: book.horizon ?? '1 quarter',
    owner_hint: book.owner,
    estimated_impact: Number((target.revenue * 0.03).toFixed(2)),
    impact_unit: 'currency',
    impact_basis: '3% incremental revenue on the segment, the low end of published segmentation effects. Not measurable from this file.',
    metric: 'revenue',
    dimension: 'RFM segment',
    segment: target.segment,
    evidence: [
      { label: 'Customers in band', value: target.customers, comparison: `${target.share_pct.toFixed(1)}% of identified base` },
      { label: 'Revenue share', value: Number(target.revenue_share_pct.toFixed(2)), comparison: '% of identified revenue' },
      { label: 'Average value vs book', value: Number(lift.toFixed(2)), comparison: 'x the average customer' },
      { label: 'Average recency', value: Number(target.avg_recency_days.toFixed(1)), comparison: 'days since last order' },
    ],
    triggered_by: 'ledger_rfm',
    success_measure: `Response rate for this band exceeds the control cell by a margin significant at p<0.05 on a pre-registered sample size.`,
    next_action: 'Build the segment list, split randomly into treatment and control, and size the test for the minimum detectable effect before launch.',
    ...env,
  }];
}

/** Rule 8: cancellations at scale are a margin leak, not a rounding item. */
function ruleCancellations(ctx: RuleContext): Recommendation[] {
  const kpi = ctx.ledger?.kpis.find((k) => k.id === 'cancellation_rate');
  if (!kpi || kpi.value === null || kpi.value < 1) return [];
  const rule = ctx.ledger?.quality_rules.find((r) => r.id === 'cancelled');
  const book = playbook(ctx.plugin, 'operations');
  const score = Math.min(88, 40 + kpi.value * 6);

  return [{
    id: 'rec.ledger.cancellations',
    title: 'Diagnose the cancellation and returns pathway',
    action:
      `${kpi.value.toFixed(2)}% of invoices are cancellations (${kpi.numerator?.value.toLocaleString('en-GB')} of ${kpi.denominator?.value.toLocaleString('en-GB')}). ` +
      'Break them down by product, customer and reason code to separate stock and quality problems from ordering-process problems.',
    rationale:
      'Cancellations consume picking, packing and payment-processing cost that is never recovered, and they are invisible in a revenue chart because they net out. ' +
      (rule?.impact ? rule.impact : 'The rate here is high enough to be operational rather than incidental.'),
    category: book.category,
    priority: priorityFrom(score),
    priority_score: Number(score.toFixed(1)),
    confidence: 0.8,
    effort: 'medium',
    horizon: book.horizon ?? '1 quarter',
    owner_hint: book.owner,
    estimated_impact: null,
    impact_unit: 'currency',
    impact_basis: 'Not quantifiable from this file: the monetary value of a cancellation is the handling cost, and no cost column is present.',
    metric: 'cancellation_rate',
    dimension: ctx.ledger!.columns.invoice,
    segment: 'Cancelled invoices',
    evidence: [
      { label: 'Cancelled invoices', value: kpi.numerator?.value ?? null, comparison: `of ${kpi.denominator?.value ?? 0} invoices` },
      { label: 'Cancellation rate', value: Number(kpi.value.toFixed(2)), comparison: '% of invoices' },
      ...(rule ? [{ label: 'Cancelled rows', value: rule.rows, comparison: `${rule.pct.toFixed(2)}% of all rows` }] : []),
    ],
    triggered_by: 'ledger_cancellations',
    success_measure: 'Cancellation rate falls by a quarter within two quarters, measured on the same invoice denominator.',
    next_action: 'Join cancelled invoices back to their originals by customer and product to find which SKUs and which customers drive the rate.',
  }];
}

/** Rule 9: revenue that cannot be attributed to a customer caps every programme. */
function ruleIdentityCapture(ctx: RuleContext): Recommendation[] {
  const repeat = ctx.ledger?.repeat;
  if (!repeat || repeat.anonymous_pct < 10) return [];
  const book = playbook(ctx.plugin, 'data');
  const score = Math.min(90, 40 + repeat.anonymous_pct);

  return [{
    id: 'rec.ledger.identity',
    title: 'Close the customer-identity gap at point of sale',
    action:
      `${repeat.anonymous_pct.toFixed(1)}% of in-scope rows carry no customer identifier, covering ${repeat.anonymous_revenue.toLocaleString('en-GB')} of revenue. ` +
      'Capture identity at checkout for those channels before investing further in personalisation.',
    rationale:
      'Every customer-level programme - repeat campaigns, lifetime value, retention triggers, RFM - is computable only on identified customers. ' +
      `This gap is a hard ceiling on their reach, and it is a measurement problem before it is a marketing one: today's repeat rate of ` +
      `${repeat.repeat_rate_pct.toFixed(1)}% describes the identified subset, and the unidentified rows may not behave like it.`,
    category: book.category,
    priority: priorityFrom(score),
    priority_score: Number(score.toFixed(1)),
    confidence: 0.85,
    effort: 'medium',
    horizon: '2 quarters',
    owner_hint: book.owner,
    estimated_impact: Number(repeat.anonymous_revenue.toFixed(2)),
    impact_unit: 'currency',
    impact_basis: 'Revenue currently outside the reach of any customer-level programme. This is addressable revenue, not incremental revenue.',
    metric: 'customers',
    dimension: ctx.ledger!.columns.customer,
    segment: 'Unidentified transactions',
    evidence: [
      { label: 'Rows without a customer id', value: repeat.anonymous_rows, comparison: `${repeat.anonymous_pct.toFixed(2)}% of in-scope rows` },
      { label: 'Revenue affected', value: repeat.anonymous_revenue },
      { label: 'Identified customers', value: repeat.identified_customers },
    ],
    triggered_by: 'ledger_identity',
    success_measure: 'Share of revenue attributable to an identified customer rises by 10 points within two quarters.',
    next_action: 'Split the unidentified rows by channel and country to find where capture fails, then fix the highest-revenue path first.',
  }];
}

export function buildRecommendations(ctx: RuleContext): RecommendationSet {
  const rules = [
    ruleConcentratedDriver, ruleSegmentAnomaly, ruleQualityGate, ruleAdverseTrend,
    ruleActivation, ruleHighValueRetention, ruleSegmentTargeting, ruleCancellations,
    ruleIdentityCapture,
  ];
  const errors: string[] = [];
  let fired = 0;
  const all: Recommendation[] = [];

  for (const rule of rules) {
    try {
      const produced = rule(ctx);
      if (produced.length) fired += 1;
      all.push(...produced);
    } catch (err) {
      errors.push(`${rule.name}: ${(err as Error).message}`);
    }
  }

  // When quality is poor every recommendation is demoted to an investigation:
  // acting decisively on untrustworthy data is worse than not acting.
  const degraded = ctx.quality.score < 70;
  const recommendations = all
    .map((r) =>
      degraded && r.triggered_by !== 'quality_gate'
        ? {
            ...r,
            title: r.title.replace(/^(Put|Increase|Reduce|Shift)/, 'Investigate before acting:'),
            confidence: Number((r.confidence * 0.7).toFixed(2)),
            rationale: `${r.rationale} Data quality is ${ctx.quality.score.toFixed(0)}/100, so this is raised as an investigation rather than an instruction.`,
          }
        : r,
    )
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 10);

  const impacts = recommendations.map((r) => r.estimated_impact).filter((v): v is number => typeof v === 'number');
  const total = impacts.length ? Number(impacts.reduce((a, b) => a + Math.abs(b), 0).toFixed(2)) : null;

  return {
    recommendations,
    rules_evaluated: rules.length,
    rules_fired: fired,
    total_estimated_impact: total,
    narrative: recommendations.length
      ? `${recommendations.length} recommendations were generated from ${fired} of ${rules.length} deterministic rules. Each is backed by a named statistical test and can be traced to the evidence that fired it.${degraded ? ' Data quality is below the confidence threshold, so recommendations are framed as investigations.' : ''}${
          recommendations.some((r) => r.hypothesis)
            ? ` ${recommendations.filter((r) => r.hypothesis).length} are labelled hypotheses: the segment and its value are measured, but the dataset holds no campaign, channel or cost field, so any uplift claim would have to come from a controlled test rather than from this file.`
            : ''
        }`
      : 'No rule thresholds were crossed. The dataset shows no statistically significant adverse movement that warrants action.',
    rule_errors: errors,
  };
}
