/**
 * Forecasting with honest model selection.
 *
 * Three candidate models are back-tested against a rolling origin and scored by
 * MASE. The winner is only promoted above the naive benchmark if it actually
 * beats it - and when it does not, the chart says so rather than quietly
 * presenting a flattering line.
 */
import type { Forecast, ForecastPoint, Kpi } from '@/lib/types';
import { periodLabel, type Grain } from './kpi';
import { mean, stdev } from './stats';

type Model = 'naive' | 'ses' | 'holt';

interface Scored {
  model: Model;
  mase: number;
  mape: number;
  rmse: number;
  folds: number;
  selected: boolean;
}

function predict(model: Model, history: number[], horizon: number): number[] {
  const n = history.length;
  if (model === 'naive' || n < 3) return new Array(horizon).fill(history[n - 1]);

  if (model === 'ses') {
    const alpha = 0.35;
    let level = history[0];
    for (let i = 1; i < n; i += 1) level = alpha * history[i] + (1 - alpha) * level;
    return new Array(horizon).fill(level);
  }

  // Holt linear trend, damped so a short noisy series cannot extrapolate wildly.
  const alpha = 0.4;
  const beta = 0.15;
  const phi = 0.9;
  let level = history[0];
  let trend = history[1] - history[0];
  for (let i = 1; i < n; i += 1) {
    const prev = level;
    level = alpha * history[i] + (1 - alpha) * (level + phi * trend);
    trend = beta * (level - prev) + (1 - beta) * phi * trend;
  }
  const out: number[] = [];
  let damp = 0;
  for (let h = 1; h <= horizon; h += 1) {
    damp += phi ** h;
    out.push(level + damp * trend);
  }
  return out;
}

/** Rolling-origin back-test: fit on a prefix, predict one step, move forward. */
function backtest(values: number[], model: Model): Scored | null {
  const minTrain = Math.max(4, Math.floor(values.length * 0.5));
  if (values.length - minTrain < 3) return null;
  const errors: number[] = [];
  const pctErrors: number[] = [];
  const naiveErrors: number[] = [];
  for (let cut = minTrain; cut < values.length; cut += 1) {
    const train = values.slice(0, cut);
    const actual = values[cut];
    const pred = predict(model, train, 1)[0];
    errors.push(actual - pred);
    if (Math.abs(actual) > 1e-9) pctErrors.push(Math.abs((actual - pred) / actual) * 100);
    naiveErrors.push(Math.abs(actual - train[train.length - 1]));
  }
  const mae = mean(errors.map(Math.abs));
  const naiveMae = mean(naiveErrors) || 1e-9;
  return {
    model,
    mase: Number((mae / naiveMae).toFixed(4)),
    mape: Number((pctErrors.length ? mean(pctErrors) : 0).toFixed(4)),
    rmse: Number(Math.sqrt(mean(errors.map((e) => e * e))).toFixed(4)),
    folds: errors.length,
    selected: false,
  };
}

const RATIONALE: Record<Model, string> = {
  naive: 'the series is dominated by its most recent level; no trend or season beat it',
  ses: 'the level drifts slowly with no persistent direction, so exponential smoothing of the level wins',
  holt: 'a persistent directional trend is present, so a damped linear trend model fits best',
};

/**
 * Continue the calendar rather than labelling projections "Jul 2026 +1". The
 * grain is recovered from the spacing of the last two observed periods, so a
 * weekly series advances by weeks and a monthly one by months.
 */
