"""FastAPI surface for the InsightOS analytics engine.

Design notes
------------
* The service holds **no** analytical logic. It loads a frame, calls
  ``analyse()`` and serialises the result. Anything else would create a second
  place where business rules live, and the two would drift.
* Responses are identical in shape to the static JSON that ``insightos demo
  build`` writes, so the web client can be pointed at either without a single
  conditional in the rendering path.
* Analyses are cached by dataset key. The engine is deterministic given the same
  frame, so caching changes latency and nothing else.
"""
from __future__ import annotations

import io
import os
import time
from typing import Any

import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from insightos import __version__ as engine_version
from insightos.demo import GENERATORS, generate
from insightos.io import load_csv, load_json, load_parquet
from insightos.pipeline import AnalysisOptions, analyse
from insightos.types import to_jsonable

from . import __version__ as api_version
from .warehouse import router as warehouse_router

MAX_UPLOAD_MB = int(os.getenv("INSIGHTOS_MAX_UPLOAD_MB", "50"))
SAMPLE_ROWS = 200

app = FastAPI(
    title="InsightOS API",
    version=api_version,
    description=(
        "Deterministic analytics engine as a service: profiling, data quality, "
        "KPI discovery, anomaly detection, root-cause decomposition, forecasting, "
        "recommendations and executive reporting."
    ),
    docs_url="/docs",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in os.getenv("INSIGHTOS_CORS_ORIGINS", "*").split(",") if o],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(warehouse_router)

_analysis_cache: dict[str, dict[str, Any]] = {}
_frame_cache: dict[str, pd.DataFrame] = {}
_meta_cache: dict[str, Any] = {}


def _read_upload(raw: bytes, filename: str) -> pd.DataFrame:
    """Dispatch on extension. The reader stays deliberately dumb - every kind of
    inference is the profiler's job, so that uploaded and generated frames take
    exactly the same path through the engine."""
    suffix = filename.lower().rsplit(".", 1)[-1] if "." in filename else "csv"
    if suffix in {"parquet", "pq"}:
        return load_parquet(io.BytesIO(raw))
    if suffix in {"json", "ndjson"}:
        return load_json(io.BytesIO(raw))
    return load_csv(io.BytesIO(raw))


def _demo_frame(key: str) -> tuple[Any, pd.DataFrame]:
    if key not in GENERATORS:
        raise HTTPException(404, f"unknown dataset '{key}'. Try one of: {', '.join(GENERATORS)}")
    if key not in _frame_cache:
        ds = generate(key)
        _frame_cache[key] = ds.frame
        _meta_cache[key] = ds
    return _meta_cache[key], _frame_cache[key]


def _analysis(key: str) -> dict[str, Any]:
    if key in _analysis_cache:
        return _analysis_cache[key]
    ds, frame = _demo_frame(key)
    started = time.perf_counter()
    result = analyse(frame, AnalysisOptions(dataset_name=ds.name))
    payload = result.to_dict()
    payload.update({
        "key": key,
        "story": ds.story,
        "groundTruth": ds.ground_truth,
        "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
    })
    _analysis_cache[key] = payload
    return payload


# --------------------------------------------------------------------------- #
# Meta
# --------------------------------------------------------------------------- #

@app.get("/health", tags=["meta"], summary="Liveness probe")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "api_version": api_version,
        "engine_version": engine_version,
        "datasets_cached": sorted(_analysis_cache),
    }


@app.get("/", tags=["meta"], include_in_schema=False)
def root() -> dict[str, str]:
    return {"service": "InsightOS API", "docs": "/docs", "health": "/health"}


# --------------------------------------------------------------------------- #
# Demo datasets - these mirror the static JSON served by GitHub Pages.
# --------------------------------------------------------------------------- #

@app.get("/datasets", tags=["datasets"], summary="List available demo datasets")
def list_datasets() -> dict[str, Any]:
    items = []
    for key in GENERATORS:
        payload = _analysis(key)
        scorecard = payload.get("scorecard") or {}
        kpis = scorecard.get("kpis") or []
        primary = kpis[0] if kpis else {}
        items.append({
            "key": key,
            "name": payload.get("dataset"),
            "story": payload.get("story"),
            "rows": payload.get("rows"),
            "columns": payload.get("columns"),
            "domain": (payload.get("domain") or {}).get("domain"),
            "domainConfidence": (payload.get("domain") or {}).get("confidence"),
            "qualityScore": (payload.get("quality") or {}).get("score"),
            "qualityGrade": (payload.get("quality") or {}).get("grade"),
            "kpiCount": len(kpis),
            "anomalyCount": len(payload.get("anomalies") or []),
            "recommendationCount": len(payload.get("recommendations") or []),
            "primaryKpi": {
                "id": primary.get("id"),
                "label": primary.get("label"),
                "value": primary.get("value"),
                "unit": primary.get("unit"),
                "deltaPct": primary.get("delta_pct"),
                "isFavourable": primary.get("is_favourable"),
            } if primary else None,
        })
    return {"engineVersion": engine_version, "datasets": items}


@app.get("/datasets/{key}/analysis", tags=["datasets"], summary="Full analysis payload")
def dataset_analysis(key: str) -> JSONResponse:
    return JSONResponse(_analysis(key))


@app.get("/datasets/{key}/sample", tags=["datasets"], summary="Raw rows for the data grid")
def dataset_sample(key: str, limit: int = Query(SAMPLE_ROWS, ge=1, le=5000)) -> JSONResponse:
    _, frame = _demo_frame(key)
    sample = frame.head(limit).copy()
    for col in sample.columns:
        if pd.api.types.is_datetime64_any_dtype(sample[col]):
            sample[col] = sample[col].dt.strftime("%Y-%m-%d")
    return JSONResponse(to_jsonable(sample.to_dict(orient="records")))


# --------------------------------------------------------------------------- #
# Bring your own data
# --------------------------------------------------------------------------- #

@app.post("/analyse", tags=["analysis"], summary="Analyse an uploaded CSV/Parquet file")
async def analyse_upload(
    file: UploadFile = File(...),
    max_kpis: int = Query(8, ge=1, le=20),
    forecast_horizon: int = Query(3, ge=0, le=24),
) -> JSONResponse:
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"file exceeds the {MAX_UPLOAD_MB} MB limit")
    try:
        frame = _read_upload(raw, file.filename or "upload.csv")
    except Exception as exc:  # noqa: BLE001 - surfaced verbatim to the caller
        raise HTTPException(400, f"could not read '{file.filename}': {exc}") from exc

    if frame.empty:
        raise HTTPException(400, "the uploaded file contains no rows")

    result = analyse(
        frame,
        AnalysisOptions(
            dataset_name=file.filename or "uploaded dataset",
            max_kpis=max_kpis,
            forecast_horizon=forecast_horizon,
        ),
    )
    return JSONResponse(result.to_dict())
