/**
 * Type contract for the InsightOS analytics engine payload.
 *
 * These interfaces mirror the dataclasses in `packages/analytics-core/insightos`.
 * The engine is the single source of truth: the UI never computes an analytic
 * number, it only renders one. Anything the UI needs must exist in the payload.
 */

export type Unit = 'currency' | 'percent' | 'number' | 'ratio' | 'days' | string;

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info' | string;

export interface Evidence {
  label: string;
  value: number | string | null;
  method?: string | null;
  p_value?: number | null;
  effect_size?: number | null;
  sample_size?: number | null;
  comparison?: string | null;
}

/** Every chart carries one of these. The engine refuses to emit a chart without it. */
export interface ChartNarrative {
  chart_id: string;
  title: string;
  headline: string;
  bullets: string[];
  evidence: Evidence[];
  method_notes: string[];
}

export type ChartKind =
  | 'area'
  | 'marimekko'
  | 'donut'
  | 'table'
  | 'waterfall'
  | 'forecast'
  | 'bar';

export interface TableColumnSpec {
  key: string;
  label: string;
  type: 'text' | 'bar' | 'value' | 'delta' | 'number';
  align?: 'left' | 'right';
}

export interface ChartSpec {
  id: string;
  kind: ChartKind;
  title: string;
  subtitle?: string;
  unit?: Unit;
  footnote?: string;
  narrative: ChartNarrative;
  data: Record<string, unknown>[];
  encoding: Record<string, unknown> & { columns?: TableColumnSpec[] };
}

export interface SeriesPoint {
  period: string;
  label: string;
  value: number;
  display?: string;
}

export interface Trend {
  direction: string;
  slope_per_period: number;
  slope_pct_per_period: number;
  p_value: number | null;
  tau: number;
  significant: boolean;
  n: number;
}

export interface Kpi {
  id: string;
  label: string;
  description: string;
  unit: Unit;
  value: number;
  previous_value: number | null;
  delta: number | null;
  delta_pct: number | null;
  direction: 'up' | 'down' | 'flat' | string;
  is_favourable: boolean | null;
  higher_is_better: boolean;
  additive: boolean;
  formula: string;
  series: SeriesPoint[];
  trend: Trend | null;
  sparkline: number[];
  period_label: string;
  comparison_label: string;
  contribution_ready: boolean;
  tags: string[];
}

export interface Scorecard {
  domain: string;
  grain: string;
  date_column: string;
  period_label: string;
  comparison_label: string;
  kpis: Kpi[];
  roles: { role: string; column: string; confidence: number; reason: string }[];
  seasonality: {
    detected: boolean;
    period: number | null;
    strength: number;
    peak_label: string | null;
    trough_label: string | null;
  };
  primary_kpi_id: string | null;
}

export interface RootCauseNode {
  dimension: string | null;
  segment: string | null;
  path: { dimension: string; segment: string }[];
  current: number;
  baseline: number;
  delta: number;
  delta_pct: number | null;
  contribution_pct: number | null;
  share_current_pct: number;
  share_baseline_pct: number;
  share_change_pp: number;
  expected_delta: number;
  excess_delta: number;
  excess_pct: number | null;
  growth_gap_pp: number | null;
  rows_current: number;
  rows_baseline: number;
  p_value: number | null;
  p_value_adjusted_significant: boolean;
  test_name: string;
  effect_size: number | null;
  effect_magnitude: string;
  role: 'driver' | 'stable' | 'offset' | string;
  severity: Severity;
  narrative: string;
  children: RootCauseNode[];
}

export interface DimensionScore {
  dimension: string | null;
  explanatory_power: number;
  concentration: number;
  dispersion: number;
  net_coverage: number;
  significant_segments: number;
  segments_tested: number;
  verdict: string;
}

export interface RootCauseTree {
  metric: string | null;
  metric_label: string;
  unit: Unit;
  current_period: string;
  baseline_period: string;
  comparison_type: string;
  current_value: number;
  baseline_value: number;
  delta: number;
  delta_pct: number | null;
  direction: string;
  is_favourable: boolean | null;
  severity: Severity;
  dimension_scores: DimensionScore[];
  nodes: RootCauseNode[];
  ruled_out: { kind: string; name: string; reason: string; explanatory_power?: number }[];
  headline: string;
  narrative: string[];
  confidence: number;
  method_notes: string[];
  excluded_dimensions: string[];
}

export interface Anomaly {
  metric: string | null;
  metric_label: string;
  period: string;
  index: number;
  observed: number;
  expected: number;
  deviation: number;
  deviation_pct: number | null;
  z_score: number | null;
  method: string;
  kind: string;
  severity: Severity;
  confidence: number;
  narrative: string;
}

