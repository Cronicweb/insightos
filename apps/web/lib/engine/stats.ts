/**
 * Small statistics kernel.
 *
 * Only the tests the engine actually cites are implemented, and each one
 * returns the values needed to *show its working* (statistic, p-value, effect
 * size, n) because no insight in InsightOS is allowed to be a bare assertion.
 */

export function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/** Median absolute deviation, scaled to be a consistent estimator of sigma. */
export function mad(xs: number[]): number {
  if (!xs.length) return 0;
  const m = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  return sorted[base];
}

/** Abramowitz & Stegun 26.2.17 - accurate to ~7.5e-8, ample for reporting. */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

export function twoSidedP(z: number): number {
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))));
}

export interface TrendResult {
  direction: 'increasing' | 'decreasing' | 'flat';
  slope_per_period: number;
  slope_pct_per_period: number;
  p_value: number | null;
  tau: number;
  significant: boolean;
  n: number;
}

/**
 * Mann-Kendall trend test with a Theil-Sen slope.
 *
 * Chosen over ordinary least squares because business series are short, noisy
 * and frequently contain a step change; a rank-based test will not be dragged
 * around by one outlying month the way OLS is.
 */
export function mannKendall(values: number[]): TrendResult {
  const n = values.length;
  if (n < 4) {
    return { direction: 'flat', slope_per_period: 0, slope_pct_per_period: 0, p_value: null, tau: 0, significant: false, n };
  }
  let s = 0;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      s += Math.sign(values[j] - values[i]);
      slopes.push((values[j] - values[i]) / (j - i));
    }
  }
  // Variance with a tie correction.
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let tieTerm = 0;
  for (const c of Array.from(counts.values())) if (c > 1) tieTerm += c * (c - 1) * (2 * c + 5);
  const variance = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  const z = variance > 0 ? (s > 0 ? (s - 1) / Math.sqrt(variance) : s < 0 ? (s + 1) / Math.sqrt(variance) : 0) : 0;
  const p = twoSidedP(z);
  const slope = median(slopes);
  const level = Math.abs(mean(values));
  const significant = p < 0.05 && n >= 6;
  return {
    direction: !significant ? 'flat' : slope > 0 ? 'increasing' : 'decreasing',
    slope_per_period: Number(slope.toFixed(4)),
    slope_pct_per_period: level > 0 ? Number(((slope / level) * 100).toFixed(2)) : 0,
    p_value: Number(p.toFixed(4)),
    tau: Number(((2 * s) / (n * (n - 1))).toFixed(3)),
    significant,
    n,
  };
}

/** Two-proportion z-test - used whenever a rate is compared across segments. */
export function proportionTest(a: number, na: number, b: number, nb: number): { z: number; p: number } {
  if (na < 5 || nb < 5) return { z: 0, p: 1 };
  const pa = a / na;
  const pb = b / nb;
  const pooled = (a + b) / (na + nb);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / na + 1 / nb));
  if (!se) return { z: 0, p: 1 };
  const z = (pa - pb) / se;
  return { z: Number(z.toFixed(3)), p: Number(twoSidedP(z).toFixed(4)) };
}

/** Welch's t-test, returning a normal-approximation p-value. */
export function welch(m1: number, s1: number, n1: number, m2: number, s2: number, n2: number): { t: number; p: number; cohens_d: number } {
  if (n1 < 2 || n2 < 2) return { t: 0, p: 1, cohens_d: 0 };
  const se = Math.sqrt(s1 ** 2 / n1 + s2 ** 2 / n2);
  if (!se) return { t: 0, p: 1, cohens_d: 0 };
  const t = (m1 - m2) / se;
  const pooled = Math.sqrt(((n1 - 1) * s1 ** 2 + (n2 - 1) * s2 ** 2) / Math.max(1, n1 + n2 - 2));
  return {
    t: Number(t.toFixed(3)),
    p: Number(twoSidedP(t).toFixed(4)),
    cohens_d: pooled ? Number(((m1 - m2) / pooled).toFixed(3)) : 0,
  };
}

/** Herfindahl-Hirschman index on shares expressed as fractions of one. */
export function hhi(shares: number[]): number {
  return Number(shares.reduce((a, s) => a + s * s, 0).toFixed(4));
}
