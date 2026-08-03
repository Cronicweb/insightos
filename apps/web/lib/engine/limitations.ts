/**
 * What this dataset cannot tell you.
 *
 * The most expensive analytical failure is not a wrong number, it is a
 * confident causal claim built on data that never contained the cause. A file
 * of retail transactions can show that revenue fell; it cannot show that a
 * campaign caused it, because it contains no campaign. The distinction is
 * invisible in a dashboard and obvious in a footnote, so this module writes the
 * footnote - from the schema, not from a template.
 *
 * Each entry names a claim, states why the file cannot support it, and lists
 * exactly which fields would be needed to make it answerable.
 */
import type {
  Analysis, ColumnProfile, LedgerAudit, LimitationItem, LimitationsReport,
} from '@/lib/types';

interface Probe {
  id: string;
  claim: string;
  /** Regexes that, if a column matches, mean the file *can* support the claim. */
  satisfied_by: RegExp[];
  why: string;
  required_data: string[];
}

const PROBES: Probe[] = [
  {
    id: 'campaign_uplift',
    claim: 'Marketing campaigns drove the change in revenue',
    satisfied_by: [/campaign/i, /(^|_)(utm|channel|adgroup|creative)/i, /exposure/i, /impression/i],
    why:
      'The file records what was bought, not who was reached. With no exposure flag there is no treated group and no control group, so any difference between customers is selection, not uplift.',
    required_data: [
      'Campaign exposure at customer level (who was targeted, when, on which channel)',
      'A holdout or control group defined before the campaign ran',
      'Send, open and click events with timestamps',
    ],
  },
  {
    id: 'roi',
    claim: 'Return on marketing spend, CPA or ROAS',
    satisfied_by: [/spend/i, /cost/i, /budget/i, /cpa/i, /cpc/i, /roas/i],
    why:
      'Every return figure is a ratio over cost, and this file has no cost column. Quoting revenue alone as a return silently assumes the denominator is zero.',
    required_data: ['Media and promotional spend by channel and period', 'Attribution windows and a stated attribution model'],
  },
  {
    id: 'margin',
    claim: 'Profitability, margin or contribution',
    satisfied_by: [/margin/i, /(^|_)cogs/i, /cost[_ ]?of[_ ]?goods/i, /(unit|item)[_ ]?cost/i, /profit/i],
    why:
      'Revenue is not profit. Without cost of goods, fulfilment and returns-handling cost, a high-revenue product cannot be distinguished from a loss-making one.',
    required_data: ['Cost of goods sold per SKU', 'Fulfilment, shipping and returns-processing cost', 'Discount and promotion cost at line level'],
  },
  {
    id: 'cardmember',
    claim: 'Cardmember behaviour, spend share or wallet share',
    satisfied_by: [/cardmember/i, /card[_ ]?(id|number|type|product)/i, /tenure/i, /credit[_ ]?limit/i],
    why:
      'The customer identifier here is a merchant-side account, not a card product. It cannot be joined to tenure, credit line, rewards tier or spend outside this merchant, so wallet share is undefined.',
    required_data: [
      'Cardmember identifier with product, tenure and rewards tier',
      'Spend across merchants to establish a wallet denominator',
      'Statement-level balances and payment behaviour',
    ],
  },
  {
    id: 'credit_risk',
    claim: 'Credit risk, delinquency or fraud rate',
    satisfied_by: [/fraud/i, /chargeback/i, /delinqu/i, /default/i, /risk[_ ]?score/i, /dispute/i],
    why:
      'There is no outcome label. A cancelled invoice is a commercial reversal, not a fraud flag, and modelling one as the other would train against the wrong target.',
    required_data: ['Confirmed fraud and chargeback labels with dispute dates', 'Authorisation and decline records', 'Bureau or internal risk scores'],
  },
  {
    id: 'acquisition',
    claim: 'Customer acquisition cost and channel effectiveness',
    satisfied_by: [/acquisition/i, /signup/i, /source/i, /referr/i, /channel/i],
    why:
      'First observed purchase is not acquisition date - a customer may have been acquired before the window opens. With no acquisition source, channel comparison is not possible.',
    required_data: ['Acquisition date and source per customer', 'Acquisition spend by channel', 'A window long enough to observe the true first purchase'],
  },
];

