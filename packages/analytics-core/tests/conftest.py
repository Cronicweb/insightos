"""Shared fixtures.

The demo generators are deterministic given a seed, so a session-scoped analysis
per dataset is both safe to share and the only affordable way to test the full
pipeline (the banking frame is ~200k rows).
"""
from __future__ import annotations

import pytest

from insightos.demo import generate
from insightos.pipeline import AnalysisOptions, analyse

_CACHE: dict[str, tuple] = {}


def _analysed(key: str):
    if key not in _CACHE:
        ds = generate(key)
        result = analyse(ds.frame, AnalysisOptions(dataset_name=ds.name))
        _CACHE[key] = (ds, result)
    return _CACHE[key]


@pytest.fixture(scope="session")
def banking():
    return _analysed("banking")


@pytest.fixture(scope="session")
def ecommerce():
    return _analysed("ecommerce")


@pytest.fixture(scope="session")
def marketing():
    return _analysed("marketing")


@pytest.fixture(scope="session", params=["banking", "ecommerce", "marketing"])
def any_dataset(request):
    return _analysed(request.param)
