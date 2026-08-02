"""Privacy layer: detect personal data, mask it, keep the default aggregate."""

from .detector import (
    PRIVACY_NOTICE,
    PrivacyReport,
    SensitiveCategory,
    SensitiveField,
    detect_sensitive_fields,
    mask_frame,
    mask_series,
    mask_value,
)

__all__ = [
    "PRIVACY_NOTICE",
    "PrivacyReport",
    "SensitiveCategory",
    "SensitiveField",
    "detect_sensitive_fields",
    "mask_frame",
    "mask_series",
    "mask_value",
]
