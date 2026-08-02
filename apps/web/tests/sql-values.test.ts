import { describe, expect, it } from 'vitest';
import { coerceSqlValue, fieldKind, formatInstant, num } from '@/lib/engine/sql';

/**
 * These lock down the two rendering defects an uploaded CSV exposed in the SQL
 * console: dates printed as epoch milliseconds, and HUGEINT aggregates printed
 * as a quote-wrapped string.
 */
describe('Arrow field classification', () => {
  it('recognises the Arrow date and timestamp type names', () => {
    expect(fieldKind('Date32<DAY>')).toBe('date');
    expect(fieldKind('Date64<MILLISECOND>')).toBe('date');
    expect(fieldKind('Timestamp<MICROSECOND>')).toBe('timestamp');
    expect(fieldKind('Int64')).toBe('other');
    expect(fieldKind(undefined)).toBe('other');
  });
});

describe('date rendering', () => {
  it('renders epoch milliseconds as a readable date, not 1,767,398,400,000', () => {
    expect(coerceSqlValue(1_767_398_400_000, 'date')).toBe('2026-01-03');
  });

  it('handles days, milliseconds, microseconds and nanoseconds', () => {
    expect(formatInstant(20_456, 'date')).toBe('2026-01-03'); // Date32: days
    expect(formatInstant(1_767_398_400_000, 'date')).toBe('2026-01-03');
    expect(formatInstant(1_767_398_400_000_000, 'timestamp')).toBe('2026-01-03 00:00:00');
    expect(formatInstant(1_767_398_400_000_000_000, 'timestamp')).toBe('2026-01-03 00:00:00');
  });

  it('accepts a JS Date and a bigint on a date column', () => {
    expect(coerceSqlValue(new Date('2026-07-27T00:00:00Z'), 'date')).toBe('2026-07-27');
    expect(coerceSqlValue(1_767_398_400_000n, 'date')).toBe('2026-01-03');
  });

  it('leaves plain numeric columns alone', () => {
    expect(coerceSqlValue(1_767_398_400_000, 'other')).toBe(1_767_398_400_000);
    expect(coerceSqlValue(42, 'other')).toBe(42);
  });
});

describe('numeric rendering', () => {
  it('unwraps the quote-wrapped string Arrow BigNum.toJSON produces', () => {
    expect(coerceSqlValue('"1070"', 'other')).toBe(1070);
    expect(coerceSqlValue('"-1070"', 'other')).toBe(-1070);
    expect(num('"1070"')).toBe(1070);
  });

  it('does not mangle genuine strings that merely contain digits', () => {
    expect(coerceSqlValue('ORD-1070', 'other')).toBe('ORD-1070');
    expect(coerceSqlValue('"North East"', 'other')).toBe('"North East"');
  });

  it('decodes a little-endian HUGEINT word array', () => {
    const hugeint = new Uint32Array([1070, 0, 0, 0]);
    expect(coerceSqlValue(hugeint, 'other')).toBe(1070);
    expect(num(hugeint)).toBe(1070);
  });

  it('decodes a negative HUGEINT', () => {
    const minusOne = new Uint32Array([0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff]);
    expect(num(minusOne)).toBe(-1);
  });

  it('survives an Arrow object that only exposes toJSON', () => {
    expect(coerceSqlValue({ toJSON: () => '"98765"' }, 'other')).toBe(98765);
  });

  it('maps null and undefined to null rather than NaN', () => {
    expect(coerceSqlValue(null, 'other')).toBeNull();
    expect(coerceSqlValue(undefined, 'date')).toBeNull();
  });
});
