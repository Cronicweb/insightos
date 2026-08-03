import { describe, expect, it } from 'vitest';
import {
  TIMESTAMP_FORMATS,
  looksLikeDateColumn,
  pickBestFormat,
  planRevenueDerivation,
} from '@/lib/engine/coerce';

/**
 * These cover the decisions that caused the UCI Online Retail upload to come
 * back with an empty forecast and a headline revenue of $2.50M against a true
 * GBP 9.75M. They are pure functions on purpose: the failure was one of
 * judgement, not of database plumbing, and judgement is what a test can pin.
 */
describe('timestamp format selection', () => {
  const zeroes = () => Object.fromEntries(TIMESTAMP_FORMATS.map((f) => [f, 0]));

  it('adopts the format that parses the whole column', () => {
    const counts = { ...zeroes(), '%m/%d/%Y %H:%M:%S': 2000 };
    expect(pickBestFormat(counts, 2000)?.format).toBe('%m/%d/%Y %H:%M:%S');
  });

  it('rejects a format that only explains part of the column', () => {
    // The real Online Retail split: DD/MM parses only the rows whose day
    // happens to be 12 or lower. A plausible-looking majority is still wrong.
    const counts = { ...zeroes(), '%d/%m/%Y %H:%M:%S': 214172 };
    expect(pickBestFormat(counts, 541909)).toBeNull();
  });

  it('prefers the format with the higher parse rate when both clear the bar', () => {
    const counts = { ...zeroes(), '%m/%d/%Y': 990, '%d/%m/%Y': 1000 };
    expect(pickBestFormat(counts, 1000)?.format).toBe('%d/%m/%Y');
  });

  it('breaks a genuine tie toward the US ordering Excel emits', () => {
    const counts = { ...zeroes(), '%m/%d/%Y': 1000, '%d/%m/%Y': 1000 };
    expect(pickBestFormat(counts, 1000)?.format).toBe('%m/%d/%Y');
  });

  it('tolerates a handful of malformed rows', () => {
    const counts = { ...zeroes(), '%Y-%m-%d': 991 };
    expect(pickBestFormat(counts, 1000)?.format).toBe('%Y-%m-%d');
  });

  it('returns nothing for an empty column', () => {
    expect(pickBestFormat(zeroes(), 0)).toBeNull();
  });

  it('lists ISO formats before regional ones', () => {
    expect(TIMESTAMP_FORMATS.indexOf('%Y-%m-%d %H:%M:%S')).toBeLessThan(
      TIMESTAMP_FORMATS.indexOf('%m/%d/%Y %H:%M:%S'),
    );
  });
});

describe('date column identification', () => {
  it('trusts a column name that promises a date', () => {
    expect(looksLikeDateColumn('InvoiceDate', [])).toBe(true);
    expect(looksLikeDateColumn('created_at', [])).toBe(true);
  });

  it('recognises date values under an uninformative name', () => {
    expect(looksLikeDateColumn('col_4', ['12/01/2010 08:26:00', '12/01/2010 08:28:00'])).toBe(true);
  });

  it('does not mistake product codes for dates', () => {
    // StockCode values like 85123A are exactly the kind of thing a loose
    // regex would happily convert into NULL timestamps.
    expect(looksLikeDateColumn('StockCode', ['85123A', '71053', '84406B'])).toBe(false);
  });

  it('does not mistake free text for dates', () => {
    expect(looksLikeDateColumn('Description', ['WHITE HANGING HEART T-LIGHT HOLDER'])).toBe(false);
  });
});

describe('revenue derivation', () => {
  const retail = [
    { name: 'InvoiceNo', type: 'VARCHAR' },
    { name: 'Quantity', type: 'BIGINT' },
    { name: 'UnitPrice', type: 'DOUBLE' },
    { name: 'CustomerID', type: 'DOUBLE' },
  ];

  it('multiplies quantity by unit price when no revenue column exists', () => {
    expect(planRevenueDerivation(retail)).toEqual({ quantity: 'Quantity', price: 'UnitPrice' });
  });

  it('leaves a dataset that already reports revenue alone', () => {
    expect(planRevenueDerivation([...retail, { name: 'Sales_Amount', type: 'DOUBLE' }])).toBeNull();
  });

  it('is idempotent, so a second ingest does not stack columns', () => {
    expect(planRevenueDerivation([...retail, { name: 'Revenue', type: 'DOUBLE' }])).toBeNull();
  });

  it('declines when quantity is not numeric', () => {
    const textQty = retail.map((c) => (c.name === 'Quantity' ? { ...c, type: 'VARCHAR' } : c));
    expect(planRevenueDerivation(textQty)).toBeNull();
  });

  it('declines when there is no price column to multiply', () => {
    expect(planRevenueDerivation(retail.filter((c) => c.name !== 'UnitPrice'))).toBeNull();
  });
});
