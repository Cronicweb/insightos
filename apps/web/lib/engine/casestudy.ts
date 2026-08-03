/**
 * The case study.
 *
 * A dashboard shows numbers; a case study argues a position. This module
 * assembles the argument from figures the engine has already computed - problem,
 * method, findings, implications, actions, limits - so the narrative can never
 * drift from the analysis it describes. Nothing here recomputes anything; every
 * sentence is a rendering of a value that exists elsewhere in the payload.
 */
import type {
  Analysis, CaseStudy, CaseStudySection, LedgerAudit, LimitationsReport,
} from '@/lib/types';

const money = (v: number) =>
  v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : v.toFixed(0);

const dateLabel = (iso: string | null) => {
  if (!iso) return 'n/a';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

export function buildCaseStudy(
  analysis: Analysis,
  ledger: LedgerAudit | null,
  limitations: LimitationsReport | null,
): CaseStudy {
  const sections: CaseStudySection[] = [];
  const kpi = (id: string) => ledger?.kpis.find((k) => k.id === id) ?? null;
  const revenue = kpi('revenue')?.value ?? null;
  const orders = kpi('orders')?.value ?? null;
  const customers = kpi('customers')?.value ?? null;
  const aov = kpi('aov')?.value ?? null;
  const repeatRate = kpi('repeat_rate')?.value ?? null;
  const cancelRate = kpi('cancellation_rate')?.value ?? null;

  /* -- Problem ------------------------------------------------------- */
  sections.push({
    id: 'problem',
    title: 'Problem statement',
    body:
      'A transaction extract arrives with no data dictionary, no owner and no agreed definitions. ' +
      'Before anyone can act on it, three questions have to be answered in order: what is actually in the file, ' +
      'which figures can be defended, and which conclusions the data does not license. ' +
      'Skipping the first two produces a dashboard that is fluent and wrong.',
    bullets: [
      'Define revenue defensibly on a line-item file where price is stored per unit.',
      'Separate commercial reversals from data errors before either is counted.',
      'State the scope of every headline figure so two numbers on one screen are comparable.',
      'Draw the line between what the data shows and what it merely suggests.',
    ],
  });

  /* -- Dataset & method ---------------------------------------------- */
  const methodBullets: string[] = [
    `${analysis.rows.toLocaleString('en-GB')} rows x ${analysis.columns} columns, profiled for type, cardinality, key candidates and missingness.`,
  ];
  if (ledger) {
    methodBullets.push(
      `Grain confirmed as one row per line item: ${ledger.scope.rows.toLocaleString('en-GB')} in-scope rows resolve to ${(orders ?? 0).toLocaleString('en-GB')} invoices.`,
      `Revenue defined as ${ledger.kpis[0]?.formula ?? 'quantity x unit price'} - a unit price cannot be summed, so adopting the price column as revenue would be a category error, not a rounding error.`,
      `Analysis scope: ${ledger.scope.filter_sql}, covering ${ledger.scope.rows_pct.toFixed(2)}% of rows.`,
      'Each cleaning rule is published with its predicate, row count and monetary effect, so the whole pipeline is reproducible from the panel.',
    );
    if (ledger.rfm) {
      methodBullets.push('Customer segmentation by RFM, scored on rank percentiles so the mass of single-purchase customers is not split arbitrarily across bands.');
    }
    if (ledger.pareto.length) {
      methodBullets.push('Concentration measured by Pareto curve on products, customers and countries rather than assumed at 80/20.');
    }
  }
  methodBullets.push('Anomalies flagged by robust z-score on median and MAD, with business-rule exceptions reported separately from statistical ones.');
  methodBullets.push('All computation runs client-side in DuckDB-WASM; the file never leaves the browser.');

  sections.push({
    id: 'method',
    title: 'Dataset and methodology',
    body: ledger && ledger.scope.date_min
      ? `${analysis.dataset}: transactions from ${dateLabel(ledger.scope.date_min)} to ${dateLabel(ledger.scope.date_max)}. ` +
        'Every figure below is traceable to an executable predicate and the SQL that produced it.'
      : `${analysis.dataset}. Every figure below is traceable to the SQL that produced it.`,
    bullets: methodBullets,
  });

  /* -- Findings ------------------------------------------------------- */
  const findings: string[] = [];
  if (revenue !== null && orders !== null) {
    findings.push(
      `${money(revenue)} of in-scope revenue across ${orders.toLocaleString('en-GB')} orders` +
      (aov !== null ? `, an average order value of ${aov.toFixed(2)}.` : '.'),
    );
  }
  if (customers !== null && orders !== null && customers > 0) {
    findings.push(
      `${customers.toLocaleString('en-GB')} identified customers placed those ${orders.toLocaleString('en-GB')} orders - ` +
      `${(orders / customers).toFixed(1)} orders each. Reporting invoice count as "customers" would overstate the base by that factor.`,
    );
  }
  if (repeatRate !== null && ledger?.repeat) {
    findings.push(
      `${repeatRate.toFixed(1)}% of identified customers bought more than once, and they account for ` +
      `${ledger.repeat.repeat_revenue_share_pct.toFixed(1)}% of identified revenue. The business runs on its returning base, not on acquisition.`,
    );
  }
  for (const p of ledger?.pareto ?? []) findings.push(p.headline);
  if (cancelRate !== null) {
    findings.push(`Cancellation rate ${cancelRate.toFixed(2)}% of invoices, isolated by the leading-C convention and excluded from every sales figure.`);
  }
  if (ledger?.scope.last_period_partial) {
    findings.push('The final period is truncated by the export cutoff. Read naively it looks like a collapse in demand; it is a boundary artefact and is flagged as such wherever it appears.');
  }
  if (!findings.length) findings.push(analysis.report?.headline ?? 'See the scorecard for headline movements.');

  sections.push({
    id: 'findings',
    title: 'Key findings',
    body: analysis.report?.headline ?? 'Findings are computed from the in-scope ledger and stated with their denominators.',
    bullets: findings,
  });

  /* -- Implications ---------------------------------------------------- */
  const implications: string[] = [];
  const custPareto = ledger?.pareto.find((p) => p.kind === 'customer');
  const prodPareto = ledger?.pareto.find((p) => p.kind === 'product');
  const geoPareto = ledger?.pareto.find((p) => p.kind === 'country');

  if (custPareto) {
    implications.push(
      `Revenue concentration in ${custPareto.entities_for_80pct.toLocaleString('en-GB')} customers is a retention risk before it is a growth opportunity: ` +
      'losing a handful of accounts moves the top line more than any plausible acquisition programme replaces.',
    );
  }
  if (prodPareto) {
    implications.push(
      `${prodPareto.entities - prodPareto.entities_for_80pct} of ${prodPareto.entities} products sit in the 20% tail. ` +
      'Each carries listing, holding and complexity cost that revenue alone does not reveal - a margin file would settle whether the tail pays for itself.',
    );
  }
  if (geoPareto && geoPareto.top1_share_pct > 60) {
    implications.push(
      `With ${geoPareto.entries[0]?.name} at ${geoPareto.top1_share_pct.toFixed(1)}% of revenue, it will "explain" almost any aggregate movement by size alone. ` +
      'Growth rate per market, not contribution to total, is the decision-grade comparison.',
    );
  }
  if (ledger?.repeat && ledger.repeat.anonymous_pct > 10) {
    implications.push(
      `${ledger.repeat.anonymous_pct.toFixed(1)}% of rows are unattributable to a customer. That is the ceiling on any personalisation or lifecycle programme ` +
      'until identity capture improves, and it is a measurement problem before it is a marketing one.',
    );
  }
  if (!implications.length) implications.push('Implications follow directly from the scorecard movements and their root-cause decomposition.');

  sections.push({
    id: 'implications',
    title: 'Business implications',
    body: 'What the findings mean for decisions, stated without exceeding what the data supports.',
    bullets: implications,
  });

  /* -- Actions ---------------------------------------------------------- */
  const actions = (analysis.recommendations?.recommendations ?? []).slice(0, 6).map((r) => {
    const impact = r.estimated_impact !== null && r.estimated_impact !== undefined
      ? ` Expected impact ${money(Math.abs(r.estimated_impact))} (${r.impact_basis}).`
      : '';
    const measure = r.success_measure ? ` Success measured by ${r.success_measure.replace(/\.$/, '')}.` : '';
    return `${r.title}.${impact}${measure}`;
  });
  sections.push({
    id: 'actions',
    title: 'Recommended actions',
    body: 'Each action names a segment, the evidence behind it, and what would count as success. Items that require data this file does not contain are labelled as hypotheses on the Actions tab.',
    bullets: actions.length ? actions : ['See the Actions tab for the ranked recommendation set.'],
  });

  /* -- Limitations ------------------------------------------------------ */
  sections.push({
    id: 'limitations',
    title: 'Limitations',
    body: limitations?.what_this_is ?? 'Scope of what the dataset can and cannot answer.',
    bullets: [
      ...(limitations?.what_this_is_not ?? []),
      ...(limitations?.cannot_conclude ?? []).map((c) => `${c.claim}: not answerable. ${c.why}`),
    ],
  });

  return {
    title: 'Case study',
    subtitle: `${analysis.dataset} - end-to-end analysis, from raw extract to decision`,
    sections,
    skills: [
      {
        group: 'Data engineering',
        items: [
          'SQL-style transformations in DuckDB (CTEs, window functions, percent_rank, date_trunc, date_diff)',
          'Grain resolution and key detection on an undocumented extract',
          'Type coercion and derived-measure planning',
        ],
      },
      {
        group: 'Data cleaning',
        items: [
          'Business-rule reversals separated from data errors',
          'Explicit, published predicates with row counts and monetary impact',
          'Non-destructive handling of duplicates and unidentified rows',
        ],
      },
      {
        group: 'Analytics and statistics',
        items: [
          'KPI design with stated scope, formula, numerator and denominator',
          'Robust anomaly detection (median/MAD z-scores) with false-positive suppression',
          'Contribution decomposition and root-cause trees',
          'Pareto concentration and RFM segmentation',
          'Seasonality-aware forecasting with prediction intervals',
        ],
      },
      {
        group: 'Communication',
        items: [
          'Executive narrative generated from computed evidence only',
          'Explicit limitations that name the data required to close each gap',
          'Reproducible calculation panels beside every headline figure',
        ],
      },
      {
        group: 'Software engineering',
        items: [
          'TypeScript, Next.js static export, client-side DuckDB-WASM',
          'Python analytics core with a shared, versioned payload contract',
          'Unit tests against externally verified ground truth, CI on every push',
        ],
      },
    ],
  };
}