export interface SegmentAnomaly {
  metric: string | null;
  dimension: string | null;
  segment: string | null;
  value: number;
  peer_median: number;
  robust_z: number | null;
  direction: string;
  share_of_total_pct: number;
  severity: Severity;
  narrative: string;
}

export interface AnomalyReport {
  anomalies: Anomaly[];
  segment_anomalies: SegmentAnomaly[];
  scanned_metrics: number;
  scanned_points: number;
  method_notes: string[];
  critical_count: number;
}

export interface Recommendation {
  id: string;
  title: string;
  action: string;
  rationale: string;
  category: string;
  priority: 'critical' | 'high' | 'medium' | 'low' | string;
  priority_score: number;
  confidence: number;
  effort: string;
  horizon: string;
  owner_hint: string;
  estimated_impact: number | null;
  impact_unit: Unit;
  impact_basis: string;
  metric: string | null;
  dimension: string | null;
  segment: string | null;
  evidence: Evidence[];
  triggered_by: string;
  success_measure: string;

  /*
   * Governance envelope. A recommendation that only says "increase budget" is
   * not actionable and not auditable, so the engine attaches who should own it,
   * whether it needs sign-off, and the trail of decisions that produced it.
   * Optional because the browser engine emits a leaner recommendation set.
   */
  suggested_owner?: string;
  approval_required?: boolean;
  approval_authority?: string;
  audit_trail?: string[];
  review_cadence?: string;

  /* Explainability. Answers "why did this fire, and what did it rule out?" */
  rules_fired?: string[];
  rejected_alternatives?: RejectedAlternative[] | string[];
  statistical_tests?: string[];
  evidence_count?: number;
  significance?: number | null;
  confidence_cap?: number | null;
  confidence_before_cap?: number | null;
  data_quality_impact?: string;
}

/** A candidate the rule engine considered and discarded, with the reason. */
export interface RejectedAlternative {
  id?: string;
  title?: string;
  rule?: string;
  reason: string;
  detail?: string;
}

export interface RecommendationSet {
  recommendations: Recommendation[];
  rules_evaluated: number;
  rules_fired: number;
  total_estimated_impact: number | null;
  narrative: string;
  rule_errors: string[];
  rejected_alternatives?: RejectedAlternative[] | string[];
  governance_note?: string;
}

export interface QualityDimension {
  name: string;
  score: number;
  weight: number;
  detail: string;
}

export interface QualityIssue {
  id: string;
  dimension: string | null;
  column: string | null;
  severity: Severity;
  title: string;
  detail: string;
  remediation?: string;
  affected_rows?: number;
  affected_pct?: number;
  examples?: (string | number | null)[];
}

export interface QualityReport {
  score: number;
  grade: string;
  rows: number;
  columns: number;
  usable_for_analysis: boolean;
  dimensions: QualityDimension[];
  issues: QualityIssue[];
  missing_by_column: {
    column: string;
    missing: number;
    missing_pct: number;
    dtype: string;
    semantic_type: string;
  }[];
  duplicates: {
    exact_duplicate_rows: number;
    exact_duplicate_pct: number;
    key_columns: string[];
    key_duplicate_rows: number;
    example_keys: unknown[];
  };
  outliers: {
    column: string;
    count: number;
    pct: number;
    lower_fence: number | null;
    upper_fence: number | null;
    min_outlier: number;
    max_outlier: number;
    share_of_column_total_pct: number;
    method: string;
  }[];
  cardinality: {
    column: string;
    unique: number;
    unique_pct: number;
    semantic_type: string;
    hhi: number | null;
  }[];
  invalid_values: {
    column: string;
    rule: string;
    count: number;
    pct: number;
    examples?: unknown[];
  }[];
}

export interface ColumnProfile {
  name: string;
  dtype: string;
  semantic_type: string;
  count: number;
  missing: number;
  missing_pct: number;
  unique: number;
  unique_pct: number;
  is_unique: boolean;
  is_constant: boolean;
  sample_values: (string | number | null)[];
  min: number | string | null;
  max: number | string | null;
  mean: number | null;
  median: number | null;
  std: number | null;
  top_values: { value: string; count: number; pct: number }[];
  entropy: number | null;
  min_date?: string | null;
  max_date?: string | null;
}

export interface DatasetSchema {
  name: string;
  rows: number;
  columns: ColumnProfile[];
  primary_key: string[];
  identifiers: string[];
  measures: string[];
  dimensions: string[];
  time_columns: string[];
  [key: string]: unknown;
}

