import { describe, expect, it } from 'vitest';
import type { ColumnProfile } from '@/lib/types';
import { cancelExpr, detectLedger, revenueExpr, revenueFormula } from '@/lib/engine/ledger';

/**
 * The reference table is the UCI Online Retail extract, whose ground truth was
 * computed independently in pandas before any of this code existed:
 *
 *   all rows                     541,909   revenue  9,747,747.93
 *   completed (non-cancelled)    532,621   revenue 10,644,560.42
 *   analysis scope (qty>0,px>0)  530,104   revenue 10,666,684.54
 *
 * The completed figure exceeds the all-rows figure because cancellations carry
 * negative quantities. That inversion is the reason scope has to be explicit.
 */
function col(name: string, semantic_type: string, extra: Partial<ColumnProfile> = {}): ColumnProfile {
  return {
    name, dtype: 'VARCHAR', semantic_type,
    count: 541909, missing: 0, missing_pct: 0, unique: 100, unique_pct: 1,
    is_unique: false, is_constant: false, sample_values: [],
    min: null, max: null, mean: null, median: null, std: null,
    top_values: [], entropy: null, ...extra,
  };
}

const onlineRetail = (): ColumnProfile[] => [
  col('InvoiceNo', 'identifier'),
  col('StockCode', 'identifier'),
  col('Description', 'text'),
  col('Quantity', 'numeric'),
  col('InvoiceDate', 'datetime'),
  col('UnitPrice', 'currency'),
  col('CustomerID', 'identifier'),
  col('Country', 'categorical'),
];

describe('ledger detection', () => {
  it('maps every role on the Online Retail schema', () => {
    const cols = detectLedger(onlineRetail());
    expect(cols).not.toBeNull();
    expect(cols!.invoice).toBe('InvoiceNo');
    expect(cols!.quantity).toBe('Quantity');
    expect(cols!.price).toBe('UnitPrice');
    expect(cols!.customer).toBe('CustomerID');
    expect(cols!.country).toBe('Country');
    expect(cols!.product).toBe('StockCode');
    expect(cols!.description).toBe('Description');
    expect(cols!.date).toBe('InvoiceDate');
    expect(cols!.revenue).toBeNull();
  });

  it('refuses a table with no invoice key', () => {
    const cols = onlineRetail().filter((c) => c.name !== 'InvoiceNo');
    expect(detectLedger(cols)).toBeNull();
  });

  it('refuses a table where money cannot be derived at line level', () => {
    const cols = onlineRetail().filter((c) => c.name !== 'UnitPrice' && c.name !== 'Quantity');
    expect(detectLedger(cols)).toBeNull();
  });

  it('accepts a pre-computed line total without quantity or price', () => {
    const cols = detectLedger([
      col('order_id', 'identifier'),
      col('line_total', 'currency'),
    ]);
    expect(cols).not.toBeNull();
    expect(cols!.revenue).toBe('line_total');
  });

  it('does not mistake a segment label for a customer key', () => {
    const cols = detectLedger([
      col('InvoiceNo', 'identifier'),
      col('Quantity', 'numeric'),
      col('UnitPrice', 'currency'),
      col('customer_segment', 'categorical'),
    ]);
    expect(cols!.customer).toBeNull();
  });
});

describe('money expression', () => {
  it('multiplies quantity by unit price rather than summing price', () => {
    const cols = detectLedger(onlineRetail())!;
    const expr = revenueExpr(cols)!;
    expect(expr).toContain('"Quantity"');
    expect(expr).toContain('"UnitPrice"');
    expect(expr).toContain('*');
    expect(revenueFormula(cols)).toBe('SUM(Quantity x UnitPrice)');
  });

  it('uses the line total directly when one is present', () => {
    const cols = detectLedger([col('order_id', 'identifier'), col('line_total', 'currency')])!;
    expect(revenueExpr(cols)).toBe('CAST("line_total" AS DOUBLE)');
    expect(revenueFormula(cols)).toBe('SUM(line_total)');
  });

  it('casts to DOUBLE so integer quantities do not truncate the product', () => {
    const cols = detectLedger(onlineRetail())!;
    expect(revenueExpr(cols)!.match(/AS DOUBLE/g)).toHaveLength(2);
  });
});

describe('cancellation predicate', () => {
  it('matches the leading-C convention case-insensitively', () => {
    const cols = detectLedger(onlineRetail())!;
    const expr = cancelExpr(cols);
    expect(expr).toBe(`upper(CAST("InvoiceNo" AS VARCHAR)) LIKE 'C%'`);
  });

  it('casts the invoice number so a numeric-typed column still matches', () => {
    const cols = detectLedger(onlineRetail())!;
    expect(cancelExpr(cols)).toContain('AS VARCHAR');
  });
});
