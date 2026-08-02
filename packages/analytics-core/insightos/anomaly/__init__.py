"""Anomaly detection: point anomalies, level shifts and peer-group outliers."""

from .detector import (
    Anomaly,
    AnomalyReport,
    SegmentAnomaly,
    detect_anomalies,
    detect_segment_anomalies,
)

__all__ = [
    "Anomaly",
    "AnomalyReport",
    "SegmentAnomaly",
    "detect_anomalies",
    "detect_segment_anomalies",
]