function futurePeriods(kpi: Kpi, horizon: number): { iso: string; label: string }[] {
  const series = kpi.series ?? [];
  const lastIso = series.length ? series[series.length - 1].period : null;
  const last = lastIso ? new Date(lastIso) : null;
  if (!last || Number.isNaN(last.getTime())) {
    return Array.from({ length: horizon }, (_, i) => ({
      iso: `${kpi.period_label} +${i + 1}`,
      label: `${kpi.period_label} +${i + 1}`,
    }));
  }

  const prevIso = series.length > 1 ? series[series.length - 2].period : null;
  const prev = prevIso ? new Date(prevIso) : null;
  const gapDays =
    prev && !Number.isNaN(prev.getTime())
      ? Math.round((last.getTime() - prev.getTime()) / 86_400_000)
      : 30;
  const grain: Grain =
    gapDays <= 2 ? 'day' : gapDays <= 10 ? 'week' : gapDays <= 45 ? 'month' : 'quarter';

  return Array.from({ length: horizon }, (_, i) => {
    const d = new Date(last.getTime());
    const step = i + 1;
    if (grain === 'day') d.setUTCDate(d.getUTCDate() + step);
    else if (grain === 'week') d.setUTCDate(d.getUTCDate() + 7 * step);
    else if (grain === 'month') d.setUTCMonth(d.getUTCMonth() + step);
    else d.setUTCMonth(d.getUTCMonth() + 3 * step);
    const iso = d.toISOString().slice(0, 10);
    return { iso, label: periodLabel(iso, grain) };
  });
}

export function forecastKpi(kpi: Kpi, horizon = 3): Forecast | null {
  const values = kpi.series.map((p) => p.value);
  if (values.length < 8) return null;
  if (values.every((v) => Math.abs(v - values[0]) < 1e-12)) return null;

  const scores = (['naive', 'ses', 'holt'] as Model[])
    .map((m) => backtest(values, m))
    .filter((s): s is Scored => s !== null);
  if (!scores.length) return null;

  scores.sort((a, b) => a.mase - b.mase);
  const winner = scores[0];
  winner.selected = true;
  const naiveScore = scores.find((s) => s.model === 'naive');
  const beatsNaive = winner.model !== 'naive' && !!naiveScore && winner.mase < naiveScore.mase * 0.98;

  const projection = predict(winner.model, values, horizon);
  const residualSd = stdev(values.slice(1).map((v, i) => v - values[i])) || Math.abs(mean(values)) * 0.05;
  const z = 1.2816; // 80% two-sided interval - deliberately not 95%, which lulls readers.

  const future = futurePeriods(kpi, horizon);

  const points: ForecastPoint[] = projection.map((value, i) => {
    const width = z * residualSd * Math.sqrt(i + 1);
    return {
      period: future[i].iso,
      label: future[i].label,
      index: kpi.series.length + i,
      value: Number(value.toFixed(4)),
      lower: Number((value - width).toFixed(4)),
      upper: Number((value + width).toFixed(4)),
      kind: 'forecast',
    } as ForecastPoint;
  });

  const last = values[values.length - 1];
  const end = points[points.length - 1];
  const change = last !== 0 ? (((end.value ?? last) - last) / Math.abs(last)) * 100 : 0;
  const shape = Math.abs(change) < 2 ? 'stay broadly flat' : change > 0 ? `rise ${change.toFixed(1)}%` : `fall ${Math.abs(change).toFixed(1)}%`;

  const caveats = [
    `Back-tested over ${winner.folds} rolling one-step-ahead folds; MASE ${winner.mase.toFixed(2)} (below 1.0 beats a naive benchmark).`,
    beatsNaive
      ? 'The selected model beats the naive benchmark, so the projection carries information beyond "next period looks like this one".'
      : 'The selected model does not beat a naive benchmark, so the projection should be read as a reference line rather than a prediction.',
    'The interval is an 80% band derived from period-over-period volatility; it widens with the square root of the horizon.',
    'A structural break - a pricing change, an acquisition, a policy change - would invalidate this projection entirely.',
  ];

  return {
    metric: kpi.id,
    metric_label: kpi.label,
    unit: kpi.unit,
    model: winner.model,
    model_rationale: RATIONALE[winner.model],
    horizon,
    points,
    scores,
    mase: winner.mase,
    mape: winner.mape,
    beats_naive: beatsNaive,
    seasonal_period: null,
    confidence_level: 0.8,
    narrative: `${kpi.label} is projected to ${shape} over the next ${horizon} periods, reaching ${(end.value ?? 0).toLocaleString('en-GB', { maximumFractionDigits: 2 })} by ${end.label} (80% interval ${(end.lower ?? 0).toLocaleString('en-GB', { maximumFractionDigits: 2 })} to ${(end.upper ?? 0).toLocaleString('en-GB', { maximumFractionDigits: 2 })}). Model: ${winner.model} - ${RATIONALE[winner.model]}.`,
    caveats,
  };
}
