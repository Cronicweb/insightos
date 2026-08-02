/**
 * Domain plugins.
 *
 * The core engine contains no domain knowledge. A plugin declares which KPIs
 * matter for a business area, how to compute them from resolved roles, which
 * dimensions to interrogate first, and how to phrase a recommendation. Adding
 * an industry means adding a file here, not touching the engine.
 */

export interface KpiDefinition {
  id: string;
  label: string;
  description: string;
  unit: 'currency' | 'percent' | 'number' | 'ratio' | 'days';
  /** Roles that must resolve for this KPI to be computable. */
  requires: string[];
  /** SQL aggregate written in terms of `{role}` placeholders. */
  expression: string;
  higherIsBetter: boolean;
  /** Additive KPIs can be decomposed by segment; ratios cannot be summed. */
  additive: boolean;
  formula: string;
  tags?: string[];
}

export interface DomainPlugin {
  key: string;
  label: string;
  description: string;
  kpis: KpiDefinition[];
  priorityDimensions: string[];
  rootCauseHints: string[];
  playbook: { category: string; owner: string; approval: boolean; effort?: string; horizon?: string }[];
  glossary: Record<string, string>;
}

const SUM_REVENUE: KpiDefinition = {
  id: 'revenue', label: 'Revenue', description: 'Total monetary value recognised in the period.',
  unit: 'currency', requires: ['revenue'], expression: 'sum({revenue})',
  higherIsBetter: true, additive: true, formula: 'SUM(revenue)', tags: ['headline'],
};
const ORDERS: KpiDefinition = {
  id: 'orders', label: 'Transactions', description: 'Number of distinct commercial events.',
  unit: 'number', requires: ['orders'], expression: 'count(DISTINCT {orders})',
  higherIsBetter: true, additive: true, formula: 'COUNT(DISTINCT order)',
};
const AOV: KpiDefinition = {
  id: 'aov', label: 'Average Order Value', description: 'Revenue divided by transaction count.',
  unit: 'currency', requires: ['revenue', 'orders'],
  expression: 'sum({revenue}) / nullif(count(DISTINCT {orders}), 0)',
  higherIsBetter: true, additive: false, formula: 'SUM(revenue) / COUNT(DISTINCT order)',
};
const CUSTOMERS: KpiDefinition = {
  id: 'active_customers', label: 'Active Customers', description: 'Distinct customers seen in the period.',
  unit: 'number', requires: ['customer'], expression: 'count(DISTINCT {customer})',
  higherIsBetter: true, additive: true, formula: 'COUNT(DISTINCT customer)',
};
const ARPC: KpiDefinition = {
  id: 'revenue_per_customer', label: 'Revenue per Customer', description: 'Average monetary value of a customer relationship.',
  unit: 'currency', requires: ['revenue', 'customer'],
  expression: 'sum({revenue}) / nullif(count(DISTINCT {customer}), 0)',
  higherIsBetter: true, additive: false, formula: 'SUM(revenue) / COUNT(DISTINCT customer)',
};
const GROSS_PROFIT: KpiDefinition = {
  id: 'gross_profit', label: 'Gross Profit', description: 'Revenue less direct cost.',
  unit: 'currency', requires: ['revenue', 'cost'], expression: 'sum({revenue}) - sum({cost})',
  higherIsBetter: true, additive: true, formula: 'SUM(revenue) - SUM(cost)',
};
const MARGIN_PCT: KpiDefinition = {
  id: 'gross_margin_pct', label: 'Gross Margin', description: 'Share of revenue retained after direct cost.',
  unit: 'percent', requires: ['revenue', 'cost'],
  expression: '100.0 * (sum({revenue}) - sum({cost})) / nullif(sum({revenue}), 0)',
  higherIsBetter: true, additive: false, formula: '(revenue - cost) / revenue',
};
const UNITS: KpiDefinition = {
  id: 'units', label: 'Units', description: 'Total quantity moved.',
  unit: 'number', requires: ['quantity'], expression: 'sum({quantity})',
  higherIsBetter: true, additive: true, formula: 'SUM(quantity)',
};

