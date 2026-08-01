"""InsightOS analytics core.

A dependency-light (pandas + numpy) analytics framework that profiles a dataset,
scores its quality, infers the business domain, computes the right KPIs, explains
*why* they moved, and writes the executive narrative.

The engine is deliberately framework-agnostic: every module is importable on its
own and returns plain dataclasses that serialise to JSON, so the same code powers
the FastAPI service, the CLI, notebooks and the static demo build.
"""

from __future__ import annotations

__version__ = "1.0.0"
__all__ = ["__version__"]
