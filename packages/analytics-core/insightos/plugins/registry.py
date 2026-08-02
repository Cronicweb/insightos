"""Plugin registry.

Import side effects are deliberate and contained: importing ``insightos.plugins``
registers every bundled pack and merges each pack's KPI definitions into the
shared catalogue. Nothing else in the engine imports a specific vertical, so the
dependency arrow only ever points from plugin to core.
"""

from __future__ import annotations

from ..kpi.registry import register_kpi
from ..types import Domain
from .base import DomainPlugin

__all__ = ["register_plugin", "get_plugin", "all_plugins", "plugin_domains", "PLUGINS"]

PLUGINS: dict[str, DomainPlugin] = {}


def register_plugin(plugin: DomainPlugin) -> DomainPlugin:
    """Register a plugin and publish its KPIs to the shared catalogue."""
    PLUGINS[plugin.key] = plugin
    for definition in plugin.kpis:
        register_kpi(definition)
    return plugin


def get_plugin(domain: Domain | str | None) -> DomainPlugin | None:
    """Resolve the plugin for a domain. Returns ``None`` for unmapped domains."""
    if domain is None:
        return None
    key = getattr(domain, "value", str(domain))
    if key in PLUGINS:
        return PLUGINS[key]
    return next((p for p in PLUGINS.values() if p.domain.value == key), None)


def all_plugins() -> list[DomainPlugin]:
    return sorted(PLUGINS.values(), key=lambda p: p.key)


def plugin_domains() -> list[str]:
    return sorted({p.domain.value for p in PLUGINS.values()})
