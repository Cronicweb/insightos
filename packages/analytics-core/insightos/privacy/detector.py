"""Automatic detection and masking of sensitive fields.

InsightOS is designed to be pointed at real business data, which means it will
routinely be pointed at *personal* data. The privacy layer therefore runs before
anything is displayed, and it is deliberately conservative:

* Detection uses **two independent signals** - the column name and the column's
  *values* - and reports which one fired. A column called ``customer_id`` is
  flagged by name; a column called ``ref`` full of Luhn-valid 16-digit numbers is
  flagged by value. Either is enough.
* Masking is **format preserving**. ``a.patel@northwind.com`` becomes
  ``a****@northwind.com`` so an analyst can still see the email *domain*
  distribution, which is analytically useful, without seeing the person.
* The default output mode is **aggregate only**. Row-level identifiers are never
  rendered unless the caller explicitly asks for drill-down, and that request is
  recorded so it can be audited.

Nothing here phones home and nothing is persisted: the report describes what was
found so the UI can tell the user, in plain words, what it decided to hide.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import asdict, dataclass, field
from typing import Any

import pandas as pd

from ..types import to_jsonable

__all__ = [
    "SensitiveCategory",
    "SensitiveField",
    "PrivacyReport",
    "detect_sensitive_fields",
    "mask_value",
    "mask_series",
    "mask_frame",
    "PRIVACY_NOTICE",
]

PRIVACY_NOTICE = "Your data never leaves your device. All analysis runs locally."


class SensitiveCategory:
    """String constants rather than an Enum so the JSON contract stays flat."""

    EMAIL = "email"
    PHONE = "phone"
    PAYMENT_CARD = "payment_card"
    NATIONAL_ID = "national_id"
    ACCOUNT = "account"
    IDENTIFIER = "identifier"
    PERSON_NAME = "person_name"
    ADDRESS = "address"
    DATE_OF_BIRTH = "date_of_birth"
    IP_ADDRESS = "ip_address"
    GEO_PRECISE = "geo_precise"
    HEALTH = "health"


# --------------------------------------------------------------------------- #
# name signals
# --------------------------------------------------------------------------- #
_NAME_RULES: tuple[tuple[str, str, float], ...] = (
    (r"(^|_)e?mail(_|$)|email_address", SensitiveCategory.EMAIL, 0.95),
    (r"phone|mobile|msisdn|telephone|contact_number", SensitiveCategory.PHONE, 0.92),
    (r"card_?(number|no|pan)|credit_?card|pan$|cc_?num", SensitiveCategory.PAYMENT_CARD, 0.97),
    (r"ssn|social_security|national_id|aadhaar|nino|passport|tax_?id|pan_?card",
     SensitiveCategory.NATIONAL_ID, 0.97),
    (r"iban|account_?(number|no)|sort_?code|routing", SensitiveCategory.ACCOUNT, 0.9),
    (r"(^|_)(customer|client|member|patient|employee|user|account|subscriber|merchant)_?id(_|$)",
     SensitiveCategory.IDENTIFIER, 0.85),
    (r"(first|last|full|given|sur)_?name|customer_name|patient_name|employee_name",
     SensitiveCategory.PERSON_NAME, 0.85),
    (r"address|street|postcode|post_code|zip_?code|addr_line", SensitiveCategory.ADDRESS, 0.88),
    (r"(date_of_birth|dob|birth_?date)", SensitiveCategory.DATE_OF_BIRTH, 0.95),
    (r"ip_?address|client_ip|remote_addr", SensitiveCategory.IP_ADDRESS, 0.9),
    (r"latitude|longitude|(^|_)lat(_|$)|(^|_)lon(g)?(_|$)|geo_point",
     SensitiveCategory.GEO_PRECISE, 0.7),
    (r"diagnosis|icd_?10|icd_?9|medical_record|mrn|treatment_code",
     SensitiveCategory.HEALTH, 0.85),
)

# --------------------------------------------------------------------------- #
# value signals
# --------------------------------------------------------------------------- #
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
_PHONE_RE = re.compile(r"^\+?[\d][\d\s\-().]{6,17}\d$")
_IP_RE = re.compile(r"^(\d{1,3}\.){3}\d{1,3}$")
_SSN_RE = re.compile(r"^\d{3}-?\d{2}-?\d{4}$")
_IBAN_RE = re.compile(r"^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$")
_DIGITS_RE = re.compile(r"\D")


def _luhn(number: str) -> bool:
    """Payment-card checksum. Distinguishes a real PAN from any long number."""
    digits = [int(c) for c in number if c.isdigit()]
    if not 12 <= len(digits) <= 19:
        return False
    total, parity = 0, len(digits) % 2
    for index, digit in enumerate(digits):
        if index % 2 == parity:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return total % 10 == 0


def _value_signal(sample: list[str]) -> tuple[str, float] | None:
    """Classify a sample of stringified values. Requires a strong majority."""
    if not sample:
        return None
    n = len(sample)

    def share(predicate) -> float:
        return sum(1 for v in sample if predicate(v)) / n

    checks: tuple[tuple[str, float], ...] = (
        (SensitiveCategory.EMAIL, share(lambda v: bool(_EMAIL_RE.match(v)))),
        (SensitiveCategory.IP_ADDRESS, share(lambda v: bool(_IP_RE.match(v)))),
        (SensitiveCategory.NATIONAL_ID, share(lambda v: bool(_SSN_RE.match(v)))),
        (SensitiveCategory.ACCOUNT, share(lambda v: bool(_IBAN_RE.match(v.upper())))),
        (SensitiveCategory.PAYMENT_CARD,
         share(lambda v: _luhn(_DIGITS_RE.sub("", v)) and len(_DIGITS_RE.sub("", v)) >= 13)),
        (SensitiveCategory.PHONE, share(lambda v: bool(_PHONE_RE.match(v)))),
    )
    category, hit = max(checks, key=lambda c: c[1])
    if hit >= 0.8:
        return category, round(min(0.99, 0.6 + hit * 0.35), 3)
    return None


def _looks_like_row_key(series: pd.Series, rows: int) -> bool:
    """A near-unique, non-numeric-measure column behaves as a row identifier."""
    if rows < 20 or series.empty:
        return False
    return series.nunique(dropna=True) / max(1, len(series)) >= 0.92


# --------------------------------------------------------------------------- #
@dataclass
class SensitiveField:
    column: str
    category: str
    confidence: float
    detected_by: str                    # column_name | value_pattern | cardinality
    policy: str                         # mask | hash | aggregate_only
    rationale: str
    example_masked: str = ""
    distinct_values: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


@dataclass
class PrivacyReport:
    """What the privacy layer found, and what it did about it."""

    fields: list[SensitiveField] = field(default_factory=list)
    scanned_columns: int = 0
    aggregate_only: bool = True
    drill_down_granted: bool = False
    notice: str = PRIVACY_NOTICE
    method_notes: list[str] = field(default_factory=list)

    @property
    def masked_columns(self) -> int:
        return len(self.fields)

    def columns(self) -> list[str]:
        return [f.column for f in self.fields]

    def is_masked(self, column: str) -> bool:
        return any(f.column == column for f in self.fields)

    def category_for(self, column: str) -> str | None:
        return next((f.category for f in self.fields if f.column == column), None)

    def to_dict(self) -> dict[str, Any]:
        return {
            "fields": [f.to_dict() for f in self.fields],
            "scannedColumns": self.scanned_columns,
            "maskedColumns": self.masked_columns,
            "aggregateOnly": self.aggregate_only,
            "drillDownGranted": self.drill_down_granted,
            "notice": self.notice,
            "methodNotes": list(self.method_notes),
        }


# --------------------------------------------------------------------------- #
def detect_sensitive_fields(df: pd.DataFrame, schema: Any = None, *,
                            sample_size: int = 400,
                            drill_down_granted: bool = False) -> PrivacyReport:
    """Scan a DataFrame for personal data and decide a policy for each hit."""
    report = PrivacyReport(scanned_columns=int(df.shape[1]),
                           drill_down_granted=bool(drill_down_granted))
    report.method_notes = [
        "Columns are matched on both their name and a sample of their values; the "
        "signal that fired is recorded so the decision can be challenged.",
        "Masking is format preserving - an email keeps its domain and a card keeps "
        "its last four digits - so aggregate analysis stays possible.",
        "Row-level identifiers are aggregated by default; drill-down is an explicit, "
        "audited action rather than the default state.",
    ]
    identifiers = set(getattr(schema, "primary_key", None) or [])
    rows = int(len(df))

    for column in df.columns:
        name = str(column).strip().lower()
        hit: tuple[str, float, str, str] | None = None

        for pattern, category, confidence in _NAME_RULES:
            if re.search(pattern, name):
                hit = (category, confidence, "column_name",
                       f"the column name matches the {category.replace('_', ' ')} pattern "
                       f"/{pattern}/")
                break

        series = df[column].dropna()
        sample = [str(v) for v in series.head(sample_size).tolist()]

        if hit is None:
            signal = _value_signal(sample)
            if signal is not None:
                category, confidence = signal
                hit = (category, confidence, "value_pattern",
                       f"at least 80% of sampled values match the "
                       f"{category.replace('_', ' ')} format")

        if hit is None and column in identifiers and _looks_like_row_key(series, rows):
            hit = (SensitiveCategory.IDENTIFIER, 0.7, "cardinality",
                   "the column is a detected primary key with near-unique values, so it "
                   "identifies a single subject")

        if hit is None:
            continue

        category, confidence, detected_by, rationale = hit
        policy = ("aggregate_only" if category in (SensitiveCategory.IDENTIFIER,
                                                   SensitiveCategory.GEO_PRECISE)
                  else "mask")
        report.fields.append(SensitiveField(
            column=str(column),
            category=category,
            confidence=round(float(confidence), 3),
            detected_by=detected_by,
            policy=policy,
            rationale=rationale,
            example_masked=mask_value(sample[0], category) if sample else "",
            distinct_values=int(series.nunique()) if not series.empty else 0,
        ))

    report.fields.sort(key=lambda f: (-f.confidence, f.column))
    return report


# --------------------------------------------------------------------------- #
def _hash_token(value: str, length: int = 8) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:length]


def mask_value(value: Any, category: str) -> str:
    """Format-preserving mask for a single value."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    text = str(value)
    if not text:
        return ""

    if category == SensitiveCategory.EMAIL and "@" in text:
        local, _, domain = text.partition("@")
        return f"{local[:1]}{'*' * max(3, len(local) - 1)}@{domain}"
    if category == SensitiveCategory.PAYMENT_CARD:
        digits = _DIGITS_RE.sub("", text)
        return f"**** **** **** {digits[-4:]}" if len(digits) >= 4 else "****"
    if category == SensitiveCategory.PHONE:
        digits = _DIGITS_RE.sub("", text)
        return f"***-***-{digits[-4:]}" if len(digits) >= 4 else "****"
    if category == SensitiveCategory.NATIONAL_ID:
        return f"***-**-{text[-4:]}" if len(text) >= 4 else "****"
    if category == SensitiveCategory.IP_ADDRESS:
        parts = text.split(".")
        return ".".join(parts[:2] + ["x", "x"]) if len(parts) == 4 else "x.x.x.x"
    if category == SensitiveCategory.PERSON_NAME:
        return " ".join(f"{p[:1]}." for p in text.split() if p) or "*"
    if category == SensitiveCategory.ADDRESS:
        tail = text.split()[-1] if text.split() else ""
        return f"[address] {tail}" if len(tail) <= 10 else "[address]"
    if category == SensitiveCategory.DATE_OF_BIRTH:
        return text[:4] + "-**-**" if len(text) >= 4 else "****"
    if category == SensitiveCategory.GEO_PRECISE:
        try:
            return f"{float(text):.1f}"
        except (TypeError, ValueError):
            return "***"
    return f"{text[:2]}\u2026{_hash_token(text, 6)}" if len(text) > 4 else f"id-{_hash_token(text, 6)}"


def mask_series(series: pd.Series, category: str) -> pd.Series:
    return series.map(lambda v: mask_value(v, category))


def mask_frame(df: pd.DataFrame, report: PrivacyReport, *,
               allow_drill_down: bool = False) -> pd.DataFrame:
    """Return a display-safe copy of ``df``.

    The original frame is never mutated: analysis continues on real values while
    only the *rendered* frame is masked. That separation is what lets InsightOS
    compute an accurate distinct-customer count without ever showing a customer.
    """
    if not report.fields:
        return df
    out = df.copy()
    for entry in report.fields:
        if entry.column not in out.columns:
            continue
        if allow_drill_down and entry.policy == "aggregate_only":
            continue
        out[entry.column] = mask_series(out[entry.column], entry.category)
    return out
