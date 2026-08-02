"""Domain plugin packs.

Importing this package registers every bundled vertical. The core engine depends
on :mod:`insightos.plugins.base` and :mod:`insightos.plugins.registry` only - it
never imports a specific pack - so the dependency arrow points one way and a
broken plugin can never take the engine down with it.

Adding a vertical is one file plus one line in ``_BUNDLED``.
"""

from __future__ import annotations

from .aggregators import (
    mean_of,
    nunique_of,
    per_entity,
    rate_of,
    ratio_of,
    sum_of,
)
from .banking import PLUGIN as BANKING
from .base import (
    DomainPlugin,
    ForecastSettings,
    PluginRule,
    RecommendationPlaybook,
    RootCauseHint,
)
from .healthcare import PLUGIN as HEALTHCARE
from .hr import PLUGIN as HR
from .manufacturing import PLUGIN as MANUFACTURING
from .marketing import PLUGIN as MARKETING
from .registry import PLUGINS, all_plugins, get_plugin, plugin_domains, register_plugin
from .retail import PLUGIN as RETAIL
from .sales import PLUGIN as SALES

_BUNDLED = (BANKING, RETAIL, MARKETING, SALES, HEALTHCARE, HR, MANUFACTURING)

for _plugin in _BUNDLED:
    register_plugin(_plugin)

__all__ = [
    "DomainPlugin", "ForecastSettings", "PluginRule", "RecommendationPlaybook",
    "RootCauseHint", "register_plugin", "get_plugin", "all_plugins",
    "plugin_domains", "PLUGINS",
    "sum_of", "mean_of", "nunique_of", "rate_of", "ratio_of", "per_entity",
    "BANKING", "RETAIL", "MARKETING", "SALES", "HEALTHCARE", "HR", "MANUFACTURING",
]
