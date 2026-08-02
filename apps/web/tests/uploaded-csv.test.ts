import { describe, expect, it } from 'vitest';
import type { ColumnProfile } from '@/lib/types';
import { resolveRoles } from '@/lib/engine/roles';
import { detectSensitiveFields, summarisePrivacyScan } from '@/lib/engine/privacy';
import { modeNotice, resolveMode } from '@/lib/mode-copy';

/**
 * A faithful profile of the real CSV that exposed the aliasing bugs:
 * `units` (not quantity), `order_id` (not order), `customer_segment` with no
 * customer key, and a `order_date` that a naive value rule read as a phone
 * number. Every assertion here is a defect that shipped once.
 */
function col(name: string, semantic_type: string, extra: Partial<ColumnProfile> = {}): ColumnProfile {
  return {
    name,
    dtype: 'VARCHAR',
    semantic_type,
    count: 42,
    missing: 0,
    missing_pct: 0,
    unique: 6,
    unique_pct: 14,
    is_unique: false,
    is_constant: false,
    sample_values: [],
    min: null,
    max: null,
    mean: null,
    median: null,
    std: null,
    top_values: [],
    entropy: null,
    ...extra,
  };
}

const SAMPLE_ORDERS: ColumnProfile[] = [
  col('order_id', 'identifier', { unique: 6, sample_values: ['ORD-1001', 'ORD-1002'] }),
  col('order_date', 'datetime', {
    dtype: 'DATE',
    unique: 42,
    sample_values: ['2026-01-03', '2026-02-14', '2026-07-27'],
    min_date: '2026-01-03',
    max_date: '2026-07-27',
  }),
  col('region', 'categorical', { unique: 4, sample_values: ['East', 'West'] }),
  col('customer_segment', 'categorical', { unique: 3, sample_values: ['Enterprise', 'SMB'] }),
  col('units', 'count', { dtype: 'BIGINT', unique: 12, mean: 3.8 }),
  col('revenue', 'currency', { dtype: 'DOUBLE', unique: 40, mean: 321.5 }),
];

describe('CSV column aliasing', () => {
  const roles = resolveRoles(SAMPLE_ORDERS);

  it('maps units to the quantity role', () => {
    expect(roles.quantity).toBe('units');
  });

  it('maps order_id to the orders role', () => {
    expect(roles.orders).toBe('order_id');
  });

  it('does not mistake customer_segment for a customer key', () => {
    expect(roles.customer).toBeUndefined();
    expect(roles.segment).toBe('customer_segment');
  });

  it('still resolves date, region and revenue', () => {
    expect(roles.date).toBe('order_date');
    expect(roles.region).toBe('region');
    expect(roles.revenue).toBe('revenue');
  });

  it('accepts the common spellings of the same business concepts', () => {
    const alt = resolveRoles([
      col('transaction_id', 'identifier'),
      col('qty', 'count'),
      col('customer_id', 'identifier', { unique: 30 }),
      col('booking_date', 'datetime'),
    ]);
    expect(alt.orders).toBe('transaction_id');
    expect(alt.quantity).toBe('qty');
    expect(alt.customer).toBe('customer_id');
    expect(alt.date).toBe('booking_date');
  });
});

describe('privacy scan', () => {
  it('never classifies a date column as a phone number', () => {
    const report = detectSensitiveFields(SAMPLE_ORDERS);
    expect(report.masked_columns).not.toContain('order_date');
    expect(report.fields.find((f) => f.column === 'order_date')).toBeUndefined();
  });

  it('reports a neutral heading and an honest status when nothing is found', () => {
    const scan = summarisePrivacyScan({ fields: [], masked_columns: [] });
    expect(scan.heading).toBe('Privacy scan');
    expect(scan.status).toBe('No sensitive fields detected');
    expect(scan.badge).toBe('Nothing to mask');
    expect(scan.detected).toBe(false);
  });

  it('states the finding and the masking policy when fields are found', () => {
    const report = detectSensitiveFields([
      ...SAMPLE_ORDERS,
      col('email', 'text', { unique: 40, sample_values: ['a@b.com', 'c@d.org'] }),
    ]);
    const scan = summarisePrivacyScan(report);
    expect(scan.detected).toBe(true);
    expect(scan.heading).toBe('Privacy scan');
    expect(scan.status).toMatch(/^Sensitive fields detected \(\d+\)$/);
    expect(scan.badge).toBe('Masked automatically');
  });
});

describe('mode messaging', () => {
  it('calls an uploaded dataset local, never demo', () => {
    expect(resolveMode({ uploaded: true, demo: true })).toBe('local');
    expect(modeNotice('local')).toBe(
      'Local mode: your file was parsed, queried and analysed in this browser tab.',
    );
  });

  it('keeps the demo and live wording distinct', () => {
    expect(resolveMode({ uploaded: false, demo: true })).toBe('demo');
    expect(resolveMode({ uploaded: false, demo: false })).toBe('live');
    expect(modeNotice('demo')).toContain('pre-computed');
    expect(modeNotice('live')).toContain('InsightOS API');
  });
});
