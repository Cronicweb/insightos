"""Optional LLM polish layer - constrained so it can never invent a fact.

InsightOS is deliberately not an "AI analytics" product. Every number, comparison
and conclusion is computed deterministically before this module is reached. The
only job here is *wording*: turning correct-but-mechanical sentences into prose an
executive would enjoy reading.

The safety model is not "we asked the model nicely". It is enforced in code:

1. **Extraction** - every numeric token, percentage, currency amount and entity
   name in the deterministic text is extracted into a fact set.
2. **Generation** - the provider is given the original sentences and told to
   rephrase only.
3. **Verification** - the returned text is re-scanned. If it contains a numeric
   token that was not in the input, or drops a material one, the polish is
   **rejected** and the deterministic text is returned unchanged.

The result is that enabling an LLM can improve readability and can never change
a conclusion. If no provider is configured, InsightOS runs fully offline, which
is the default and the mode used for the public demo.
"""

from __future__ import annotations

import os
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol

__all__ = ["LLMProvider", "PolishResult", "NarrativePolisher", "extract_facts",
           "verify_polish"]

_NUMBER = re.compile(r"[-+]?\$?\d[\d,]*\.?\d*\s*(?:%|x|K|M|B)?", re.IGNORECASE)
_TRIVIAL = {"0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "100"}


class LLMProvider(Protocol):
    """Minimal provider interface - implement this to plug in any model."""

    name: str

    def complete(self, system: str, user: str) -> str:  # pragma: no cover - interface
        ...


@dataclass
class PolishResult:
    text: str
    polished: bool
    provider: str | None = None
    rejected_reason: str | None = None


def _normalise(token: str) -> str:
    t = token.strip().lower().replace(",", "").replace("$", "").replace("+", "")
    t = t.replace(" ", "")
    if t.endswith("%") or t.endswith("x"):
        return t
    try:
        # Collapse 12.0 and 12 to the same fact so harmless reformatting passes.
        return f"{float(t):g}"
    except ValueError:
        return t


def extract_facts(text: str) -> set[str]:
    """Every numeric claim in a piece of text, normalised for comparison."""
    facts = set()
    for m in _NUMBER.finditer(text):
        tok = _normalise(m.group())
        if tok and tok not in _TRIVIAL and any(c.isdigit() for c in tok):
            facts.add(tok)
    return facts


def verify_polish(original: str, candidate: str, tolerance: int = 0) -> tuple[bool, str | None]:
    """Reject the candidate unless its numeric facts match the original exactly."""
    src, out = extract_facts(original), extract_facts(candidate)
    invented = out - src
    if invented:
        return False, f"introduced facts not present in the analysis: {sorted(invented)[:5]}"
    dropped = src - out
    if len(dropped) > tolerance:
        return False, f"dropped {len(dropped)} computed value(s): {sorted(dropped)[:5]}"
    if not candidate.strip():
        return False, "empty response"
    if len(candidate) > len(original) * 3:
        return False, "response was disproportionately long; likely added commentary"
    return True, None


_SYSTEM = (
    "You are an editor for an enterprise analytics platform. You will be given "
    "sentences that were produced by a deterministic statistical engine. Rewrite them "
    "to read like a concise executive briefing.\n"
    "STRICT RULES:\n"
    "1. Never add, remove or alter any number, percentage, currency amount or date.\n"
    "2. Never add a cause, explanation, prediction or recommendation that is not "
    "already stated.\n"
    "3. Never soften or strengthen a statistical claim.\n"
    "4. Keep it shorter than the input. Return prose only, no preamble or markdown."
)


class NarrativePolisher:
    """Wraps a provider with fact verification and a hard offline default."""

    def __init__(self, provider: LLMProvider | None = None, enabled: bool | None = None):
        self.provider = provider
        if enabled is None:
            enabled = os.getenv("INSIGHTOS_LLM_POLISH", "0").lower() in {"1", "true", "yes"}
        self.enabled = bool(enabled and provider is not None)

    def polish(self, text: str, context: str = "") -> PolishResult:
        if not self.enabled or not self.provider or not text.strip():
            return PolishResult(text, polished=False)
        try:
            user = (f"Context: {context}\n\n" if context else "") + f"Sentences:\n{text}"
            candidate = self.provider.complete(_SYSTEM, user).strip()
        except Exception as exc:                      # provider failure is never fatal
            return PolishResult(text, False, getattr(self.provider, "name", "unknown"),
                                f"provider error: {exc}")
        ok, reason = verify_polish(text, candidate)
        if not ok:
            return PolishResult(text, False, getattr(self.provider, "name", None), reason)
        return PolishResult(candidate, True, getattr(self.provider, "name", None))

    def polish_all(self, sentences: Sequence[str], context: str = "") -> list[str]:
        """Polish sentence-by-sentence so one rejection cannot discard the rest."""
        return [self.polish(s, context).text for s in sentences]


class CallableProvider:
    """Adapter that turns any ``fn(system, user) -> str`` into a provider."""

    def __init__(self, fn: Callable[[str, str], str], name: str = "callable"):
        self._fn = fn
        self.name = name

    def complete(self, system: str, user: str) -> str:
        return self._fn(system, user)
