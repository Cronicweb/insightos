/**
 * Chart specification builder.
 *
 * A chart is never emitted without a narrative. Every spec produced here
 * carries a headline, evidence-bearing bullets and method notes, because the
 * product rule is that a reader should be able to understand the finding
 * without reading the axes.
 *
 * The shapes below are the same ones the Python engine writes, so the existing
 * renderers work unchanged on browser-computed analyses.
 */
import type {
  ChartNarrative, ChartSpec, DimensionScore, Evidence, Forecast, Kpi,
  QualityReport, RootCauseTree, Unit,
} from '@/lib/types';
import { formatValue } from '@/lib/format';
import { hhi } from './stats';

export interface SegmentSlice {
  name: string;
  value: number;
  share: number;
  deltaPct: number | null;
  children?: { name: string; value: number; shareOfGroup: number }[];
}

function narrative(
  id: string, title: string, headline: string, bullets: string[],
  evidence: Evidence[], methodNotes: string[],
): ChartNarrative {
  return { chart_id: id, title, headline, bullets: bullets.filter(Boolean), evidence, method_notes: methodNotes };
}

export function heroChart(kpi: Kpi): ChartSpec {
  const values = kpi.series.map((p) => p.value);
  const first = values[0];
  const last = values[values.length - 1];
  const change = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : null;
  const peak = kpi.series[values.indexOf(Math.max(...values))];
  const trough = kpi.series[values.indexOf(Math.min(...values))];

  const bullets = [
    change === null
      ? `The metric moved from a zero base to ${formatValue(last, kpi.unit)}.`
      : `The metric ${change >= 0 ? 'rose' : 'fell'} ${Math.abs(change).toFixed(1)}% across the ${values.length} periods from ${kpi.series[0].label} to ${kpi.period_label}.`,
    kpi.trend?.significant
      ? `The trend is statistically significant (Mann-Kendall tau ${kpi.trend.tau >= 0 ? '+' : ''}${kpi.trend.tau}, p = ${kpi.trend.p_value}), moving about ${formatValue(kpi.trend.slope_per_period, kpi.unit)} per period.`
      : 'No statistically significant trend was found, so period-to-period movement should be read as noise unless an anomaly is flagged.',
    `The peak was ${formatValue(peak.value, kpi.unit)} in ${peak.label}; the trough was ${formatValue(trough.value, kpi.unit)} in ${trough.label}.`,
    kpi.delta_pct === null
      ? ''
      : `The latest period is ${kpi.delta_pct >= 0 ? 'up' : 'down'} ${Math.abs(kpi.delta_pct).toFixed(1)}% on ${kpi.comparison_label}.`,
  ];

  return {
    id: `hero.${kpi.id}`,
    kind: 'area',
    title: kpi.label,
    subtitle: `${formatValue(kpi.value, kpi.unit)} in ${kpi.period_label}`,
    unit: kpi.unit,
    footnote: '',
    narrative: narrative(
      kpi.id, kpi.label,
      bullets[0],
      bullets.slice(1),
      [
        { label: 'Periods observed', value: values.length, method: 'series length' },
        { label: 'Mann-Kendall p-value', value: kpi.trend?.p_value ?? null, method: 'Mann-Kendall trend test', p_value: kpi.trend?.p_value ?? null, sample_size: kpi.trend?.n ?? values.length },
        { label: 'Latest vs prior', value: kpi.delta_pct, comparison: kpi.comparison_label },
      ],
      [
        'Trend significance uses the Mann-Kendall rank test with a Theil-Sen slope, which is robust to a single extreme period.',
        `Values are computed as ${kpi.formula}.`,
      ],
    ),
    data: kpi.series.map((p) => ({ period: p.period, label: p.label, value: p.value, display: formatValue(p.value, kpi.unit) })),
    encoding: { x: 'label', y: 'value', valueFormat: kpi.unit },
  };
}

