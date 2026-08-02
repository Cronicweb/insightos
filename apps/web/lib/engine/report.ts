/**
 * Executive report generator.
 *
 * The output answers four questions in order: what changed, why, what it means,
 * and what to do. Anything that cannot be evidenced is stated as a limitation
 * rather than smoothed over.
 */
import type {
  AnomalyReport, DomainDetection, ExecutiveReport, QualityReport,
  RecommendationSet, RootCauseTree, Scorecard,
} from '@/lib/types';
import { formatValue } from '@/lib/format';

interface ReportInput {
  dataset: string;
  domain: DomainDetection;
  scorecard: Scorecard;
  rootCauses: RootCauseTree[];
  anomalies: AnomalyReport;
  quality: QualityReport;
  recommendations: RecommendationSet;
}

export function buildExecutiveReport(input: ReportInput): ExecutiveReport {
  const { scorecard, rootCauses, anomalies, quality, recommendations } = input;
  const primary = scorecard.kpis[0];
  const headlineTree = rootCauses[0];

  const movers = scorecard.kpis.filter((k) => k.delta_pct !== null);
  const adverse = movers.filter((k) => k.is_favourable === false);
  const favourable = movers.filter((k) => k.is_favourable === true);

  const headline = headlineTree
    ? headlineTree.headline
    : primary
      ? `${primary.label} stands at ${formatValue(primary.value, primary.unit)} in ${primary.period_label}.`
      : 'No primary KPI could be derived from this dataset.';

  const summaryParts: string[] = [];
  if (primary) {
    summaryParts.push(
      `${primary.label} ${primary.delta_pct === null ? 'stands at' : primary.delta_pct >= 0 ? 'rose to' : 'fell to'} ${formatValue(primary.value, primary.unit)} in ${primary.period_label}${primary.delta_pct === null ? '' : `, ${primary.delta_pct >= 0 ? 'up' : 'down'} ${Math.abs(primary.delta_pct).toFixed(1)}% on ${primary.comparison_label}`}.`,
    );
  }
  if (headlineTree) {
    const driver = headlineTree.nodes.find((n) => n.role === 'driver');
    if (driver) {
      summaryParts.push(
        `The move is concentrated rather than broad: ${driver.segment} within ${driver.dimension} accounts for ${(driver.contribution_pct ?? 0).toFixed(0)}% of it, and the shift there exceeds what the overall trend would predict.`,
      );
    }
  }
  summaryParts.push(
    adverse.length
      ? `${adverse.length} of ${movers.length} tracked KPIs moved unfavourably; ${favourable.length} moved in the right direction.`
      : `All ${movers.length} tracked KPIs held or improved.`,
  );
  summaryParts.push(
    recommendations.recommendations.length
      ? `${recommendations.recommendations.length} recommended actions follow, each traceable to a statistical test. The highest priority is: ${recommendations.recommendations[0].action}`
      : 'No action is recommended; nothing crossed a rule threshold.',
  );

  const sections = [
    {
      id: 'what-changed',
      title: 'What changed',
      paragraphs: [
        movers.length
          ? `Across ${scorecard.kpis.length} discovered KPIs, ${movers.length} had a comparable prior period. ${adverse.length} moved unfavourably and ${favourable.length} favourably against ${primary?.comparison_label ?? 'the prior period'}.`
          : 'This dataset covers a single period, so no period-over-period comparison is possible.',
      ],
      bullets: movers
        .slice(0, 5)
        .map((k) => `${k.label}: ${formatValue(k.value, k.unit)} (${(k.delta_pct ?? 0) >= 0 ? '+' : ''}${(k.delta_pct ?? 0).toFixed(1)}% vs ${k.comparison_label})`),
    },
    {
      id: 'why',
      title: 'Why it changed',
      paragraphs: headlineTree
        ? headlineTree.narrative.slice(0, 3)
        : ['No dimension explained enough of the movement to support a causal statement. The change appears broad-based rather than driven by an identifiable segment.'],
      bullets: headlineTree
        ? headlineTree.nodes.slice(0, 5).map((n) => `${n.segment} (${n.dimension}): ${(n.contribution_pct ?? 0).toFixed(0)}% of the move, ${(n.delta_pct ?? 0) >= 0 ? '+' : ''}${(n.delta_pct ?? 0).toFixed(1)}%${n.p_value_adjusted_significant ? ', statistically significant' : ''}`)
        : [],
    },
    {
      id: 'risk',
      title: 'Risk and data confidence',
      paragraphs: [
        `Data quality scores ${quality.score.toFixed(1)}/100 (grade ${quality.grade}) across ${quality.dimensions.length} dimensions on ${quality.rows.toLocaleString('en-GB')} rows. ${quality.usable_for_analysis ? 'That is sufficient to support the conclusions above.' : 'That is below the threshold for confident decision-making, so the conclusions above are downgraded to investigation leads.'}`,
        anomalies.anomalies.length || anomalies.segment_anomalies.length
          ? `${anomalies.anomalies.length} temporal and ${anomalies.segment_anomalies.length} cross-sectional anomalies were detected and are listed in the anomaly panel.`
          : 'No statistical anomalies were detected in either the time series or the segment cross-section.',
      ],
      bullets: quality.issues.slice(0, 4).map((i) => `${i.title} - ${i.detail}`),
    },
    {
      id: 'actions',
      title: 'Recommended actions',
      paragraphs: [recommendations.narrative],
      bullets: recommendations.recommendations.slice(0, 5).map((r) => `${r.title} (${r.priority}, owner: ${r.owner_hint}) - ${r.action}`),
    },
  ];

  const limitations = [
    'All findings are associational. The engine measures which segments moved together with the metric; it does not run a controlled experiment and cannot prove causation.',
    quality.usable_for_analysis ? 'Data quality is adequate but not perfect; residual issues are listed in the quality panel.' : 'Data quality is below the confidence threshold, which materially weakens every conclusion above.',
    'Significance testing is corrected for multiple comparisons using the Benjamini-Hochberg procedure, which controls the false discovery rate rather than eliminating false positives.',
    scorecard.kpis.length < 3 ? 'Few KPIs could be derived from the available columns, so the business picture is partial.' : '',
  ].filter(Boolean);

  const confidence = Number(
    Math.max(0.2, Math.min(0.95, (quality.score / 100) * 0.5 + (headlineTree?.confidence ?? 0.4) * 0.5)).toFixed(2),
  );

  return {
    dataset: input.dataset,
    domain: input.domain.domain,
    period: primary?.period_label ?? 'n/a',
    comparison: primary?.comparison_label ?? null,
    headline,
    summary: summaryParts.join(' '),
    sections,
    key_numbers: scorecard.kpis.slice(0, 6).map((k) => ({
      id: k.id,
      label: k.label,
      value: k.value,
      formatted: formatValue(k.value, k.unit),
      delta_pct: k.delta_pct,
      unit: k.unit,
      favourable: k.is_favourable,
    })),
    confidence,
    generated_at: new Date().toISOString(),
    limitations,
    polished: false,
  };
}