function rate(id: string, label: string, description: string, flag: string, higherIsBetter: boolean): KpiDefinition {
  return {
    id, label, description, unit: 'percent', requires: [flag],
    expression: `100.0 * sum(CASE WHEN CAST({${flag}} AS VARCHAR) IN ('1','true','True','TRUE','Y','Yes','yes') THEN 1 ELSE 0 END) / nullif(count(*), 0)`,
    higherIsBetter, additive: false, formula: `flagged rows / total rows`,
  };
}

const CORE: DomainPlugin = {
  key: 'generic', label: 'General business',
  description: 'Domain-neutral KPIs derived from whichever roles resolved.',
  kpis: [SUM_REVENUE, ORDERS, AOV, CUSTOMERS, ARPC, GROSS_PROFIT, MARGIN_PCT, UNITS],
  priorityDimensions: ['region', 'segment', 'channel'],
  rootCauseHints: ['Check whether the change is broad or concentrated in one segment.'],
  playbook: [{ category: 'investigation', owner: 'Analytics', approval: false }],
  glossary: {},
};

export const PLUGINS: Record<string, DomainPlugin> = {
  generic: CORE,
  sales: {
    key: 'sales', label: 'Sales',
    description: 'Revenue, mix and pricing performance across territories and product lines.',
    kpis: [SUM_REVENUE, GROSS_PROFIT, MARGIN_PCT, AOV, ORDERS, UNITS, CUSTOMERS],
    priorityDimensions: ['region', 'segment', 'channel'],
    rootCauseHints: ['Separate volume effects from price and mix effects.'],
    playbook: [
      { category: 'revenue', owner: 'Head of Sales', approval: true },
      { category: 'pricing', owner: 'Revenue Management', approval: true },
    ],
    glossary: { aov: 'Average Order Value', 'gross_margin_pct': 'Gross margin percentage' },
  },
  ecommerce: {
    key: 'ecommerce', label: 'E-commerce',
    description: 'Basket economics, conversion and repeat purchase behaviour.',
    kpis: [SUM_REVENUE, ORDERS, AOV, CUSTOMERS, ARPC, MARGIN_PCT,
      rate('return_rate', 'Return Rate', 'Share of orders returned or refunded.', 'return_flag', false),
      rate('repeat_rate', 'Repeat Rate', 'Share of orders from returning customers.', 'repeat_flag', true)],
    priorityDimensions: ['channel', 'segment', 'region'],
    rootCauseHints: ['Check traffic source mix before blaming the product catalogue.'],
    playbook: [
      { category: 'retention', owner: 'CRM Lead', approval: false },
      { category: 'merchandising', owner: 'Category Manager', approval: true },
    ],
    glossary: {},
  },
  banking: {
    key: 'banking', label: 'Banking',
    description: 'Transaction volume, spend concentration and fraud exposure.',
    kpis: [
      { ...SUM_REVENUE, id: 'transaction_value', label: 'Transaction Value', description: 'Total value of card and account activity.' },
      ORDERS, AOV, CUSTOMERS,
      { ...ARPC, id: 'spend_per_customer', label: 'Spend per Customer' },
      rate('fraud_rate', 'Fraud Rate', 'Share of transactions flagged as fraudulent.', 'fraud_flag', false),
      rate('churn_rate', 'Attrition Rate', 'Share of customers who left in the period.', 'churn_flag', false),
    ],
    priorityDimensions: ['segment', 'region', 'channel'],
    rootCauseHints: ['Merchant concentration often explains a volume move before customer behaviour does.'],
    playbook: [
      { category: 'risk', owner: 'Financial Crime', approval: true },
      { category: 'retention', owner: 'Retail Banking', approval: true },
    ],
    glossary: { mcc: 'Merchant category code' },
  },
  marketing: {
    key: 'marketing', label: 'Marketing',
    description: 'Paid-media efficiency: reach, engagement, conversion and return.',
    kpis: [
      { id: 'spend', label: 'Media Spend', description: 'Total invested in paid media.', unit: 'currency', requires: ['cost'], expression: 'sum({cost})', higherIsBetter: false, additive: true, formula: 'SUM(spend)' },
      { id: 'impressions', label: 'Impressions', description: 'Times a creative was delivered.', unit: 'number', requires: ['impressions'], expression: 'sum({impressions})', higherIsBetter: true, additive: true, formula: 'SUM(impressions)' },
      { id: 'ctr', label: 'CTR', description: 'Clicks divided by impressions.', unit: 'percent', requires: ['clicks', 'impressions'], expression: '100.0 * sum({clicks}) / nullif(sum({impressions}), 0)', higherIsBetter: true, additive: false, formula: 'clicks / impressions' },
      { id: 'conversion_rate', label: 'Conversion Rate', description: 'Conversions divided by clicks.', unit: 'percent', requires: ['conversions', 'clicks'], expression: '100.0 * sum({conversions}) / nullif(sum({clicks}), 0)', higherIsBetter: true, additive: false, formula: 'conversions / clicks' },
      { id: 'cpa', label: 'CPA', description: 'Cost of acquiring one conversion.', unit: 'currency', requires: ['cost', 'conversions'], expression: 'sum({cost}) / nullif(sum({conversions}), 0)', higherIsBetter: false, additive: false, formula: 'spend / conversions' },
      { id: 'roas', label: 'ROAS', description: 'Revenue returned per unit of media spend.', unit: 'ratio', requires: ['revenue', 'cost'], expression: 'sum({revenue}) / nullif(sum({cost}), 0)', higherIsBetter: true, additive: false, formula: 'revenue / spend' },
      SUM_REVENUE,
    ],
    priorityDimensions: ['channel', 'segment', 'region'],
    rootCauseHints: ['A CPA move is either an auction-price effect or a conversion-rate effect - separate them.'],
    playbook: [
      { category: 'budget', owner: 'Performance Marketing', approval: true },
      { category: 'creative', owner: 'Brand Studio', approval: false },
    ],
    glossary: { ctr: 'Click-through rate', cpa: 'Cost per acquisition', roas: 'Return on ad spend' },
  },
  healthcare: {
    key: 'healthcare', label: 'Healthcare',
    description: 'Care quality and throughput: readmissions, length of stay and cost per episode.',
    kpis: [
      { id: 'episodes', label: 'Episodes', description: 'Distinct admissions or encounters.', unit: 'number', requires: ['orders'], expression: 'count(DISTINCT {orders})', higherIsBetter: true, additive: true, formula: 'COUNT(DISTINCT admission)' },
      rate('readmission_rate', 'Readmission Rate', 'Share of episodes followed by an unplanned readmission.', 'readmission_flag', false),
      { id: 'length_of_stay', label: 'Average Length of Stay', description: 'Mean days per episode.', unit: 'days', requires: ['quantity'], expression: 'avg({quantity})', higherIsBetter: false, additive: false, formula: 'AVG(length_of_stay)' },
      { id: 'cost_per_episode', label: 'Cost per Episode', description: 'Average direct cost of an episode of care.', unit: 'currency', requires: ['cost', 'orders'], expression: 'sum({cost}) / nullif(count(DISTINCT {orders}), 0)', higherIsBetter: false, additive: false, formula: 'SUM(cost) / episodes' },
      CUSTOMERS,
    ],
    priorityDimensions: ['segment', 'region'],
    rootCauseHints: ['Case mix must be ruled out before a department is held responsible.'],
    playbook: [
      { category: 'clinical', owner: 'Clinical Director', approval: true },
      { category: 'operations', owner: 'Operations Manager', approval: true },
    ],
    glossary: { los: 'Length of stay' },
  },
  hr: {
    key: 'hr', label: 'HR',
    description: 'Workforce health: attrition, headcount and payroll cost.',
    kpis: [
      { id: 'headcount', label: 'Headcount', description: 'Distinct employees in the period.', unit: 'number', requires: ['customer'], expression: 'count(DISTINCT {customer})', higherIsBetter: true, additive: true, formula: 'COUNT(DISTINCT employee)' },
      rate('attrition_rate', 'Attrition Rate', 'Share of employees who left during the period.', 'churn_flag', false),
      { id: 'payroll_cost', label: 'Payroll Cost', description: 'Total compensation expense.', unit: 'currency', requires: ['cost'], expression: 'sum({cost})', higherIsBetter: false, additive: true, formula: 'SUM(salary)' },
      { id: 'cost_per_head', label: 'Cost per Head', description: 'Average compensation per employee.', unit: 'currency', requires: ['cost', 'customer'], expression: 'sum({cost}) / nullif(count(DISTINCT {customer}), 0)', higherIsBetter: false, additive: false, formula: 'SUM(salary) / headcount' },
    ],
    priorityDimensions: ['segment', 'region'],
    rootCauseHints: ['Attrition is usually concentrated in one department or one tenure band.'],
    playbook: [
      { category: 'retention', owner: 'HR Business Partner', approval: true },
      { category: 'compensation', owner: 'Reward Lead', approval: true },
    ],
    glossary: {},
  },
  manufacturing: {
    key: 'manufacturing', label: 'Manufacturing',
    description: 'Plant performance: output, downtime and quality yield.',
    kpis: [
      { id: 'output_units', label: 'Output', description: 'Total units produced.', unit: 'number', requires: ['quantity'], expression: 'sum({quantity})', higherIsBetter: true, additive: true, formula: 'SUM(units)' },
      { id: 'average_downtime', label: 'Average Downtime', description: 'Mean unplanned stoppage per run.', unit: 'number', requires: ['downtime'], expression: 'avg({downtime})', higherIsBetter: false, additive: false, formula: 'AVG(downtime_minutes)' },
      { id: 'defect_rate', label: 'Defect Rate', description: 'Defective units as a share of output.', unit: 'percent', requires: ['defects', 'quantity'], expression: '100.0 * sum({defects}) / nullif(sum({quantity}), 0)', higherIsBetter: false, additive: false, formula: 'defects / units' },
      { id: 'downtime_total', label: 'Total Downtime', description: 'Total minutes lost to stoppages.', unit: 'number', requires: ['downtime'], expression: 'sum({downtime})', higherIsBetter: false, additive: true, formula: 'SUM(downtime_minutes)' },
    ],
    priorityDimensions: ['segment', 'region'],
    rootCauseHints: ['Downtime concentrated on one line points at an asset, not at the shift pattern.'],
    playbook: [
      { category: 'maintenance', owner: 'Plant Engineering', approval: true },
      { category: 'quality', owner: 'Quality Manager', approval: true },
    ],
    glossary: { oee: 'Overall equipment effectiveness' },
  },
  finance: {
    key: 'finance', label: 'Finance',
    description: 'Profitability and cost control.',
    kpis: [SUM_REVENUE, { id: 'expenses', label: 'Expenses', description: 'Total recognised cost.', unit: 'currency', requires: ['cost'], expression: 'sum({cost})', higherIsBetter: false, additive: true, formula: 'SUM(cost)' }, GROSS_PROFIT, MARGIN_PCT],
    priorityDimensions: ['segment', 'region'],
    rootCauseHints: ['Check whether a margin move is revenue-led or cost-led before acting.'],
    playbook: [{ category: 'cost', owner: 'Finance Business Partner', approval: true }],
    glossary: {},
  },
  saas: {
    key: 'saas', label: 'SaaS',
    description: 'Subscription revenue and retention.',
    kpis: [SUM_REVENUE, CUSTOMERS, ARPC, rate('churn_rate', 'Churn Rate', 'Share of accounts that cancelled.', 'churn_flag', false), MARGIN_PCT],
    priorityDimensions: ['segment', 'channel', 'region'],
    rootCauseHints: ['Split logo churn from revenue churn.'],
    playbook: [{ category: 'retention', owner: 'Customer Success', approval: false }],
    glossary: {},
  },
  supply_chain: {
    key: 'supply_chain', label: 'Supply chain',
    description: 'Fulfilment reliability and inventory efficiency.',
    kpis: [UNITS, SUM_REVENUE, { id: 'cost_per_unit', label: 'Cost per Unit', description: 'Landed cost of a single unit.', unit: 'currency', requires: ['cost', 'quantity'], expression: 'sum({cost}) / nullif(sum({quantity}), 0)', higherIsBetter: false, additive: false, formula: 'SUM(cost) / SUM(units)' }, ORDERS],
    priorityDimensions: ['region', 'segment'],
    rootCauseHints: ['A service failure is usually one lane or one supplier.'],
    playbook: [{ category: 'operations', owner: 'Supply Chain Lead', approval: true }],
    glossary: {},
  },
};

export function pluginFor(domain: string): DomainPlugin {
  return PLUGINS[domain] ?? PLUGINS.generic;
}
