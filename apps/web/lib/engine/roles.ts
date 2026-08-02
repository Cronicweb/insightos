/**
 * Semantic role resolution.
 *
 * A role is what a column *means to the business* ("revenue", "region"), as
 * opposed to what it is technically (DOUBLE, VARCHAR). Everything downstream -
 * KPI formulas, root-cause dimensions, recommendation rules - is written
 * against roles, which is what lets one engine analyse a bank and a hospital.
 *
 * Ported from `insightos.kpi.roles`, including the fixes made there: flags may
 * be numeric 0/1, and the currency fallback must not steal a column that a more
 * specific role already owns.
 */
import type { ColumnProfile } from '@/lib/types';

export interface ResolvedRole {
  role: string;
  column: string;
  confidence: number;
  reason: string;
}

type Kind = ColumnProfile['semantic_type'];

interface RolePattern {
  role: string;
  re: RegExp;
  kinds: Kind[];
  /** Roles that must be at most binary (flags). */
  binary?: boolean;
}

const PATTERNS: RolePattern[] = [
  { role: 'date', re: /(date|day|month|week|period|timestamp|_at$|_on$)/i, kinds: ['datetime'] },
  { role: 'revenue', re: /(revenue|sales_amount|net_sales|gross_sales|turnover|billings|gmv|total_amount|amount$|transaction_amount|premium)/i, kinds: ['currency'] },
  { role: 'cost', re: /(cost|cogs|expense|spend|opex|salary|wage|payroll)/i, kinds: ['currency'] },
  { role: 'profit', re: /(profit|margin_amount|net_income|contribution)/i, kinds: ['currency'] },
  { role: 'discount', re: /(discount|rebate|promo_amount|markdown)/i, kinds: ['currency', 'percentage'] },
  { role: 'quantity', re: /(quantity|qty|units|volume|items|seats|doses)/i, kinds: ['count', 'numeric'] },
  { role: 'orders', re: /(order|transaction|invoice|booking|ticket|admission|visit|claim)/i, kinds: ['identifier', 'categorical', 'count'] },
  { role: 'customer', re: /(customer|client|account|member|patient|employee|user)/i, kinds: ['identifier', 'categorical'] },
  { role: 'region', re: /(region|country|state|territory|market|geo|zone|site|branch|store|location)/i, kinds: ['categorical'] },
  { role: 'segment', re: /(segment|tier|category|type|class|group|department|division|line|specialty|speciality|ward|business_unit|team|plan|product|channel|cohort)/i, kinds: ['categorical'] },
  { role: 'channel', re: /(channel|medium|source|campaign|platform)/i, kinds: ['categorical'] },
  { role: 'impressions', re: /(impression|reach|delivered)/i, kinds: ['count', 'numeric'] },
  { role: 'clicks', re: /(click|engagement)/i, kinds: ['count', 'numeric'] },
  { role: 'conversions', re: /(conversion|signup|sign_up|lead|acquisition)/i, kinds: ['count', 'numeric'] },
  { role: 'downtime', re: /(downtime|outage|stoppage|idle_minutes)/i, kinds: ['numeric', 'count'] },
  { role: 'defects', re: /(defect|scrap|reject|fault|failure)/i, kinds: ['count', 'numeric'] },
  { role: 'churn_flag', re: /(churn|attrition|cancelled|canceled|left|exit)/i, kinds: ['boolean', 'categorical', 'count', 'numeric'], binary: true },
  { role: 'fraud_flag', re: /(fraud|suspicious|chargeback)/i, kinds: ['boolean', 'categorical', 'count', 'numeric'], binary: true },
  { role: 'return_flag', re: /(return|refund|reversal)/i, kinds: ['boolean', 'categorical', 'count', 'numeric'], binary: true },
  { role: 'readmission_flag', re: /(readmission|readmit|relapse|reopen)/i, kinds: ['boolean', 'categorical', 'count', 'numeric'], binary: true },
  { role: 'repeat_flag', re: /(repeat|returning|loyal|renewed)/i, kinds: ['boolean', 'categorical', 'count', 'numeric'], binary: true },
  { role: 'conversion_flag', re: /(converted|is_conversion|purchased)/i, kinds: ['boolean', 'categorical', 'count', 'numeric'], binary: true },
];