function compositionNarrative(id: string, title: string, metricLabel: string, dimension: string, slices: SegmentSlice[], unit: Unit): ChartNarrative {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const sorted = [...slices].sort((a, b) => b.value - a.value);
  const top = sorted[0];
  let cumulative = 0;
  let needed = 0;
  for (const s of sorted) {
    cumulative += s.value;
    needed += 1;
    if (total && cumulative / total >= 0.85) break;
  }
  const index = hhi(slices.map((s) => (total ? s.value / total : 0)));
  const concentrationWord = index >= 0.25 ? 'highly concentrated' : index >= 0.15 ? 'moderately concentrated' : 'well diversified';
  const movers = sorted.filter((s) => s.deltaPct !== null).sort((a, b) => Math.abs(b.deltaPct ?? 0) - Math.abs(a.deltaPct ?? 0));

  return narrative(
    id, title,
    `${top?.name ?? 'The leading segment'} leads ${dimension} with ${formatValue(top?.value ?? 0, unit)}, ${(top?.share ?? 0).toFixed(1)}% of the ${formatValue(total, unit)} total.`,
    [
      `${needed} of ${slices.length} ${dimension} values account for 85% of the total - a ${needed <= 2 ? 'highly uneven' : needed / slices.length < 0.6 ? 'moderately uneven' : 'fairly even'} split.`,
      `By the Herfindahl-Hirschman Index the mix is ${concentrationWord} (HHI ${index.toFixed(3)}).`,
      movers[0] && movers[0].deltaPct !== null
        ? `${movers[0].name} moved most on the prior period, ${movers[0].deltaPct >= 0 ? 'up' : 'down'} ${Math.abs(movers[0].deltaPct).toFixed(1)}%.`
        : '',
      slices.length > 6 ? `Only the largest ${Math.min(slices.length, 12)} values are charted; the remainder are immaterial individually.` : '',
    ],
    [
      { label: 'Segments', value: slices.length },
      { label: 'Herfindahl-Hirschman Index', value: index, method: 'sum of squared shares' },
      { label: 'Top segment share', value: Number((top?.share ?? 0).toFixed(2)), comparison: '% of total' },
    ],
    [
      'Concentration is measured with the Herfindahl-Hirschman Index on value shares; above 0.25 is conventionally treated as concentrated.',
      'Period-over-period change compares the latest reporting period against the immediately preceding one.',
    ],
  );
}

export function compositionCharts(
  metricLabel: string, dimension: string, unit: Unit, slices: SegmentSlice[], includeMarimekko: boolean,
): ChartSpec[] {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const data = slices.map((s) => ({ name: s.name, value: s.value, display: formatValue(s.value, unit), share: Number(s.share.toFixed(2)) }));
  const out: ChartSpec[] = [];

  if (includeMarimekko && slices.some((s) => s.children?.length)) {
    out.push({
      id: `composition.${dimension}`,
      kind: 'marimekko',
      title: `${metricLabel} composition`,
      subtitle: `by ${dimension}, split by sub-segment`,
      unit,
      footnote: `Total ${formatValue(total, unit)} across ${slices.length} groups.`,
      narrative: compositionNarrative(`composition.${dimension}`, `${metricLabel} by ${dimension}`, metricLabel, dimension, slices, unit),
      data: slices.map((s) => ({
        name: s.name, value: s.value, display: formatValue(s.value, unit), share: Number(s.share.toFixed(2)),
        children: (s.children ?? []).map((c) => ({ name: c.name, value: c.value, display: formatValue(c.value, unit), shareOfGroup: Number(c.shareOfGroup.toFixed(2)) })),
      })),
      encoding: { group: 'name', width: 'share', child: 'children', unit },
    });
  }

  out.push({
    id: `donut.${dimension}`,
    kind: 'donut',
    title: `${metricLabel} share`,
    subtitle: `by ${dimension}`,
    unit,
    footnote: '',
    narrative: compositionNarrative(`donut.${dimension}`, `${metricLabel} share by ${dimension}`, metricLabel, dimension, slices, unit),
    data,
    encoding: { name: 'name', value: 'value', unit },
  });

  out.push({
    id: `table.${dimension}`,
    kind: 'table',
    title: `${metricLabel} by ${dimension}`,
    subtitle: 'Sortable - share of total shown as a bar, period-over-period move as a pill',
    unit,
    footnote: '',
    narrative: compositionNarrative(`table.${dimension}`, `${metricLabel} by ${dimension}`, metricLabel, dimension, slices, unit),
    data: slices.map((s) => ({ name: s.name, value: s.value, display: formatValue(s.value, unit), share: Number(s.share.toFixed(2)), deltaPct: s.deltaPct })),
    encoding: {
      columns: [
        { key: 'name', label: dimension.replace(/_/g, ' '), type: 'text' },
        { key: 'share', label: '% of total', type: 'bar' },
        { key: 'display', label: metricLabel, type: 'value', align: 'right' },
        { key: 'deltaPct', label: 'Change', type: 'delta' },
      ],
    },
  });

  return out;
}

