"""Anomaly detection over KPI time series and dataset segments.

Three complementary detectors run over every KPI series, because no single method
survives real business data:

* **Robust z-score on the seasonal residual** - catches a single bad period after
  trend and seasonality have been removed, using median/MAD so that the outlier
  does not inflate its own threshold.
* **Prediction-interval breach** - fits a local level+trend expectation from the
  preceding window and flags points outside the interval, which catches sustained
  drift that a per-point z-score forgives.
* **Level shift (CUSUM / change point)** - catches "it never came back", the
  pattern that matters most to a business and that point-anomaly detectors miss
  entirely.

Segment anomalies (a single region behaving unlike its peers) are detected with a
robust z-score across segments in the current period, which is what surfaces the
"one channel is broken" case before anyone thinks to filter for it.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from ..statistics.timeseries import classical_decompose, detect_change_points, rolling_mad_z
from ..types import Severity, to_jsonable

__all__ = ["Anomaly", "SegmentAnomaly", "AnomalyReport", "detect_anomalies",
           "detect_segment_anomalies"]


@dataclass
class Anomaly:
    metric: str
    metric_label: str
    period: str
    index: int
    observed: float
    expected: float | None
    deviation: float | None
    deviation_pct: float | None
    z_score: float | None
    method: str
    kind: str                      # spike | dip | level_shift | drift
    severity: Severity
    confidence: float
    narrative: str

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


@dataclass
class SegmentAnomaly:
    metric: str
    dimension: str
    segment: str
    value: float
    peer_median: float
    robust_z: float
    direction: str
    share_of_total_pct: float | None
    severity: Severity
    narrative: str

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


@dataclass
class AnomalyReport:
    anomalies: list[Anomaly] = field(default_factory=list)
    segment_anomalies: list[SegmentAnomaly] = field(default_factory=list)
    scanned_metrics: int = 0
    scanned_points: int = 0
    method_notes: list[str] = field(default_factory=list)

    @property
    def critical_count(self) -> int:
        return sum(1 for a in self.anomalies
                   if a.severity in (Severity.CRITICAL, Severity.HIGH))

    def to_dict(self) -> dict[str, Any]:
        d = to_jsonable(asdict(self))
        d["critical_count"] = self.critical_count
        return d


_TIERS = (Severity.LOW, Severity.MEDIUM, Severity.HIGH, Severity.CRITICAL)


def _sigma(z: float) -> str:
    """Beyond about ten sigma the exact figure is an artefact of the scale estimate,
    not a meaningful quantity. Reporting '20.9-sigma' invites the reader to conclude
    the tool is broken, so it is truncated honestly instead."""
    a = abs(z)
    return "over 10-sigma" if a > 10 else f"{a:.1f}-sigma"


def _severity_from_z(z: float, deviation_pct: float | None) -> Severity:
    """Severity needs *both* statistical extremity and business materiality.

    A very stable series makes tiny moves look enormous in sigma terms: a 3.5% dip in
    average order value can score 20 sigma simply because the metric barely moves. That
    is a genuine statistical signal and worth surfacing, but calling it CRITICAL next to
    a 70% fraud spike destroys the reader's trust in the whole severity scale. So the
    final tier is the lower of the two views - the statistics decide whether it is real,
    the magnitude decides whether it matters.
    """
    a = abs(z)
    stat = 3 if a >= 4.5 else 2 if a >= 3.5 else 1 if a >= 3.0 else 0

    if deviation_pct is None:
        # No comparable baseline to judge materiality against; do not let the
        # statistical view alone claim the top tier.
        return _TIERS[min(stat, 2)]

    d = abs(deviation_pct)
    material = 3 if d >= 25 else 2 if d >= 10 else 1 if d >= 4 else 0
    return _TIERS[min(stat, material)]


def detect_anomalies(
    metric_id: str,
    metric_label: str,
    values: list[float],
    labels: list[str],
    seasonal_period: int | None = None,
    z_threshold: float = 3.0,
    window: int = 12,
) -> list[Anomaly]:
    """Run the three detectors over one KPI series and merge their findings."""
    clean = [(i, v, labels[i] if i < len(labels) else str(i))
             for i, v in enumerate(values) if v is not None and np.isfinite(v)]
    if len(clean) < 6:
        return []
    idx = [c[0] for c in clean]
    series = np.array([c[1] for c in clean], dtype=float)
    names = [c[2] for c in clean]
    found: dict[int, Anomaly] = {}

    # ---- 0. level shifts run FIRST ---- #
    # A sustained level shift otherwise re-reports itself as one "dip" per period
    # after the break. Detecting the regime change first lets us attribute those
    # points to it instead of drowning the user in duplicates.
    shifts = detect_change_points(list(series), labels=names,
                                  min_segment=max(3, window // 3))
    explained: dict[int, int] = {}          # index -> sign of the shift it belongs to
    for cp in shifts:
        sign = 1 if cp.mean_after >= cp.mean_before else -1
        for p in range(cp.index, len(series)):
            explained.setdefault(p, sign)

    # ---- 1. robust z on the seasonal residual ---- #
    residual = series
    if seasonal_period and len(series) >= seasonal_period * 2:
        dec = classical_decompose(list(series), seasonal_period)
        if dec.residual:
            residual = np.nan_to_num(np.asarray(dec.residual, dtype=float), nan=0.0)
    med = float(np.median(residual))
    mad = float(np.median(np.abs(residual - med)))
    scale = mad * 1.4826 if mad > 0 else float(np.std(residual)) or 1e-9
    scale = max(scale, abs(float(np.median(series))) * 0.005, 1e-9)
    zs = (residual - med) / scale
    for pos, z in enumerate(zs):
        if abs(z) < z_threshold:
            continue
        if explained.get(pos) == (1 if z > 0 else -1):
            continue        # already accounted for by a level shift
        expected = float(series[pos] - residual[pos] + med)
        deviation = float(series[pos] - expected)
        dev_pct = (deviation / abs(expected) * 100.0) if expected else None
        found[idx[pos]] = Anomaly(
            metric=metric_id, metric_label=metric_label, period=names[pos],
            index=idx[pos], observed=float(series[pos]), expected=expected,
            deviation=deviation, deviation_pct=dev_pct, z_score=float(z),
            method="robust z-score on seasonal residual",
            kind="spike" if z > 0 else "dip",
            severity=_severity_from_z(float(z), dev_pct),
            confidence=round(float(min(0.99, 0.55 + 0.1 * abs(z))), 3),
            narrative=(
                f"{metric_label} in {names[pos]} was {series[pos]:,.2f} versus an expected "
                f"{expected:,.2f} ({dev_pct:+.1f}%), a {_sigma(z)} deviation after removing "
                f"trend and seasonality"
                + (". The series is normally very stable, so a small percentage move "
                   "registers as a large statistical one."
                   if abs(z) > 8 and abs(dev_pct) < 10 else ".")
                if dev_pct is not None else
                f"{metric_label} in {names[pos]} deviated {_sigma(z)} from expectation."
            ),
        )

    # ---- 2. rolling prediction-interval breach ---- #
    rolling = rolling_mad_z(list(series), window=window)
    for pos, z in enumerate(rolling):
        if not np.isfinite(z) or abs(z) < z_threshold + 0.5 or idx[pos] in found:
            continue
        if explained.get(pos) == (1 if z > 0 else -1):
            continue
        base = float(np.median(series[max(0, pos - window):pos])) if pos else float(series[0])
        deviation = float(series[pos] - base)
        dev_pct = (deviation / abs(base) * 100.0) if base else None
        found[idx[pos]] = Anomaly(
            metric=metric_id, metric_label=metric_label, period=names[pos], index=idx[pos],
            observed=float(series[pos]), expected=base, deviation=deviation,
            deviation_pct=dev_pct, z_score=float(z),
            method=f"rolling {window}-period robust z-score",
            kind="spike" if z > 0 else "dip",
            severity=_severity_from_z(float(z), dev_pct),
            confidence=round(float(min(0.97, 0.5 + 0.1 * abs(z))), 3),
            narrative=(f"{metric_label} in {names[pos]} broke out of its rolling "
                       f"{window}-period range ({series[pos]:,.2f} vs a local median of "
                       f"{base:,.2f}, {_sigma(z)})."),
        )

    # ---- 3. emit the level shifts found in step 0 ---- #
    for cp in shifts:
        pos = cp.index
        if pos >= len(names):
            continue
        dev_pct = ((cp.mean_after - cp.mean_before) / abs(cp.mean_before) * 100.0
                   if cp.mean_before else None)
        severity = _severity_from_z(3.4 if cp.p_value and cp.p_value < 0.01 else 2.5, dev_pct)
        anomaly = Anomaly(
            metric=metric_id, metric_label=metric_label, period=names[pos], index=idx[pos],
            observed=float(series[pos]), expected=float(cp.mean_before),
            deviation=float(cp.mean_after - cp.mean_before), deviation_pct=dev_pct,
            z_score=None, method="binary-segmentation change point (Welch validated)",
            kind="level_shift", severity=severity,
            confidence=round(float(1.0 - (cp.p_value or 0.05)), 3),
            narrative=(f"{metric_label} shifted level at {names[pos]}: the average moved from "
                       f"{cp.mean_before:,.2f} to {cp.mean_after:,.2f} "
                       f"({dev_pct:+.1f}%) and stayed there (p = {cp.p_value:.4g})."
                       if dev_pct is not None else
                       f"{metric_label} changed level at {names[pos]}."),
        )
        # A regime change always outranks a point anomaly at the same period:
        # "it dropped and stayed down" is the more actionable statement.
        found[idx[pos]] = anomaly

    return sorted(found.values(), key=lambda a: (-a.severity.rank, -a.index))


def detect_segment_anomalies(
    df: pd.DataFrame,
    dimension: str,
    value_column: str,
    metric_id: str,
    agg: str = "sum",
    z_threshold: float = 2.5,
    min_segments: int = 4,
) -> list[SegmentAnomaly]:
    """Find segments that behave unlike their peers in the current data."""
    if dimension not in df.columns or value_column not in df.columns:
        return []
    grouped = df.groupby(df[dimension].astype(str))[value_column]
    values = grouped.sum() if agg == "sum" else grouped.mean()
    values = values.dropna()
    if values.size < min_segments:
        return []
    arr = values.to_numpy(dtype=float)
    med = float(np.median(arr))
    mad = float(np.median(np.abs(arr - med)))
    scale = mad * 1.4826 if mad > 0 else float(np.std(arr)) or 1e-9
    # Near-identical peers make MAD collapse and every deviation look like 40 sigma.
    # Floor the scale at 2% of the peer median so the score stays interpretable.
    scale = max(scale, abs(med) * 0.02, 1e-9)
    total = float(arr.sum())
    out: list[SegmentAnomaly] = []
    for segment, value in values.items():
        z = (float(value) - med) / scale
        if abs(z) < z_threshold:
            continue
        share = (float(value) / total * 100.0) if total else None
        out.append(SegmentAnomaly(
            metric=metric_id, dimension=dimension, segment=str(segment), value=float(value),
            peer_median=med, robust_z=float(z),
            direction="above" if z > 0 else "below",
            share_of_total_pct=share,
            severity=_severity_from_z(float(z), None),
            narrative=(f"{dimension} '{segment}' sits {_sigma(z)} robust "
                       f"{'above' if z > 0 else 'below'} the peer median "
                       f"({value:,.2f} vs {med:,.2f})"
                       + (f" and represents {share:.1f}% of the total." if share else ".")),
        ))
    return sorted(out, key=lambda s: -abs(s.robust_z))
