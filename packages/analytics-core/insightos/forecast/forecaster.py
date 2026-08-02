"""Forecasting with honest, backtested uncertainty.

Most dashboard forecasts are a straight line with a made-up confidence band. This
module instead fits several cheap, well-understood models, selects between them by
**rolling-origin backtest** rather than in-sample fit, and derives the prediction
interval from the *observed* backtest errors of the winning model. The band
therefore reflects how wrong this model has actually been on this series, which is
the only defensible thing to show an executive.

Models (all implemented directly on NumPy so the package stays dependency-light):

* ``naive`` / ``seasonal_naive`` - the benchmarks every forecast must beat.
* ``drift`` - naive plus the average historical slope.
* ``ses`` - simple exponential smoothing (level only).
* ``holt`` - additive trend, with damping to stop long horizons exploding.
* ``holt_winters`` - additive trend plus additive seasonality.

Selection is by MASE (mean absolute scaled error) so accuracy is comparable across
metrics of wildly different magnitude; a MASE >= 1 means the model failed to beat
the naive benchmark and the report says so plainly instead of hiding it.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np

from ..statistics.distributions import norm_ppf
from ..types import to_jsonable

__all__ = ["ForecastPoint", "ModelScore", "Forecast", "forecast_series"]


@dataclass
class ForecastPoint:
    period: str
    index: int
    value: float
    lower: float
    upper: float


@dataclass
class ModelScore:
    model: str
    mase: float | None
    mape: float | None
    rmse: float | None
    folds: int
    selected: bool = False


@dataclass
class Forecast:
    metric: str
    metric_label: str
    model: str
    model_rationale: str
    horizon: int
    points: list[ForecastPoint] = field(default_factory=list)
    fitted: list[float | None] = field(default_factory=list)
    scores: list[ModelScore] = field(default_factory=list)
    mase: float | None = None
    mape: float | None = None
    beats_naive: bool = True
    seasonal_period: int | None = None
    confidence_level: float = 0.80
    narrative: str = ""
    caveats: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


# --------------------------------------------------------------------------- #
# models: each returns (fitted_in_sample, forecast_of_length_h)
# --------------------------------------------------------------------------- #

def _naive(y: np.ndarray, h: int, m: int | None) -> tuple[np.ndarray, np.ndarray]:
    fitted = np.concatenate([[np.nan], y[:-1]])
    return fitted, np.repeat(y[-1], h)


def _seasonal_naive(y: np.ndarray, h: int, m: int | None) -> tuple[np.ndarray, np.ndarray]:
    if not m or y.size <= m:
        return _naive(y, h, m)
    fitted = np.concatenate([np.full(m, np.nan), y[:-m]])
    reps = int(np.ceil(h / m))
    return fitted, np.tile(y[-m:], reps)[:h]


def _drift(y: np.ndarray, h: int, m: int | None) -> tuple[np.ndarray, np.ndarray]:
    n = y.size
    slope = (y[-1] - y[0]) / (n - 1) if n > 1 else 0.0
    fitted = np.concatenate([[np.nan], y[:-1] + slope])
    return fitted, y[-1] + slope * np.arange(1, h + 1)


def _ses(y: np.ndarray, h: int, m: int | None, alpha: float = 0.3
         ) -> tuple[np.ndarray, np.ndarray]:
    level = y[0]
    fitted = np.empty(y.size)
    fitted[0] = np.nan
    for i in range(1, y.size):
        fitted[i] = level
        level = alpha * y[i] + (1 - alpha) * level
    return fitted, np.repeat(level, h)


def _holt(y: np.ndarray, h: int, m: int | None, alpha: float = 0.3,
          beta: float = 0.1, phi: float = 0.92) -> tuple[np.ndarray, np.ndarray]:
    if y.size < 3:
        return _naive(y, h, m)
    level, trend = y[0], y[1] - y[0]
    fitted = np.empty(y.size)
    fitted[0] = np.nan
    for i in range(1, y.size):
        fitted[i] = level + phi * trend
        prev = level
        level = alpha * y[i] + (1 - alpha) * (level + phi * trend)
        trend = beta * (level - prev) + (1 - beta) * phi * trend
    damp = np.cumsum(phi ** np.arange(1, h + 1))
    return fitted, level + damp * trend


def _holt_winters(y: np.ndarray, h: int, m: int | None, alpha: float = 0.3,
                  beta: float = 0.08, gamma: float = 0.3, phi: float = 0.95
                  ) -> tuple[np.ndarray, np.ndarray]:
    if not m or y.size < 2 * m:
        return _holt(y, h, m)
    seasons = y[: (y.size // m) * m].reshape(-1, m)
    season = seasons.mean(axis=0) - seasons.mean()
    level = float(y[:m].mean())
    trend = float((y[m:2 * m].mean() - y[:m].mean()) / m)
    s = list(season)
    fitted = np.empty(y.size)
    fitted[:] = np.nan
    for i in range(y.size):
        si = s[i % m]
        fitted[i] = level + phi * trend + si
        prev = level
        level = alpha * (y[i] - si) + (1 - alpha) * (level + phi * trend)
        trend = beta * (level - prev) + (1 - beta) * phi * trend
        s[i % m] = gamma * (y[i] - level) + (1 - gamma) * si
    damp = np.cumsum(phi ** np.arange(1, h + 1))
    fc = level + damp * trend + np.array([s[(y.size + k) % m] for k in range(h)])
    return fitted, fc


MODELS: dict[str, Callable[[np.ndarray, int, "int | None"], tuple[np.ndarray, np.ndarray]]] = {
    "naive": _naive,
    "seasonal_naive": _seasonal_naive,
    "drift": _drift,
    "ses": _ses,
    "holt": _holt,
    "holt_winters": _holt_winters,
}

_RATIONALE = {
    "naive": "the series is dominated by its most recent level; no trend or season beat it",
    "seasonal_naive": ("the series repeats its seasonal pattern more reliably than any "
                       "smoothing model"),
    "drift": "a persistent linear drift explains the series better than smoothing",
    "ses": "the level moves but has no reliable trend, so a smoothed level forecasts best",
    "holt": "a damped additive trend produced the lowest backtest error",
    "holt_winters": ("an additive trend plus a repeating seasonal profile produced the "
                     "lowest backtest error"),
}


# --------------------------------------------------------------------------- #
# backtesting
# --------------------------------------------------------------------------- #

def _mase_scale(y: np.ndarray, m: int | None) -> float:
    """Denominator for MASE: the in-sample MAE of the naive benchmark."""
    lag = m if (m and y.size > m) else 1
    diffs = np.abs(y[lag:] - y[:-lag])
    scale = float(np.mean(diffs)) if diffs.size else 0.0
    return scale if scale > 0 else 1e-9


def _backtest(y: np.ndarray, model: str, m: int | None, horizon: int,
              folds: int = 4
              ) -> tuple[float | None, float | None, float | None, int, np.ndarray]:
    """Rolling-origin evaluation. Returns (mase, mape, rmse, folds_used, errors)."""
    fn = MODELS[model]
    scale = _mase_scale(y, m)
    min_train = max(6, (2 * m) if m else 6)
    errors: list[float] = []
    pct: list[float] = []
    used = 0
    for k in range(folds, 0, -1):
        cut = y.size - k * horizon
        if cut < min_train:
            continue
        train, actual = y[:cut], y[cut:cut + horizon]
        if actual.size == 0:
            continue
        try:
            _, fc = fn(train, actual.size, m)
        except Exception:
            continue
        err = np.asarray(fc, dtype=float)[:actual.size] - actual
        if not np.all(np.isfinite(err)):
            continue
        errors.extend(err.tolist())
        nz = actual != 0
        if nz.any():
            pct.extend((np.abs(err[nz]) / np.abs(actual[nz]) * 100.0).tolist())
        used += 1
    if not errors:
        return None, None, None, 0, np.array([])
    e = np.array(errors)
    return (float(np.mean(np.abs(e)) / scale),
            float(np.mean(pct)) if pct else None,
            float(np.sqrt(np.mean(e ** 2))),
            used, e)


def forecast_series(
    metric_id: str,
    metric_label: str,
    values: Sequence[float],
    labels: Sequence[str],
    horizon: int = 3,
    seasonal_period: int | None = None,
    confidence_level: float = 0.80,
    future_labels: Sequence[str] | None = None,
) -> Forecast | None:
    """Fit, backtest-select and forecast a single metric series."""
    y = np.array([v for v in values if v is not None and np.isfinite(v)], dtype=float)
    caveats: list[str] = []
    if y.size < 8:
        return None
    m = seasonal_period if (seasonal_period and y.size >= 2 * seasonal_period) else None
    horizon = max(1, min(horizon, max(1, y.size // 3)))

    candidates = [k for k in MODELS if k != "seasonal_naive" or m]
    scores: list[ModelScore] = []
    results: dict[str, tuple[float, np.ndarray]] = {}
    for name in candidates:
        mase, mape, rmse, folds, errs = _backtest(y, name, m, horizon)
        scores.append(ModelScore(name, mase, mape, rmse, folds))
        if mase is not None:
            results[name] = (mase, errs)

    if not results:
        # Not enough history to backtest; fall back to the safest benchmark.
        best = "seasonal_naive" if m else "naive"
        caveats.append("History was too short to backtest; a naive benchmark was used "
                       "and the interval is a rough dispersion estimate.")
        errs = np.diff(y)
    else:
        best = min(results, key=lambda k: results[k][0])
        errs = results[best][1]

    for s in scores:
        s.selected = s.model == best

    naive_key = "seasonal_naive" if m and "seasonal_naive" in results else "naive"
    naive_mase = results.get(naive_key, (None, None))[0]
    best_mase = results.get(best, (None, None))[0]
    beats = bool(best_mase is not None and best_mase < 1.0)
    if not beats and best_mase is not None:
        caveats.append(
            f"The selected model does not beat a naive benchmark (MASE {best_mase:.2f}); "
            "treat this forecast as a directional indication only."
        )

    fitted, fc = MODELS[best](y, horizon, m)

    # Interval from realised backtest errors, widened with the horizon by sqrt(k)
    # in the standard way. Using observed errors rather than a model-implied sigma
    # is what keeps the band honest.
    if errs.size >= 3:
        sigma = float(np.std(errs, ddof=1))
    else:
        sigma = float(np.std(np.diff(y))) if y.size > 2 else float(np.std(y))
    z = abs(norm_ppf((1 - confidence_level) / 2))
    if not np.isfinite(sigma) or sigma <= 0:
        sigma = abs(float(np.mean(y))) * 0.05

    if future_labels and len(future_labels) >= horizon:
        flabels = list(future_labels[:horizon])
    else:
        flabels = [f"T+{i + 1}" for i in range(horizon)]

    points = [
        ForecastPoint(
            period=flabels[i], index=len(values) + i, value=float(fc[i]),
            lower=float(fc[i] - z * sigma * np.sqrt(i + 1)),
            upper=float(fc[i] + z * sigma * np.sqrt(i + 1)),
        )
        for i in range(horizon)
    ]

    last = float(y[-1])
    end = points[-1].value
    change = ((end - last) / abs(last) * 100.0) if last else 0.0
    direction = "rise" if change > 1 else ("fall" if change < -1 else "stay broadly flat")
    narrative = (
        f"{metric_label} is projected to {direction} "
        f"{('by ' + format(abs(change), '.1f') + '% ') if abs(change) > 1 else ''}"
        f"over the next {horizon} period{'s' if horizon > 1 else ''}, reaching "
        f"{end:,.2f} by {points[-1].period} "
        f"({int(confidence_level * 100)}% interval {points[-1].lower:,.2f} to "
        f"{points[-1].upper:,.2f}). "
        f"Model: {best} - {_RATIONALE.get(best, 'lowest backtest error')}"
        + (f", MASE {best_mase:.2f} over {results[best][1].size} backtested points."
           if best_mase is not None else ".")
    )
    if naive_mase and best_mase and naive_key != best:
        narrative += (f" It improves on the {naive_key.replace('_', ' ')} benchmark by "
                      f"{(1 - best_mase / naive_mase) * 100:.0f}%.")

    return Forecast(
        metric=metric_id, metric_label=metric_label, model=best,
        model_rationale=_RATIONALE.get(best, "lowest backtest error"),
        horizon=horizon, points=points,
        fitted=[None if not np.isfinite(v) else float(v) for v in fitted],
        scores=sorted(scores, key=lambda s: (s.mase is None, s.mase)),
        mase=best_mase,
        mape=next((s.mape for s in scores if s.model == best), None),
        beats_naive=beats, seasonal_period=m, confidence_level=confidence_level,
        narrative=narrative, caveats=caveats,
    )