export function buildLimitations(
  analysis: Pick<Analysis, 'dataset' | 'rows' | 'domain'>,
  columns: ColumnProfile[],
  ledger: LedgerAudit | null,
): LimitationsReport {
  const names = columns.map((c) => c.name);
  const has = (patterns: RegExp[]) => patterns.some((re) => names.some((n) => re.test(n)));

  const cannot: LimitationItem[] = PROBES.filter((p) => !has(p.satisfied_by)).map((p) => ({
    id: p.id, claim: p.claim, why: p.why, required_data: p.required_data,
  }));

  const notPresent: string[] = [];
  if (!has([/campaign/i, /channel/i])) notPresent.push('campaign or channel exposure');
  if (!has([/cost/i, /spend/i])) notPresent.push('marketing or operating cost');
  if (!has([/margin/i, /cogs/i, /profit/i])) notPresent.push('margin or cost of goods');
  if (!has([/cardmember/i, /card[_ ]?id/i, /tenure/i])) notPresent.push('cardmember or credit attributes');
  if (!has([/fraud/i, /chargeback/i, /risk/i])) notPresent.push('risk or fraud outcomes');
  if (!has([/(^|_)(age|gender|income|segment_)/i])) notPresent.push('customer demographics');

  const caveats: string[] = [
    'Every figure describes what was recorded, not what was caused. Correlation between a segment and a movement is arithmetic; attributing the movement to that segment is an inference the data does not license.',
  ];

  if (ledger) {
    if (ledger.scope.last_period_partial && ledger.scope.partial_note) {
      caveats.push(ledger.scope.partial_note);
    }
    if (ledger.repeat && ledger.repeat.anonymous_pct > 5) {
      caveats.push(
        `${ledger.repeat.anonymous_pct.toFixed(1)}% of in-scope rows have no customer identifier. ` +
        'Customer counts, repeat rate and RFM describe the identified subset only, and the unidentified rows may not behave like it.',
      );
    }
    const uk = ledger.pareto.find((p) => p.kind === 'country');
    if (uk && uk.top1_share_pct > 60) {
      caveats.push(
        `${uk.entries[0]?.name} accounts for ${uk.top1_share_pct.toFixed(1)}% of in-scope revenue. ` +
        'On a base that concentrated, a "top contributor" finding is close to arithmetically guaranteed and carries little information. Per-country growth rates are the more honest comparison.',
      );
    }
    const dup = ledger.quality_rules.find((r) => r.id === 'duplicates');
    if (dup) {
      caveats.push(
        `${dup.rows.toLocaleString('en-GB')} exact duplicate rows were found and deliberately not removed: on a line-item ledger a repeated line can be a genuine re-scan. ` +
        'If they are artefacts, revenue is overstated by their value.',
      );
    }
  }

  caveats.push(
    'Time coverage is a single continuous extract. Seasonality observed once is described, not established - a second cycle would be needed to separate season from trend.',
  );

  return {
    what_this_is:
      ledger
        ? `A ${analysis.rows.toLocaleString('en-GB')}-row transaction ledger: one row per line item, carrying invoice, product, quantity, unit price${ledger.columns.customer ? ', customer' : ''}${ledger.columns.country ? ' and country' : ''}. It supports descriptive commercial analysis - what sold, to whom, where and when.`
        : `A ${analysis.rows.toLocaleString('en-GB')}-row dataset profiled as ${analysis.domain?.domain ?? 'general'} data. It supports descriptive analysis of the fields it contains.`,
    what_this_is_not: notPresent.length
      ? notPresent.map((n) => `No ${n} is present in this file.`)
      : ['No material gaps were detected against the standard commercial attribute set.'],
    cannot_conclude: cannot,
    caveats,
  };
}