export interface ReportSection {
  id: string;
  title: string;
  paragraphs: string[];
  bullets: string[];
}

export interface ExecutiveReport {
  dataset: string;
  domain: string;
  period: string;
  comparison: string | null;
  headline: string;
  summary: string;
  sections: ReportSection[];
  key_numbers: {
    id: string;
    label: string;
    value: number;
    formatted: string;
    delta_pct: number | null;
    unit: Unit;
    favourable: boolean | null;
  }[];
  confidence: number;
  generated_at: string;
  limitations: string[];
  polished: boolean;
}

export interface ForecastPoint {
  label: string;
  value: number | null;
  lower: number | null;
  upper: number | null;
  kind?: string;
}

export interface Forecast {
  metric: string | null;
  metric_label: string;
  unit: Unit;
  model: string;
  model_rationale: string;
  horizon: number;
  points: ForecastPoint[];
  narrative: string;
  caveats: string[];
  mape?: number | null;
  [key: string]: unknown;
}

export interface DomainDetection {
  domain: string;
  confidence: number;
  scores: Record<string, number>;
  signals: { column: string; domain: string; weight: number; reason: string }[];
  runner_up: string | null;
  rationale: string;
}


/* ------------------------------------------------------------------ *
 * Privacy and governance
 *
 * Analytics on a real business dataset is a privacy event. The engine
 * detects sensitive columns before anything is charted, masks them, and
 * records what it did so the decision is reviewable rather than implicit.
 * ------------------------------------------------------------------ */

export interface SensitiveField {
  column: string;
  category: string;
  confidence: number;
  detected_by: string;
  rationale: string;
  /** Python analytics-core wording. */
  policy?: string;
  /** Browser engine wording for the same concept. */
  strategy?: string;
  label?: string;
  example_masked?: string | null;
  sample_masked?: string | null;
  distinct_values?: number | null;
}

export interface PrivacyReport {
  fields: SensitiveField[];
  masked_columns: string[];
  aggregate_only_columns?: string[];
  drilldown_allowed?: boolean;
  notice?: string;
  summary?: string;
}

export interface Freshness {
  asOf: string | null;
  lagDays: number | null;
  grain: string | null;
  status: string;
  detail: string;
}

export interface GovernanceCheck {
  id: string;
  name: string;
  status: 'passed' | 'warned' | 'failed' | string;
  detail: string;
}

/**
 * Decision readiness is the question an executive actually asks: can I act on
 * this number? It is derived from quality, freshness and the governance checks,
 * and it caps the confidence any recommendation is allowed to claim.
 */
export interface GovernanceReport {
  dataset: string;
  source: string;
  sourceType: string;
  owner: string;
  steward: string;
  classification: string;
  retention: string;
  freshness: Freshness;
  qualityScore: number;
  qualityGrade: string;
  trustLevel: string;
  decisionReadiness: 'exploratory' | 'operational' | 'executive_ready' | 'blocked' | string;
  confidenceCap: number;
  readinessReasons: string[];
  checks?: GovernanceCheck[];
  lineage?: string[];
  summary?: string;
}

export interface PluginInfo {
  key: string;
  domain: string;
  label: string;
  description: string;
  kpis: string[];
  priorityDimensions: string[];
  rootCauseHints?: unknown[];
  recommendationRules?: unknown[];
}

/** The full payload written by `insightos demo build`. */
export interface Analysis {
  key: string;
  dataset: string;
  story: string;
  rows: number;
  columns: number;
  schema: DatasetSchema;
  quality: QualityReport;
  domain: DomainDetection;
  scorecard: Scorecard;
  anomalies: AnomalyReport;
  root_causes: RootCauseTree[];
  forecasts: Forecast[];
  narratives: ChartNarrative[];
  charts: ChartSpec[];
  recommendations: RecommendationSet;
  report: ExecutiveReport;
  timings_ms: Record<string, number>;
  warnings: string[];
  privacy?: PrivacyReport;
  governance?: GovernanceReport;
  plugin?: PluginInfo;
  groundTruth?: Record<string, unknown>;
}

export interface DatasetSummary {
  key: string;
  name: string;
  description: string;
  story: string;
  domain: string;
  domainConfidence: number;
  rows: number;
  columns: number;
  qualityScore: number;
  qualityGrade: string;
  headline: string;
  kpiCount: number;
  anomalyCount: number;
  recommendationCount: number;
  primaryKpi: {
    id: string;
    label: string;
    value: number;
    unit: Unit;
    deltaPct: number | null;
    isFavourable: boolean | null;
  } | null;
}

export interface DemoIndex {
  generatedAt: string;
  engineVersion: string;
  datasets: DatasetSummary[];
}
