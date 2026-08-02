"""Domain plugin packs."""
from __future__ import annotations

import pytest

from insightos.kpi import get_kpi
from insightos.plugins import (
    DomainPlugin,
    all_plugins,
    get_plugin,
    plugin_domains,
)
from insightos.types import Domain

BUNDLED = ("banking", "retail", "marketing", "sales", "healthcare", "hr", "manufacturing")


def test_every_vertical_ships_a_plugin() -> None:
    keys = {p.key for p in all_plugins()}
    assert set(BUNDLED) <= keys


@pytest.mark.parametrize("key", BUNDLED)
def test_plugin_contract_is_complete(key: str) -> None:
    plugin = get_plugin(key)
    assert isinstance(plugin, DomainPlugin)
    assert plugin.label
    assert plugin.kpis, f"{key} defines no KPIs"
    assert plugin.priority_dimensions, f"{key} declares no priority dimensions"
    assert plugin.rules, f"{key} declares no recommendation rules"
    assert plugin.root_cause_hints, f"{key} declares no root cause hints"
    assert plugin.forecast.horizon > 0


@pytest.mark.parametrize("key", BUNDLED)
def test_plugin_kpis_are_published_to_the_registry(key: str) -> None:
    for kpi in get_plugin(key).kpis:
        assert get_kpi(kpi.id) is not None


def test_lookup_accepts_domain_or_string_or_none() -> None:
    assert get_plugin(Domain.BANKING).key == "banking"
    assert get_plugin("banking").key == "banking"
    assert get_plugin(None) is None
    assert get_plugin("not-a-domain") is None


def test_domains_are_unique_so_lookup_is_unambiguous() -> None:
    domains = plugin_domains()
    assert len(domains) == len(set(domains))


def test_root_cause_hints_reference_real_dimensions() -> None:
    banking = get_plugin("banking")
    hint = banking.hint_for("revenue")
    assert hint is not None
    assert hint.decompose_by
    assert set(hint.decompose_by) <= set(banking.priority_dimensions)


def test_playbook_routes_ownership_and_approval() -> None:
    banking = get_plugin("banking")
    owner = banking.playbook.owner_for("risk")
    assert owner and owner != "Business Owner"
    assert banking.playbook.requires_approval("risk", None) is True
    assert banking.playbook.requires_approval("growth", 10.0) is False
    assert banking.playbook.requires_approval("growth", 10_000_000.0) is True


def test_plugin_serialises() -> None:
    payload = get_plugin("retail").to_dict()
    for key in ("key", "label", "domain", "kpis", "priorityDimensions", "rules", "forecast"):
        assert key in payload
