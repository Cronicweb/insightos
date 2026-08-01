"""Time-series primitives: trend, seasonality, decomposition and change points.

These are the building blocks the anomaly detector, the chart narrator and the
forecaster all share, so that every module in InsightOS describes a series the
same way.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Any, Sequence

import numpy as np

from .distributions import norm_sf

__all__ = [
    "TrendResult",
    "SeasonalityResult",
    "Decomposition",
    "ChangePoint",
    "mann_kendall",
    "theil_sen_slope",
    "detect_seasonality",
    "classical_decompose",
    "detect_change_points",
    "rolling_mad_z",
    "cusum",
]


@dataclass
class TrendResult:
    direction: str            # increasing | decreasing | flat
    slope_per_period: float
    slope_pct_per_period: float
    p_value: float
    tau: float
    significant: bool
    n: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class SeasonalityResult:
    detected: bool
    period: int | None
    strength: float           # 0..1, share of variance explained by the seasonal component
    peak_label: str | None = None
    trough_label: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Decomposition:
    trend: list[float]
    seasonal: list[float]
    residual: list[float]
    period: int
    model: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ChangePoint:
    index: int
    label: str | None
    mean_before: float
    mean_after: float
    delta_pct: float
    p_value: float
    kind: str                 # level_shift | trend_break

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _finite(y: Sequence[float]) -> np.ndarray:
    return np.asarray(y, dtype="float64")


# --------------------------------------------------------------------------- #
# Trend
# --------------------------------------------------------------------------- #
def mann_kendall(y: Sequence[float], alpha: float = 0.05) -> TrendResult:
    """Non-parametric Mann-Kendall trend test with tie-corrected variance.

    Chosen over OLS because business series are rarely normal and frequently
    contain spikes; MK only uses the sign of pairwise differences.
    """
    x = _finite(y)
    x = x[np.isfinite(x)]
    n = x.size
    if n < 4:
        return TrendResult("flat", 0.0, 0.0, 1.0, 0.0, False, int(n))

    signs = np.sign(x[None, :] - x[:, None])
    s = float(np.triu(signs, 1).sum())
    _, counts = np.unique(x, return_counts=True)
    tie_term = float((counts * (counts - 1) * (2 * counts + 5)).sum())
    var_s = (n * (n - 1) * (2 * n + 5) - tie_term) / 18.0
    if var_s <= 0:
        return TrendResult("flat", 0.0, 0.0, 1.0, 0.0, False, int(n))
    if s > 0:
        z = (s - 1) / math.sqrt(var_s)
    elif s < 0:
        z = (s + 1) / math.sqrt(var_s)
    else:
        z = 0.0
    p = 2.0 * norm_sf(abs(z))
    tau = 2.0 * s / (n * (n - 1))
    slope = theil_sen_slope(x)
    base = float(np.nanmean(np.abs(x))) or 1.0
    significant = p < alpha
    direction = "flat" if not significant else ("increasing" if slope > 0 else "decreasing")
    return TrendResult(direction, float(slope), float(slope / base * 100.0), float(p),
                       float(tau), significant, int(n))


def theil_sen_slope(y: Sequence[float]) -> float:
    """Median of pairwise slopes - a robust, outlier-resistant trend estimate."""
    x = _finite(y)
    mask = np.isfinite(x)
    x = x[mask]
    n = x.size
    if n < 2:
        return 0.0
    t = np.arange(n, dtype="float64")
    i, j = np.triu_indices(n, 1)
    dt = t[j] - t[i]
    slopes = (x[j] - x[i]) / dt
    return float(np.median(slopes))


# --------------------------------------------------------------------------- #
# Seasonality
# --------------------------------------------------------------------------- #
def detect_seasonality(
    y: Sequence[float],
    candidate_periods: Sequence[int] = (7, 12, 4, 52, 30, 24),
    labels: Sequence[str] | None = None,
) -> SeasonalityResult:
    """Pick the candidate period with the strongest autocorrelation signal.

    Strength is measured the STL way: 1 - Var(residual)/Var(residual + seasonal).
    """
    x = _finite(y)
    x = x[np.isfinite(x)]
    n = x.size
    best: tuple[float, int] | None = None
    for period in candidate_periods:
        if period < 2 or n < 2 * period + 1:
            continue
        r = _autocorr(x, period)
        if r is None:
            continue
        # penalise long periods slightly so 7 beats 14 on identical evidence
        score = r - 0.01 * math.log(period)
        if best is None or score > best[0]:
            best = (score, period)
    if best is None or best[0] < 0.25:
        return SeasonalityResult(False, None, 0.0)

    period = best[1]
    dec = classical_decompose(x, period)
    seasonal = np.asarray(dec.seasonal)
    resid = np.asarray(dec.residual)
    denom = np.nanvar(seasonal + resid)
    strength = 0.0 if denom <= 0 else max(0.0, 1.0 - np.nanvar(resid) / denom)
    peak = trough = None
    if labels is not None and len(labels) >= period:
        phase = np.array([np.nanmean(seasonal[i::period]) for i in range(period)])
        peak = str(labels[int(np.nanargmax(phase))])
        trough = str(labels[int(np.nanargmin(phase))])
    return SeasonalityResult(strength >= 0.3, period, float(strength), peak, trough)


def _autocorr(x: np.ndarray, lag: int) -> float | None:
    if x.size <= lag + 1:
        return None
    a, b = x[:-lag], x[lag:]
    if a.std() == 0 or b.std() == 0:
        return None
    return float(np.corrcoef(a, b)[0, 1])


def classical_decompose(y: Sequence[float], period: int, model: str = "additive") -> Decomposition:
    """Centred moving-average decomposition (the classical, explainable variant)."""
    x = _finite(y).astype("float64")
    n = x.size
    if period < 2 or n < 2 * period:
        return Decomposition(x.tolist(), [0.0] * n, [0.0] * n, period, model)

    trend = _centred_ma(x, period)
    detrended = x - trend if model == "additive" else np.divide(
        x, trend, out=np.ones_like(x), where=trend != 0
    )
    phase_means = np.array(
        [np.nanmean(detrended[i::period]) if np.isfinite(detrended[i::period]).any() else 0.0
         for i in range(period)]
    )
    phase_means = phase_means - np.nanmean(phase_means) if model == "additive" else (
        phase_means / (np.nanmean(phase_means) or 1.0)
    )
    seasonal = np.array([phase_means[i % period] for i in range(n)])
    residual = x - trend - seasonal if model == "additive" else np.divide(
        x, trend * seasonal, out=np.ones_like(x), where=(trend * seasonal) != 0
    )
    return Decomposition(
        _nan_to_list(trend), _nan_to_list(seasonal), _nan_to_list(residual), period, model
    )


def _centred_ma(x: np.ndarray, period: int) -> np.ndarray:
    n = x.size
    out = np.full(n, np.nan)
    half = period // 2
    for i in range(n):
        lo, hi = i - half, i + half + 1
        if lo < 0 or hi > n:
            continue
        window = x[lo:hi]
        if period % 2 == 0:
            w = np.ones(window.size)
            w[0] = w[-1] = 0.5
            out[i] = float(np.nansum(window * w) / w.sum())
        else:
            out[i] = float(np.nanmean(window))
    # extend the ends so downstream arithmetic stays defined
    valid = np.where(np.isfinite(out))[0]
    if valid.size:
        out[: valid[0]] = out[valid[0]]
        out[valid[-1] + 1 :] = out[valid[-1]]
    else:
        out[:] = float(np.nanmean(x))
    return out


def _nan_to_list(a: np.ndarray) -> list[float]:
    return [None if not np.isfinite(v) else float(v) for v in a]  # type: ignore[list-item]


# --------------------------------------------------------------------------- #
# Change points
# --------------------------------------------------------------------------- #
def detect_change_points(
    y: Sequence[float],
    labels: Sequence[str] | None = None,
    min_segment: int = 4,
    max_points: int = 3,
    alpha: float = 0.01,
) -> list[ChangePoint]:
    """Binary segmentation on the mean, each split validated by a Welch t-test.

    This is what lets a chart caption say "growth slowed after week 17" instead
    of "the line goes up" - the week is found, not asserted.
    """
    from .tests import welch_t_test  # local import avoids a cycle at module load

    x = _finite(y)
    x = np.where(np.isfinite(x), x, np.nan)
    found: list[ChangePoint] = []

    def _search(lo: int, hi: int, depth: int) -> None:
        if depth >= max_points or hi - lo < 2 * min_segment:
            return
        seg = x[lo:hi]
        best_idx, best_stat = None, 0.0
        for k in range(min_segment, seg.size - min_segment + 1):
            a, b = seg[:k], seg[k:]
            ma, mb = np.nanmean(a), np.nanmean(b)
            if not (np.isfinite(ma) and np.isfinite(mb)):
                continue
            stat = abs(ma - mb) * math.sqrt(a.size * b.size / seg.size)
            if stat > best_stat:
                best_stat, best_idx = stat, k
        if best_idx is None:
            return
        res = welch_t_test(seg[:best_idx], seg[best_idx:])
        if res.p_value >= alpha:
            return
        mb_, ma_ = float(np.nanmean(seg[:best_idx])), float(np.nanmean(seg[best_idx:]))
        idx = lo + best_idx
        found.append(
            ChangePoint(
                index=int(idx),
                label=str(labels[idx]) if labels is not None and idx < len(labels) else None,
                mean_before=mb_,
                mean_after=ma_,
                delta_pct=((ma_ - mb_) / abs(mb_) * 100.0) if mb_ else 0.0,
                p_value=float(res.p_value),
                kind="level_shift",
            )
        )
        _search(lo, idx, depth + 1)
        _search(idx, hi, depth + 1)

    _search(0, x.size, 0)
    found.sort(key=lambda c: c.index)
    return found[:max_points]


def rolling_mad_z(y: Sequence[float], window: int = 7) -> np.ndarray:
    """Robust z-score against a rolling median / MAD baseline (0.6745 scaling)."""
    x = _finite(y)
    n = x.size
    z = np.zeros(n)
    for i in range(n):
        lo = max(0, i - window)
        ref = x[lo:i] if i > 0 else x[:1]
        ref = ref[np.isfinite(ref)]
        if ref.size < 3:
            continue
        med = float(np.median(ref))
        mad = float(np.median(np.abs(ref - med)))
        scale = 1.4826 * mad if mad > 0 else float(np.std(ref))
        if scale == 0:
            # A perfectly flat reference window has no natural scale, but a
            # departure from it is maximally surprising rather than unremarkable.
            # Fall back to a proportional scale so genuine spikes still register.
            scale = max(abs(med), 1.0) * 1e-3
        z[i] = (x[i] - med) / scale
    z = np.clip(z, -1e6, 1e6)
    return z


def cusum(y: Sequence[float], threshold: float = 5.0, drift: float = 0.5) -> list[int]:
    """Two-sided CUSUM detector - fast structural break flags for streaming use."""
    x = _finite(y)
    if x.size < 3:
        return []
    mu = float(np.nanmean(x))
    sigma = float(np.nanstd(x)) or 1.0
    s_pos = s_neg = 0.0
    alarms: list[int] = []
    for i, v in enumerate(x):
        norm = (v - mu) / sigma
        s_pos = max(0.0, s_pos + norm - drift)
        s_neg = min(0.0, s_neg + norm + drift)
        if s_pos > threshold or s_neg < -threshold:
            alarms.append(i)
            s_pos = s_neg = 0.0
    return alarms
