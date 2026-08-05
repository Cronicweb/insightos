// InsightOS — Compare engine (§21). One diff engine, five comparators, auto-highlighted rows.

import type { InvestigationNode } from './investigation/graph';
import type { SemanticConcept } from './semantic/model';

export type CompareKind = 'node' | 'semantic' | 'period' | 'sql' | 'recommendations';

export interface CompareRow {
  field: string;
  a?: string;
  b?: string;
  status: 'same' | 'changed' | 'added' | 'removed';
}

export interface CompareResult {
  kind: CompareKind;
  rows: CompareRow[];
}

function diffRecords(
  a: Record<string, string>,
  b: Record<string, string>,
): CompareRow[] {
  const fields = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();
  return fields.map((field) => {
    const av = a[field];
    const bv = b[field];
    let status: CompareRow['status'];
    if (av === undefined) status = 'added';
    else if (bv === undefined) status = 'removed';
    else status = av === bv ? 'same' : 'changed';
    return { field, a: av, b: bv, status };
  });
}

export function compareNodesDetailed(a: InvestigationNode, b: InvestigationNode): CompareResult {
  const rec = (n: InvestigationNode): Record<string, string> => ({
    question: n.question,
    summary: n.response?.summary ?? '',
    confidence: n.response?.confidence.level ?? '',
    sql: n.response?.sql?.sql ?? '',
    tests: (n.response?.statisticalTests ?? []).join(', '),
  });
  return { kind: 'node', rows: diffRecords(rec(a), rec(b)) };
}

export function compareSemantic(a: SemanticConcept, b: SemanticConcept): CompareResult {
  const rec = (c: SemanticConcept): Record<string, string> => ({
    concept: c.concept,
    column: c.column,
    role: c.role,
    confidence: `${(c.confidence * 100).toFixed(0)}%`,
  });
  return { kind: 'semantic', rows: diffRecords(rec(a), rec(b)) };
}

export function comparePeriods(
  a: Record<string, number>,
  b: Record<string, number>,
): CompareResult {
  const toStr = (r: Record<string, number>) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)]));
  return { kind: 'period', rows: diffRecords(toStr(a), toStr(b)) };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function compareSql(a: string, b: string): CompareResult {
  const na = normalizeSql(a);
  const nb = normalizeSql(b);
  return {
    kind: 'sql',
    rows: [
      { field: 'query', a, b, status: na === nb ? 'same' : 'changed' },
      { field: 'normalized-equal', a: String(na === nb), b: '', status: na === nb ? 'same' : 'changed' },
    ],
  };
}

export function compareRecommendations(a: string[], b: string[]): CompareResult {
  const sa = new Set(a);
  const sb = new Set(b);
  const all = Array.from(new Set([...a, ...b]));
  const rows: CompareRow[] = all.map((item) => {
    const inA = sa.has(item);
    const inB = sb.has(item);
    return {
      field: item,
      a: inA ? '✓' : '',
      b: inB ? '✓' : '',
      status: inA && inB ? 'same' : inA ? 'removed' : 'added',
    };
  });
  return { kind: 'recommendations', rows };
}