export function rootCauseChart(tree: RootCauseTree): ChartSpec {
  const drivers = tree.nodes.filter((n) => Math.abs(n.delta) > 0).slice(0, 8);
  const data: Record<string, unknown>[] = [
    { name: tree.baseline_period, kind: 'total', value: tree.baseline_value, display: formatValue(tree.baseline_value, tree.unit) },
    ...drivers.map((n) => ({ name: n.segment ?? '', kind: n.delta >= 0 ? 'increase' : 'decrease', value: n.delta, display: formatValue(n.delta, tree.unit) })),
    { name: tree.current_period, kind: 'total', value: tree.current_value, display: formatValue(tree.current_value, tree.unit) },
  ];

  const best: DimensionScore | undefined = tree.dimension_scores[0];
  return {
    id: `rootcause.${tree.metric}`,
    kind: 'waterfall',
    title: `Why ${tree.metric_label} moved`,
    subtitle: `${tree.baseline_period} to ${tree.current_period}, decomposed by ${best?.dimension ?? 'segment'}`,
    unit: tree.unit,
    footnote: '',
    narrative: narrative(
      `rootcause.${tree.metric}`,
      `What moved ${tree.metric_label}`,
      tree.headline,
      [
        ...tree.narrative.slice(1, 5),
        best ? `The strongest explanatory dimension is '${best.dimension}' (explanatory power ${(best.explanatory_power * 100).toFixed(0)}%, ${best.significant_segments} of ${best.segments_tested} segments significant after correction).` : '',
        tree.ruled_out.length ? `Ruled out: ${tree.ruled_out.map((r) => r.name).join(', ')} - movement there was too diffuse to explain the total.` : '',
      ],
      [
        { label: 'Delta', value: tree.delta, comparison: `${tree.baseline_period} to ${tree.current_period}` },
        { label: 'Delta %', value: tree.delta_pct },
        { label: 'Explanatory power', value: best?.explanatory_power ?? null, method: 'net coverage x concentration' },
        { label: 'Confidence', value: tree.confidence },
      ],
      tree.method_notes,
    ),
    data,
    encoding: { x: 'name', y: 'value', kind: 'kind', unit: tree.unit },
  };
}

export function forecastChart(forecast: Forecast, kpi: Kpi): ChartSpec {
  const history = kpi.series.map((p) => ({ label: p.label, actual: p.value, forecast: null as number | null, lower: null as number | null, upper: null as number | null }));
  // Anchor the projected line on the final actual so the two segments join up.
  if (history.length) {
    history[history.length - 1] = { ...history[history.length - 1], forecast: kpi.value, lower: kpi.value, upper: kpi.value };
  }
  const projected = forecast.points.map((p) => ({ label: p.label, actual: null as number | null, forecast: p.value, lower: p.lower, upper: p.upper }));

  return {
    id: `forecast.${forecast.metric}`,
    kind: 'forecast',
    title: `${forecast.metric_label} - next ${forecast.horizon} periods`,
    subtitle: forecast.beats_naive
      ? `Selected by rolling back-test - MASE ${(forecast.mase as number)?.toFixed?.(2) ?? forecast.mase}`
      : 'Does not beat a naive benchmark - shown for reference only',
    unit: forecast.unit,
    footnote: '',
    narrative: narrative(
      `forecast.${forecast.metric}`,
      `${forecast.metric_label} outlook`,
      forecast.narrative,
      forecast.caveats,
      [
        { label: 'Model', value: forecast.model },
        { label: 'MASE', value: (forecast.mase as number) ?? null, method: 'mean absolute scaled error vs naive' },
        { label: 'MAPE', value: forecast.mape ?? null },
        { label: 'Horizon', value: forecast.horizon },
      ],
      [
        'Models are compared by rolling-origin back-testing rather than in-sample fit, so an over-fitted model cannot win.',
        'MASE below 1.0 means the model beats a naive "same as last period" benchmark.',
      ],
    ),
    data: [...history, ...projected],
    encoding: { x: 'label', actual: 'actual', forecast: 'forecast', band: ['lower', 'upper'], unit: forecast.unit },
  };
}

export function qualityChart(quality: QualityReport): ChartSpec {
  const weakest = [...quality.dimensions].sort((a, b) => a.score - b.score)[0];
  return {
    id: 'quality.dimensions',
    kind: 'bar',
    title: 'Data quality',
    subtitle: `Overall ${quality.score.toFixed(1)}/100 - grade ${quality.grade}`,
    unit: 'score',
    footnote: '',
    narrative: narrative(
      'quality.dimensions',
      'Data quality by dimension',
      `The dataset scores ${quality.score.toFixed(1)}/100 (grade ${quality.grade}) across ${quality.dimensions.length} quality dimensions.`,
      [
        weakest ? `${weakest.name} is the weakest dimension at ${weakest.score.toFixed(1)}/100.` : '',
        ...quality.issues.slice(0, 3).map((i) => `${i.title}: ${i.detail}`),
        quality.usable_for_analysis
          ? 'Quality is sufficient for the analytics that follow; conclusions are not degraded.'
          : 'Quality is below the threshold for confident decision-making, so recommendations have been degraded to investigation only.',
      ],
      [
        { label: 'Overall score', value: quality.score },
        { label: 'Rows', value: quality.rows },
        { label: 'Columns', value: quality.columns },
        { label: 'Issues raised', value: quality.issues.length },
      ],
      [
        'Each dimension is scored 0-100 and combined using the weights shown; the weights reflect how much each dimension can distort a decision.',
        'Outliers use Tukey fences at 1.5x the interquartile range, which does not assume a normal distribution.',
      ],
    ),
    data: quality.dimensions.map((d) => ({ name: d.name, score: d.score, weight: d.weight, detail: d.detail })),
    encoding: { x: 'name', y: 'score', domain: [0, 100] },
  };
}
