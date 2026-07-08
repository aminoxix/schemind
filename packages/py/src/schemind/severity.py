"""Severity rules — the canonical mapping from change type to triage tier.

⚠️  These rules are a product decision (mirrored from the TypeScript core).
Do not change them without team discussion.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Final

from .types import ChangeType, Severity

#: The canonical mapping from :data:`ChangeType` to :data:`Severity`.
SEVERITY_BY_CHANGE_TYPE: Final[dict[ChangeType, Severity]] = {
    "field_added": "info",
    "field_removed": "breaking",
    "type_changed": "breaking",
    "became_nullable": "warn",
    "became_required": "warn",
    "array_item_changed": "breaking",
}

#: Severity ordering, ascending in urgency.
SEVERITY_RANK: Final[dict[Severity, int]] = {
    "info": 0,
    "warn": 1,
    "breaking": 2,
}


def severity_of(type_: ChangeType) -> Severity:
    """Severity for a given change type."""
    return SEVERITY_BY_CHANGE_TYPE[type_]


def max_severity(a: Severity, b: Severity) -> Severity:
    """Return the more urgent of two severities."""
    return a if SEVERITY_RANK[a] >= SEVERITY_RANK[b] else b


def highest_severity(severities: Iterable[Severity]) -> Severity:
    """Reduce severities to the single highest.

    Returns ``'info'`` for an empty iterable — an observation with no changes
    is informational, not breaking.
    """
    acc: Severity = "info"
    for s in severities:
        acc = max_severity(acc, s)
    return acc
