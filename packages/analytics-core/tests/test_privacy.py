"""Sensitive-field detection and masking."""
from __future__ import annotations

import pandas as pd
import pytest

from insightos.privacy import (
    PRIVACY_NOTICE,
    SensitiveCategory,
    detect_sensitive_fields,
    mask_frame,
    mask_series,
    mask_value,
)


@pytest.fixture()
def personal_frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "customer_id": [f"CUST-{i:05d}" for i in range(60)],
            "email": [f"user{i}@example.com" for i in range(60)],
            "phone_number": [f"+1-415-555-{i:04d}" for i in range(60)],
            "card_number": ["4539578763621486"] * 60,
            "region": (["East", "West", "North"] * 20),
            "revenue": [100.0 + i for i in range(60)],
        }
    )


def test_notice_is_explicit() -> None:
    assert "never leaves your device" in PRIVACY_NOTICE.lower()


def test_detects_each_personal_column(personal_frame: pd.DataFrame) -> None:
    report = detect_sensitive_fields(personal_frame)
    found = {f.column: f.category for f in report.fields}
    assert found["email"] == SensitiveCategory.EMAIL
    assert found["phone_number"] == SensitiveCategory.PHONE
    assert found["card_number"] == SensitiveCategory.PAYMENT_CARD
    assert "customer_id" in found
    assert report.scanned_columns == 6


def test_non_personal_columns_are_left_alone(personal_frame: pd.DataFrame) -> None:
    report = detect_sensitive_fields(personal_frame)
    assert "revenue" not in {f.column for f in report.fields}
    assert "region" not in {f.column for f in report.fields}


def test_report_serialises_to_camel_case(personal_frame: pd.DataFrame) -> None:
    payload = detect_sensitive_fields(personal_frame).to_dict()
    assert payload["scannedColumns"] == 6
    assert payload["maskedColumns"] >= 3
    assert payload["notice"]
    assert isinstance(payload["fields"], list)
    assert {"column", "category", "policy", "confidence"} <= set(payload["fields"][0])


def test_masking_preserves_shape_but_hides_value() -> None:
    masked = mask_value("user@example.com", SensitiveCategory.EMAIL)
    assert masked != "user@example.com"
    assert "@" in masked
    card = mask_value("4539578763621486", SensitiveCategory.PAYMENT_CARD)
    assert card.endswith("1486")
    assert "4539" not in card


def test_mask_series_is_stable() -> None:
    s = pd.Series(["a@b.com", "a@b.com", "c@d.com"])
    out = mask_series(s, SensitiveCategory.EMAIL)
    assert out.iloc[0] == out.iloc[1]
    assert out.iloc[0] != out.iloc[2]


def test_mask_frame_never_mutates_the_source(personal_frame: pd.DataFrame) -> None:
    report = detect_sensitive_fields(personal_frame)
    before = personal_frame["email"].tolist()
    masked = mask_frame(personal_frame, report)
    assert personal_frame["email"].tolist() == before
    assert masked["email"].tolist() != before
    assert masked["revenue"].tolist() == personal_frame["revenue"].tolist()


def test_empty_frame_is_safe() -> None:
    report = detect_sensitive_fields(pd.DataFrame())
    assert report.fields == []
    assert report.masked_columns == 0
