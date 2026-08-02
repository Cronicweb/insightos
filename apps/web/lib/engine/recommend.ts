/**
 * Deterministic recommendation rules.
 *
 * Every recommendation traces back to a statistic that was computed upstream.
 * Nothing here invents a number, and nothing fires without evidence attached -
 * that is the difference between an analytics platform and a horoscope.
 */
import type {
  AnomalyReport, Evidence, Kpi, QualityReport, Recommendation,
  RecommendationSet, RootCauseTree, Scorecard,
} from '@/lib/types';
import type { DomainPlugin } from './plugins';
import { formatValue } from '@/lib/format';

interface RuleContext {
  scorecard: Scorecard;
  rootCauses: RootCauseTree[];
  anomalies: AnomalyReport;
  quality: QualityReport;
  plugin: DomainPlugin;
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

export function buildRecommendations(ctx: RuleContext): RecommendationSet {
  const rules = [ruleConcentratedDriver, ruleSegmentAnomaly, ruleQualityGate, ruleAdverseTrend];
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
    .slice(0, 8);

  const impacts = recommendations.map((r) => r.estimated_impact).filter((v): v is number => typeof v === 'number');
  const total = impacts.length ? Number(impacts.reduce((a, b) => a + Math.abs(b), 0).toFixed(2)) : null;

  return {
    recommendations,
    rules_evaluated: rules.length,
    rules_fired: fired,
    total_estimated_impact: total,
    narrative: recommendations.length
      ? `${recommendations.length} recommendations were generated from ${fired} of ${rules.length} deterministic rules. Each is backed by a named statistical test and can be traced to the evidence that fired it.${degraded ? ' Data quality is below the confidence threshold, so recommendations are framed as investigations.' : ''}`
      : 'No rule thresholds were crossed. The dataset shows no statistically significant adverse movement that warrants action.',
    rule_errors: errors,
  };
}
