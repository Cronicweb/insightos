"""Dataset loading with type preservation.

The profiler is only as good as the frame it is handed. Pandas' default CSV
inference is aggressive in ways that quietly destroy analysis: it will turn a
zero-padded account number into an integer, coerce mixed columns to object, and
silently accept ``"N/A"`` as a category rather than a missing value.

These loaders read conservatively - everything as string - and then let
:mod:`insightos.profiling` decide what each column actually is, using the same
logic that will later be reported to the user. Inference happens once, in one
place, and is fully explainable.
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import IO, Any

import pandas as pd

__all__ = ["load_dataframe", "load_csv", "load_parquet", "load_json", "NULL_TOKENS"]

#: Strings that mean "missing" in real-world exports but not to pandas by default.
NULL_TOKENS = [
    "", " ", "-", "--", "NA", "N/A", "n/a", "na", "NaN", "nan", "NULL", "null",
    "None", "none", "nil", "NIL", "?", "#N/A", "#NA", "#VALUE!", "#REF!", "#DIV/0!",
    "(blank)", "(null)", "unknown", "Unknown", "UNKNOWN", "undefined",
]


def load_csv(source: str | Path | IO[bytes] | bytes, **kwargs: Any) -> pd.DataFrame:
    """Read a delimited file without letting pandas guess types."""
    if isinstance(source, bytes):
        source = io.BytesIO(source)
    options: dict[str, Any] = {
        "dtype": "string",
        "keep_default_na": False,
        "na_values": NULL_TOKENS,
        "skipinitialspace": True,
        "sep": None,
        "engine": "python",
    }
    options.update(kwargs)
    df = pd.read_csv(source, **options)
    df.columns = [str(c).strip() for c in df.columns]
    return df


def load_parquet(source: str | Path | IO[bytes] | bytes, **kwargs: Any) -> pd.DataFrame:
    if isinstance(source, bytes):
        source = io.BytesIO(source)
    return pd.read_parquet(source, **kwargs)


def load_json(source: str | Path | IO[bytes] | bytes, **kwargs: Any) -> pd.DataFrame:
    if isinstance(source, bytes):
        source = io.BytesIO(source)
    kwargs.setdefault("orient", "records")
    return pd.read_json(source, **kwargs)


_READERS = {
    ".csv": load_csv, ".tsv": load_csv, ".txt": load_csv,
    ".parquet": load_parquet, ".pq": load_parquet,
    ".json": load_json, ".ndjson": load_json,
}


def load_dataframe(path: str | Path, **kwargs: Any) -> pd.DataFrame:
    """Load any supported file, dispatching on extension."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"dataset not found: {p}")
    reader = _READERS.get(p.suffix.lower())
    if reader is None:
        raise ValueError(
            f"unsupported file type '{p.suffix}'. Supported: "
            f"{', '.join(sorted(_READERS))}"
        )
    return reader(p, **kwargs)
