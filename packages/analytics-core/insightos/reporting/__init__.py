"""Executive reporting: deterministic business narrative assembled from analysis output."""

from .executive import (
    ExecutiveReport,
    ReportSection,
    build_executive_report,
    render_markdown,
)

__all__ = [
    "ExecutiveReport",
    "ReportSection",
    "build_executive_report",
    "render_markdown",
]
