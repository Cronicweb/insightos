/**
 * Report export.
 *
 * Two formats, chosen for what a reviewer actually does with them:
 *
 *   CSV - a long, tidy table of every figure the analysis produced, each with
 *         its scope and the formula behind it. This is the format someone
 *         opens in Excel to check the arithmetic, so it carries provenance
 *         rather than presentation.
 *
 *   PDF - the browser's own print pipeline against a print stylesheet. No
 *         renderer is bundled: a client-side PDF library would add megabytes
 *         to a static site to reproduce something every browser already does
 *         well, and the printed output stays in sync with the page by
 *         construction.
 */
import type { Analysis } from '@/lib/types';

/** RFC 4180 quoting. Commas, quotes and newlines all survive a round trip. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/**
 * Flattens the analysis into one row per figure.
 *
 * A wide export would need a column per metric and would break the moment a
 * dataset produced a different metric set. Long form survives any shape.
 */
export function analysisToRows(analysis: Analysis): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [
    ['section', 'item', 'scope', 'metric', 'value', 'unit', 'detail'],
  ];

  rows.push(['dataset', 'name', 'file', 'rows', analysis.rows, 'count', analysis.dataset]);
  rows.push(['dataset', 'name', 'file', 'columns', analysis.columns, 'count', analysis.key]);
  rows.push([
    'dataset', 'domain', 'file', 'confidence',
    analysis.domain.confidence, 'ratio', analysis.domain.domain,
  ]);

  for (const k of analysis.scorecard.kpis) {
    rows.push([
      'scorecard', k.label, 'whole dataset', k.id, k.value ?? null, k.unit,
      k.formula,
    ]);
  }

  if (analysis.ledger) {
    const l = analysis.ledger;
    rows.push(['ledger', 'analysis scope', l.scope.label, 'rows', l.scope.rows, 'count', l.scope.filter_sql]);
    for (const k of l.kpis) {
      rows.push(['ledger', k.label, k.scope_label, k.id, k.value ?? null, k.unit, k.formula]);
    }
    for (const q of l.quality_rules) {
      rows.push(['data quality', q.rule, 'whole file', 'rows_affected', q.rows, 'count', `${q.detection}. ${q.treatment}`]);
      rows.push(['data quality', q.rule, 'whole file', 'pct_of_file', q.pct, 'percent', '']);
    }
    for (const step of l.reconciliation) {
      rows.push(['reconciliation', step.label, 'whole file', 'rows', step.rows, 'count', step.note]);
      rows.push(['reconciliation', step.label, 'whole file', 'revenue', step.revenue, 'currency', '']);
    }
    for (const t of l.trends) {
      for (const p of t.points) {
        rows.push([`trend ${t.grain}`, p.label, l.scope.label, 'revenue', p.revenue, 'currency', '']);
        rows.push([`trend ${t.grain}`, p.label, l.scope.label, 'orders', p.orders, 'count', '']);
        rows.push([`trend ${t.grain}`, p.label, l.scope.label, 'units', p.units, 'count', '']);
        rows.push([`trend ${t.grain}`, p.label, l.scope.label, 'customers', p.customers, 'count', '']);
      }
    }
    for (const p of l.pareto) {
      for (const e of p.entries) {
        rows.push([`pareto ${p.dimension}`, e.name, l.scope.label, 'revenue', e.value, 'currency', `rank ${e.rank}`]);
        rows.push([`pareto ${p.dimension}`, e.name, l.scope.label, 'cumulative_pct', e.cumulative_pct, 'percent', '']);
      }
    }
    if (l.rfm) {
      for (const s of l.rfm.segments) {
        rows.push(['rfm', s.segment, `as of ${l.rfm.as_of}`, 'customers', s.customers, 'count', s.action]);
        rows.push(['rfm', s.segment, `as of ${l.rfm.as_of}`, 'revenue', s.revenue, 'currency', '']);
      }
    }
  }

  for (const tree of analysis.root_causes) {
    rows.push([
      'root cause', tree.metric_label, `${tree.current_period} vs ${tree.baseline_period}`,
      'delta', tree.delta, tree.unit, tree.headline,
    ]);
    for (const n of tree.nodes) {
      rows.push([
        'root cause driver', `${n.dimension} = ${n.segment}`,
        `${tree.current_period} vs ${tree.baseline_period}`, 'contribution_pct',
        n.contribution_pct, 'percent',
        n.contribution_explanation ?? '',
      ]);
    }
  }

  for (const a of analysis.anomalies.anomalies) {
    rows.push([
      'anomaly', a.metric_label, a.period, 'observed', a.observed, '', a.narrative,
    ]);
    rows.push(['anomaly', a.metric_label, a.period, 'expected', a.expected, '', a.baseline_label ?? '']);
  }
  for (const e of analysis.anomalies.business_exceptions ?? []) {
    rows.push(['business exception', e.rule, e.scope, 'rows', e.rows, 'count', e.detail]);
  }

  for (const r of analysis.recommendations.recommendations) {
    rows.push([
      'recommendation', r.title, r.segment ?? 'all', 'priority_score', r.priority_score, 'score',
      `${r.action} | evidence: ${r.rationale}${r.hypothesis ? ' | HYPOTHESIS: ' + (r.hypothesis_reason ?? '') : ''}`,
    ]);
  }

  rows.push(['executive report', 'headline', 'whole dataset', '', null, '', analysis.report.headline]);
  rows.push(['executive report', 'summary', 'whole dataset', '', null, '', analysis.report.summary]);
  for (const section of analysis.report.sections) {
    for (const p of section.paragraphs) {
      rows.push(['executive report', section.title, 'whole dataset', '', null, '', p]);
    }
    for (const b of section.bullets) {
      rows.push(['executive report', `${section.title} (bullet)`, 'whole dataset', '', null, '', b]);
    }
  }
  for (const n of analysis.report.key_numbers) {
    rows.push(['executive report', n.label, 'whole dataset', n.id, n.value, n.unit, n.formatted]);
  }

  for (const c of analysis.limitations?.cannot_conclude ?? []) {
    rows.push(['limitation', c.claim, 'whole dataset', '', null, '', `${c.why} Requires: ${c.required_data.join('; ')}`]);
  }

  return rows;
}

