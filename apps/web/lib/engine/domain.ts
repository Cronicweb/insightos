/**
 * Business-domain inference.
 *
 * The engine never asks "what kind of data is this?" - it works it out from the
 * column vocabulary, then loads the matching plugin so that KPI definitions and
 * recommendation rules stay out of the core.
 */
import type { ColumnProfile, DomainDetection } from '@/lib/types';

interface Signal {
  re: RegExp;
  domain: string;
  weight: number;
  reason: string;
}

const SIGNALS: Signal[] = [
  { re: /(merchant|mcc|card|atm|branch|interchange|chargeback|fraud|balance|iban)/i, domain: 'banking', weight: 3, reason: 'card and merchant vocabulary' },
  { re: /(impression|click|ctr|cpa|roas|campaign|ad_group|creative|spend)/i, domain: 'marketing', weight: 3, reason: 'paid-media vocabulary' },
  { re: /(basket|cart|sku|checkout|order_id|shipping|coupon|gmv)/i, domain: 'ecommerce', weight: 3, reason: 'online retail vocabulary' },
  { re: /(patient|admission|readmission|diagnosis|icd|ward|clinician|length_of_stay|los)/i, domain: 'healthcare', weight: 4, reason: 'clinical vocabulary' },
  { re: /(employee|attrition|headcount|tenure|payroll|manager|hire_date|salary)/i, domain: 'hr', weight: 4, reason: 'workforce vocabulary' },
  { re: /(machine|line|shift|downtime|defect|scrap|oee|throughput|yield)/i, domain: 'manufacturing', weight: 4, reason: 'plant-floor vocabulary' },
  { re: /(gl_account|ledger|ebitda|cash_flow|opex|capex|accrual|cost_centre|cost_center)/i, domain: 'finance', weight: 3, reason: 'accounting vocabulary' },
  { re: /(supplier|warehouse|inventory|lead_time|stockout|freight|shipment)/i, domain: 'supply_chain', weight: 3, reason: 'logistics vocabulary' },
  { re: /(mrr|arr|subscription|seat|trial|churn|plan_tier)/i, domain: 'saas', weight: 3, reason: 'subscription vocabulary' },
  { re: /(quota|pipeline|opportunity|rep|territory|deal|store|category|units_sold)/i, domain: 'sales', weight: 2, reason: 'selling vocabulary' },
  { re: /(revenue|profit|margin|customer|product|region)/i, domain: 'sales', weight: 1, reason: 'general commercial vocabulary' },
];

const LABELS: Record<string, string> = {
  banking: 'Banking', marketing: 'Marketing', ecommerce: 'E-commerce', healthcare: 'Healthcare',
  hr: 'HR', manufacturing: 'Manufacturing', finance: 'Finance', supply_chain: 'Supply chain',
  saas: 'SaaS', sales: 'Sales', generic: 'General business',
};

export function detectDomain(columns: ColumnProfile[]): DomainDetection {
  const scores: Record<string, number> = {};
  const signals: DomainDetection['signals'] = [];

  for (const col of columns) {
    for (const signal of SIGNALS) {
      if (!signal.re.test(col.name)) continue;
      scores[signal.domain] = (scores[signal.domain] ?? 0) + signal.weight;
      signals.push({ column: col.name, domain: signal.domain, weight: signal.weight, reason: signal.reason });
    }
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) {
    return {
      domain: 'generic', confidence: 0.3, scores: {}, signals: [], runner_up: null,
      rationale: 'No domain vocabulary matched, so general-purpose analytics were applied.',
    };
  }
  const [domain, top] = ranked[0];
  const runnerUp = ranked[1]?.[0] ?? null;
  const total = ranked.reduce((a, [, v]) => a + v, 0);
  const confidence = Math.min(0.97, 0.45 + (top / Math.max(total, 1)) * 0.5);

  return {
    domain,
    confidence: Number(confidence.toFixed(2)),
    scores,
    signals: signals.slice(0, 12),
    runner_up: runnerUp,
    rationale: `${signals.filter((s) => s.domain === domain).length} columns carry ${LABELS[domain] ?? domain} vocabulary${runnerUp ? `, ahead of ${LABELS[runnerUp] ?? runnerUp}` : ''}.`,
  };
}

export function domainLabel(domain: string): string {
  return LABELS[domain] ?? domain;
}
