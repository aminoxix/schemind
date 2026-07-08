"""The diff engine. Port of ``packages/core/src/diff.ts``.

Compares a previously-stored shape against a newly-observed shape and produces
field-level :class:`DriftChange`\\ s in stable document order.

Classification rules (a locked product decision):

- a field present in ``from`` but not ``to`` → ``field_removed`` (breaking)
- a field present in ``to`` but not ``from`` → ``field_added`` (info)
- a scalar/container whose underlying type changed → ``type_changed`` (breaking)
- a value that gained ``null`` → ``became_nullable`` (warn)
- a value that lost ``null`` → ``became_required`` (warn)
- an array whose element shape changed wholesale → ``array_item_changed`` (breaking)

Object fields and array items are diffed recursively, so deeply-nested changes
surface with a precise dot/bracket path (e.g. ``user.roles[].name``).
"""

from __future__ import annotations

from typing import Optional

from .severity import highest_severity, severity_of
from .shape import is_null, is_unknown, shapes_equal, without_null
from .types import ArrayNode, ChangeType, DriftChange, DriftReport, ObjectNode, ShapeNode, UnionNode


def diff_shapes(from_: ShapeNode, to: ShapeNode) -> list[DriftChange]:
    """Diff two shapes into a list of changes, in stable document order."""
    changes: list[DriftChange] = []
    _diff_node(from_, to, "", changes)
    return changes


def diff_report(endpoint: str, from_: ShapeNode, to: ShapeNode) -> DriftReport:
    """Build a full :class:`DriftReport` for one endpoint from two shapes."""
    changes = diff_shapes(from_, to)
    return DriftReport(
        endpoint=endpoint,
        severity=highest_severity(c.severity for c in changes),
        changes=tuple(changes),
    )


# ---------------------------------------------------------------------------
#  Internals
# ---------------------------------------------------------------------------


def _push(
    changes: list[DriftChange],
    type_: ChangeType,
    path: str,
    from_: Optional[ShapeNode],
    to: Optional[ShapeNode],
) -> None:
    changes.append(
        DriftChange(path=path, type=type_, severity=severity_of(type_), from_=from_, to=to)
    )


def _diff_node(from_: ShapeNode, to: ShapeNode, path: str, changes: list[DriftChange]) -> None:
    # Identical shapes — nothing to report.
    if shapes_equal(from_, to):
        return

    from_core = without_null(from_)  # None == "no non-null core"
    to_core = without_null(to)

    # Pure-null transitions: one side carries no non-null core.
    if from_core is None and to_core is None:
        return  # both null-only, already equal
    if from_core is None:
        # was null-only, now carries a concrete required type
        _push(changes, "became_required", path, from_, to)
        return
    if to_core is None:
        # concrete type is now (only) null
        _push(changes, "became_nullable", path, from_, to)
        return

    # Both sides have a non-null core.
    if shapes_equal(from_core, to_core):
        # Cores match — the only difference is nullability.
        from_null = isinstance(from_, UnionNode) and any(is_null(t) for t in from_.types)
        to_null = isinstance(to, UnionNode) and any(is_null(t) for t in to.types)
        if not from_null and to_null:
            _push(changes, "became_nullable", path, from_, to)
        elif from_null and not to_null:
            _push(changes, "became_required", path, from_, to)
        return

    # Cores differ structurally — recurse where both sides are the same
    # container, otherwise it is a wholesale type change.
    if isinstance(from_core, ObjectNode) and isinstance(to_core, ObjectNode):
        _diff_object(from_core.fields, to_core.fields, path, changes)
        return
    if isinstance(from_core, ArrayNode) and isinstance(to_core, ArrayNode):
        _diff_array(from_core.items, to_core.items, path, changes)
        return

    _push(changes, "type_changed", path, from_, to)


def _diff_object(
    from_: dict[str, ShapeNode],
    to: dict[str, ShapeNode],
    path: str,
    changes: list[DriftChange],
) -> None:
    # Existing keys first (removals + recursive changes), preserving `from` order.
    for key, from_child in from_.items():
        child_path = _join(path, key)
        if key not in to:
            _push(changes, "field_removed", child_path, from_child, None)
            continue
        _diff_node(from_child, to[key], child_path, changes)
    # Then additions, preserving `to` order.
    for key, to_child in to.items():
        if key in from_:
            continue
        _push(changes, "field_added", _join(path, key), None, to_child)


def _diff_array(
    from_items: ShapeNode,
    to_items: ShapeNode,
    path: str,
    changes: list[DriftChange],
) -> None:
    item_path = f"{path}[]"

    # An empty array carries no item information — treat unknown as a wildcard
    # so empty→populated (and vice-versa) never produces spurious drift.
    if is_unknown(from_items) or is_unknown(to_items):
        return
    if shapes_equal(from_items, to_items):
        return

    # Recurse for same-container items to surface granular, well-pathed changes…
    if isinstance(from_items, ObjectNode) and isinstance(to_items, ObjectNode):
        _diff_object(from_items.fields, to_items.fields, item_path, changes)
        return
    if isinstance(from_items, ArrayNode) and isinstance(to_items, ArrayNode):
        _diff_array(from_items.items, to_items.items, item_path, changes)
        return

    # …otherwise the element type changed wholesale.
    _push(changes, "array_item_changed", item_path, from_items, to_items)


def _join(path: str, key: str) -> str:
    return f"{path}.{key}" if path else key