export function analysisToCsv(analysis: Analysis): string {
  return toCsv(analysisToRows(analysis));
}

/** Rows -> RFC4180 CSV. Exported so query results can reuse the same quoting. */
export function rowsToCsv(rows: (string | number | null)[][]): string {
  return toCsv(rows);
}

/**
 * Trigger a browser download for text content.
 *
 * Shared by every export in the product so there is one place that knows about
 * object-URL lifetime - revoking too early cancels the download in some browsers.
 */
export function downloadText(fileName: string, content: string, mime: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: mime });
  downloadUrl(fileName, URL.createObjectURL(blob), true);
}

export function downloadUrl(fileName: string, url: string, revoke = false): void {
  if (typeof window === 'undefined') return;
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  if (revoke) window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Exported so panels can name their downloads after the dataset. */
export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'analysis';
}

export function downloadAnalysisCsv(analysis: Analysis): void {
  // The BOM keeps Excel from mangling non-ASCII product descriptions.
  downloadText(
    `insightos-${slug(analysis.dataset)}-${new Date().toISOString().slice(0, 10)}.csv`,
    `\uFEFF${analysisToCsv(analysis)}`,
    'text/csv;charset=utf-8;',
  );
}

/** A tidy CSV of one query result or one table, not the whole analysis. */
export function downloadRowsCsv(
  fileName: string,
  columns: string[],
  rows: Array<Record<string, unknown>>,
): void {
  const body = rows.map((r) =>
    columns.map((c) => {
      const v = r[c];
      if (v === null || v === undefined) return null;
      if (typeof v === 'number' || typeof v === 'string') return v;
      if (typeof v === 'bigint') return v.toString();
      if (v instanceof Date) return v.toISOString();
      return String(v);
    }),
  );
  downloadText(fileName, `\uFEFF${toCsv([columns, ...body])}`, 'text/csv;charset=utf-8;');
}

export function printReport(): void {
  if (typeof window === 'undefined') return;
  window.print();
}
