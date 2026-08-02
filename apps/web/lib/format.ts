import type { Unit } from './types';

/**
 * Presentation-only helpers.
 *
 * Rule of the codebase: formatting may change how a number *looks*, never what
 * it *is*. No rounding decision here is allowed to feed back into analytics.
 */

const COMPACT = [
  { limit: 1e12, suffix: 'T' },
  { limit: 1e9, suffix: 'B' },
  { limit: 1e6, suffix: 'M' },
  { limit: 1e3, suffix: 'K' },
];

export function compactNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '\u2014';
  const abs = Math.abs(value);
  for (const { limit, suffix } of COMPACT) {
    if (abs >= limit) {
      return (value / limit).toFixed(digits).replace(/\.0+$/, '') + suffix;
    }
  }
  return abs >= 100 ? value.toFixed(0) : value.toFixed(Math.min(digits, 2));
}

/** Null-safe wrapper around Number.prototype.toFixed. The engine legitimately
 *  emits null for statistics it cannot compute (a z-score with zero dispersion,
 *  a MAPE with no backtest window). Presentation must degrade to an em-dash,
 *  never throw. */
export function fixed(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '\u2014';
  return value.toFixed(digits);
}

/** Null-safe wrapper around Number.prototype.toExponential. */
export function exponential(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '\u2014';
  return value.toExponential(digits);
}

export function formatValue(value: number | null | undefined, unit?: Unit): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '\u2014';
  switch (unit) {
    case 'currency':
      return `$${compactNumber(value)}`;
    case 'percent':
      return `${value.toFixed(2)}%`;
    case 'ratio':
      return `${value.toFixed(2)}x`;
    case 'days':
      return `${value.toFixed(1)}d`;
    default:
      return compactNumber(value);
  }
}

export function formatExact(value: number | null | undefined, unit?: Unit): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '\u2014';
  const n = value.toLocaleString('en-US', {
    minimumFractionDigits: Math.abs(value) < 10 ? 2 : 0,
    maximumFractionDigits: 2,
  });
  if (unit === 'currency') return `$${n}`;
  if (unit === 'percent') return `${n}%`;
  if (unit === 'ratio') return `${n}x`;
  return n;
}

export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '\u2014';
  return `${value.toFixed(digits)}%`;
}

export function formatSignedPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '\u2014';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '\u2014';
  return Math.round(value).toLocaleString('en-US');
}

/** p-values below 1e-4 are shown in scientific notation; 0 is impossible so we floor. */
export function formatPValue(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return '\u2014';
  if (p < 1e-16) return 'p < 1e-16';
  if (p < 1e-4) return `p = ${p.toExponential(1)}`;
  return `p = ${p.toFixed(4)}`;
}

export function titleCase(text: string | null | undefined): string {
  if (!text) return '\u2014';
  return text
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