export function resolveRoles(columns: ColumnProfile[]): Record<string, string> {
  const detailed = resolveRolesDetailed(columns);
  const out: Record<string, string> = {};
  for (const r of detailed) out[r.role] = r.column;
  return out;
}

export function resolveRolesDetailed(columns: ColumnProfile[]): ResolvedRole[] {
  const claimed = new Set<string>();
  const resolved: ResolvedRole[] = [];

  for (const pattern of PATTERNS) {
    let best: { col: ColumnProfile; score: number } | null = null;
    for (const col of columns) {
      if (claimed.has(col.name)) continue;
      if (!pattern.kinds.includes(col.semantic_type)) continue;
      if (!pattern.re.test(col.name)) continue;
      if (col.is_constant) continue;
      // A flag with more than two distinct values is not a flag.
      if (pattern.binary && col.unique > 2) continue;

      let score = 0.6;
      // Prefer an exact-ish name match over an incidental substring.
      const match = col.name.match(pattern.re);
      if (match && match[0].length / col.name.length > 0.6) score += 0.2;
      if (pattern.role === 'date' && col.semantic_type === 'datetime') score += 0.15;
      // A dimension with a workable number of levels is more useful.
      if (['region', 'segment', 'channel'].includes(pattern.role)) {
        if (col.unique >= 2 && col.unique <= 40) score += 0.15;
        else score -= 0.2;
      }
      score -= col.missing_pct / 400;
      if (!best || score > best.score) best = { col, score };
    }
    if (!best) continue;
    claimed.add(best.col.name);
    resolved.push({
      role: pattern.role,
      column: best.col.name,
      confidence: Math.max(0.35, Math.min(0.99, Number(best.score.toFixed(2)))),
      reason: `${best.col.name} (${best.col.semantic_type}) matches the ${pattern.role} pattern.`,
    });
  }

  // Fallback: if nothing claimed a revenue role, adopt the largest unclaimed
  // currency column - but never one another role already owns.
  if (!resolved.some((r) => r.role === 'revenue')) {
    const candidates = columns
      .filter((c) => c.semantic_type === 'currency' && !claimed.has(c.name) && !c.is_constant)
      .sort((a, b) => (b.mean ?? 0) - (a.mean ?? 0));
    if (candidates.length) {
      claimed.add(candidates[0].name);
      resolved.push({
        role: 'revenue',
        column: candidates[0].name,
        confidence: 0.45,
        reason: `${candidates[0].name} is the largest unclaimed monetary column.`,
      });
    }
  }

  // Fallback date: any datetime column at all.
  if (!resolved.some((r) => r.role === 'date')) {
    const dateCol = columns.find((c) => c.semantic_type === 'datetime');
    if (dateCol) {
      resolved.push({ role: 'date', column: dateCol.name, confidence: 0.5, reason: `${dateCol.name} is the only temporal column.` });
    }
  }

  return resolved;
}

/** Every categorical column that is usable as a breakdown dimension. */
export function dimensionColumns(
  columns: ColumnProfile[],
  roles: Record<string, string>,
  excluded: string[] = [],
): string[] {
  const block = new Set(excluded);
  const byName = new Map(columns.map((c) => [c.name, c]));

  // A breakdown is only meaningful when the column has a small, repeated set of
  // levels. Identifiers have one level per row, so they explain nothing and -
  // being personal data - must never be surfaced as a segment either.
  const usable = (name: string): boolean => {
    const c = byName.get(name);
    if (!c || block.has(name)) return false;
    if (c.semantic_type === 'identifier' || c.is_constant) return false;
    if (!['categorical', 'boolean'].includes(c.semantic_type)) return false;
    const levels = c.unique;
    return levels >= 2 && levels <= 40 && levels <= Math.max(2, c.count * 0.5);
  };

  const preferred = ['region', 'segment', 'channel', 'customer'];
  const byRole = (preferred.map((r) => roles[r]).filter(Boolean) as string[]).filter(usable);
  const others = columns
    .filter((c) => usable(c.name) && !byRole.includes(c.name))
    .sort((a, b) => a.unique - b.unique)
    .map((c) => c.name);
  return [...byRole, ...others].slice(0, 6);
}
