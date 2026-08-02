"""The domain plugin contract.

The engine knows how to *do* analytics. It does not know what a "chargeback" is,
who owns retention, or that a hospital's readmission rate is bad when it rises.
That knowledge is domain knowledge, and domain knowledge belongs in a plugin.

A :class:`DomainPlugin` is pure declarative data - no engine internals, no
DataFrame access beyond the aggregators a KPI already owns. It contributes:

``kpis``               extra :class:`KPIDefinition` objects registered on import
``priority_dimensions`` the dimensions this business actually manages by
``root_cause_hints``   how a metric decomposes, and what is *not* a cause
``rules``              recommendation rules expressed as thresholds, not code paths
``forecast``           horizon and seasonality that match the planning cycle
``playbook``           who owns an action and when approval is required
``glossary``           the words an executive in this domain expects to read

Because a plugin is data, adding a new vertical is a pull request that touches
exactly one file and cannot destabilise the engine.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from ..kpi.registry import KPIDefinition
from ..types import Domain, to_jsonable

__all__ = [
    "ForecastSettings",
    "RecommendationPlaybook",
    "RootCauseHint",
    "PluginRule",
    "DomainPlugin",
]


@dataclass(frozen=True)
class ForecastSettings:
    """Planning cycle, expressed the way the business plans."""

    horizon: int = 3
    seasonal_period: int | None = None
    min_history: int = 8
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


@dataclass(frozen=True)
class RecommendationPlaybook:
    """Who acts, and when someone senior has to say yes first."""

    owners: dict[str, str] = field(default_factory=dict)
    approval_authority: str = "Analytics Lead"
    approval_impact_threshold: float = 250_000.0
    approval_categories: tuple[str, ...] = ("risk",)
    review_cadence: str = "monthly business review"

    def owner_for(self, category: str, fallback: str = "Business Owner") -> str:
        return self.owners.get(category, fallback)

    def requires_approval(self, category: str, impact: float | None) -> bool:
        if category in self.approval_categories:
            return True
        return bool(impact is not None and abs(impact) >= self.approval_impact_threshold)

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


@dataclass(frozen=True)
class RootCauseHint:
    """A declared decomposition path, plus the factors this domain rules out."""

    metric: str
    decompose_by: tuple[str, ...] = ()
    known_confounders: tuple[str, ...] = ()
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


@dataclass(frozen=True)
class PluginRule:
    """A declarative recommendation rule.

    ``metric`` is a KPI id, ``direction`` is ``down`` / ``up`` / ``any`` and
    ``threshold_pct`` is the period-over-period move that arms the rule. The
    engine evaluates it; the plugin only states the business policy.
    """

    id: str
    metric: str
    direction: str
    threshold_pct: float
    title: str
    investigation: str
    category: str = "growth"
    urgency: float = 0.8
    effort: str = "medium"
    horizon: str = "this quarter"
    success_measure: str = ""
    rationale: str = ""

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


@dataclass(frozen=True)
class DomainPlugin:
    key: str
    domain: Domain
    label: str
    description: str
    kpis: tuple[KPIDefinition, ...] = ()
    priority_dimensions: tuple[str, ...] = ()
    root_cause_hints: tuple[RootCauseHint, ...] = ()
    rules: tuple[PluginRule, ...] = ()
    forecast: ForecastSettings = field(default_factory=ForecastSettings)
    playbook: RecommendationPlaybook = field(default_factory=RecommendationPlaybook)
    glossary: dict[str, str] = field(default_factory=dict)

    def hint_for(self, metric: str) -> RootCauseHint | None:
        return next((h for h in self.root_cause_hints if h.metric == metric), None)

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "domain": self.domain.value,
            "label": self.label,
            "description": self.description,
            "kpis": [k.id for k in self.kpis],
            "priorityDimensions": list(self.priority_dimensions),
            "rootCauseHints": [h.to_dict() for h in self.root_cause_hints],
            "rules": [r.to_dict() for r in self.rules],
            "forecast": self.forecast.to_dict(),
            "playbook": self.playbook.to_dict(),
            "glossary": dict(self.glossary),
        }
