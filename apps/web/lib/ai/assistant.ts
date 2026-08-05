// InsightOS — Investigation Assistant (§29). Proactive, deterministic-first guidance.
// Observations, Suggestions, and Templates are PURE functions of deterministic analytics — no LLM,
// no invented numbers. Each carries provenance and seeds Investigation Graph nodes.

import type { ContextFocus } from './types';

export type SuggestionKind = 'observation' | 'question' | 'template';

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  title: string;
  focus: ContextFocus;
  sourcePath?: string;
  rationale?: string;
}

export interface InvestigationTemplate {
  id: string;
  name: string;
  description: string;
  steps: Array<{ question: string; focus: ContextFocus }>;
}

// Minimal, engine-agnostic shapes we read from the deterministic scorecard (§29.4).
export interface DeterministicSummary {
  kpis?: Array<{ id: string; label: string; deltaPct?: number; direction?: 'up' | 'down' | 'flat'; sourcePath: string }>;
  anomalies?: Array<{ id: string; label: string; sourcePath: string }>;
  rootCauses?: Array<{ id: string; label: string; sourcePath: string }>;
  recommendations?: Array<{ id: string; label: string; confidence?: number; sourcePath: string }>;
  qualityIssues?: Array<{ id: string; label: string; sourcePath: string }>;
  dimensions?: string[];
}

function uid(p: string): string {
  return `${p}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Observations: ranked notable findings straight from deterministic analytics (§29.1). */
export function generateObservations(summary: DeterministicSummary): Suggestion[] {
  const out: Suggestion[] = [];
  for (const k of summary.kpis ?? []) {
    if (k.deltaPct !== undefined && Math.abs(k.deltaPct) >= 5) {
      const dir = k.deltaPct < 0 ? 'dropped' : 'rose';
      out.push({
        id: uid('obs'),
        kind: 'observation',
        title: `${k.label} ${dir} ${Math.abs(k.deltaPct).toFixed(0)}%`,
        focus: { kind: 'kpi', id: k.id },
        sourcePath: k.sourcePath,
        rationale: 'Significant KPI movement in the deterministic scorecard.',
      });
    }
  }
  for (const a of summary.anomalies ?? []) {
    out.push({ id: uid('obs'), kind: 'observation', title: `${a.label} is unusual`, focus: { kind: 'anomaly' }, sourcePath: a.sourcePath, rationale: 'Flagged by deterministic anomaly detection.' });
  }
  for (const r of (summary.recommendations ?? []).filter((r) => (r.confidence ?? 0) >= 0.7)) {
    out.push({ id: uid('obs'), kind: 'observation', title: r.label, focus: { kind: 'recommendation' }, sourcePath: r.sourcePath, rationale: 'High-confidence deterministic recommendation.' });
  }
  // Rank: KPI movements first (by magnitude), then anomalies, then recommendations.
  return out.slice(0, 6);
}

/** Suggested next questions instead of a blank chat (§29.2). */
export function generateSuggestions(summary: DeterministicSummary): Suggestion[] {
  const s: Suggestion[] = [];
  const topKpi = (summary.kpis ?? []).find((k) => k.deltaPct !== undefined);
  if (topKpi) s.push({ id: uid('q'), kind: 'question', title: `Why did ${topKpi.label} change?`, focus: { kind: 'root_cause', index: 0 }, sourcePath: topKpi.sourcePath });
  s.push({ id: uid('q'), kind: 'question', title: 'Find hidden anomalies', focus: { kind: 'anomaly' } });
  if ((summary.dimensions ?? []).length > 1) s.push({ id: uid('q'), kind: 'question', title: `Compare ${summary.dimensions![0]} vs ${summary.dimensions![1]}`, focus: { kind: 'report' } });
  s.push({ id: uid('q'), kind: 'question', title: 'Find strongest drivers', focus: { kind: 'root_cause', index: 0 } });
  if ((summary.qualityIssues ?? []).length) s.push({ id: uid('q'), kind: 'question', title: 'Explain quality issues', focus: { kind: 'report' } });
  if ((summary.recommendations ?? []).length) s.push({ id: uid('q'), kind: 'question', title: 'Inspect recommendations', focus: { kind: 'recommendation' } });
  s.push({ id: uid('q'), kind: 'question', title: 'Show confidence', focus: { kind: 'report' } });
  return s;
}

/** Templates that build a multi-node graph automatically (§29.3). Steps included only when grounded. */
export function generateTemplates(summary: DeterministicSummary): InvestigationTemplate[] {
  const hasKpi = (summary.kpis ?? []).length > 0;
  const hasReco = (summary.recommendations ?? []).length > 0;
  const hasQuality = (summary.qualityIssues ?? []).length > 0;
  const hasDims = (summary.dimensions ?? []).length > 0;

  const templates: InvestigationTemplate[] = [];
  if (hasKpi)
    templates.push({
      id: 'tpl-revenue', name: 'Revenue Investigation',
      description: 'Trace the primary KPI movement to its drivers and dimensions.',
      steps: [
        { question: 'Why did the primary KPI change?', focus: { kind: 'root_cause', index: 0 } },
        { question: 'Which dimensions contributed most?', focus: { kind: 'root_cause', index: 0 } },
        { question: 'Is the movement statistically significant?', focus: { kind: 'anomaly' } },
      ],
    });
  templates.push({
    id: 'tpl-customer', name: 'Customer Investigation',
    description: 'Retention, churn, and segment behavior.',
    steps: [
      { question: 'How did retention/churn move?', focus: { kind: 'kpi', id: 'retention' } },
      { question: 'Which segments drove the change?', focus: { kind: 'root_cause', index: 0 } },
    ],
  });
  if (hasQuality)
    templates.push({
      id: 'tpl-quality', name: 'Quality Investigation',
      description: 'Data quality issues and their impact on analysis.',
      steps: [
        { question: 'What quality issues exist?', focus: { kind: 'report' } },
        { question: 'Do they affect the KPIs?', focus: { kind: 'report' } },
      ],
    });
  if (hasDims)
    templates.push({
      id: 'tpl-regional', name: 'Regional Investigation',
      description: 'Compare performance across regions/dimensions.',
      steps: [
        { question: 'Which region is most unusual?', focus: { kind: 'anomaly' } },
        { question: 'Why is that region different?', focus: { kind: 'root_cause', index: 0 } },
      ],
    });
  templates.push({
    id: 'tpl-forecast', name: 'Forecast Investigation',
    description: 'Project the trend and stress-test assumptions.',
    steps: [
      { question: 'What is the projected trend?', focus: { kind: 'forecast' } },
      { question: 'What could change the forecast?', focus: { kind: 'forecast' } },
    ],
  });
  if (hasReco)
    templates.push({
      id: 'tpl-actions', name: 'Action Investigation',
      description: 'Rank recommendations by confidence and expected impact.',
      steps: [
        { question: 'Which recommendation has the highest confidence?', focus: { kind: 'recommendation' } },
        { question: 'What should management investigate first?', focus: { kind: 'recommendation' } },
      ],
    });
  return templates;
}
