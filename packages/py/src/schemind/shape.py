"""Shape constructors, canonical stringification, union normalization and
nullability helpers. Port of ``packages/core/src/shape.ts``.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from typing import Final, Optional

from .types import ArrayNode, ObjectNode, ScalarNode, ScalarType, ShapeNode, UnionNode

# ---------------------------------------------------------------------------
#  Constructors
# ---------------------------------------------------------------------------


def scalar(type_: ScalarType) -> ScalarNode:
    """Build a :class:`ScalarNode`."""
    return ScalarNode(type=type_)


def object_(fields: Mapping[str, ShapeNode]) -> ObjectNode:
    """Build an :class:`ObjectNode`. (Trailing underscore: ``object`` is a builtin.)"""
    return ObjectNode(fields=dict(fields))


def array(items: ShapeNode) -> ArrayNode:
    """Build an :class:`ArrayNode`."""
    return ArrayNode(items=items)


def union_node(types: Iterable[ShapeNode]) -> UnionNode:
    """Build a :class:`UnionNode` directly (no normalization). Prefer :func:`union`."""
    return UnionNode(types=tuple(types))


#: The "unknown" / bottom shape: a union of zero alternatives.
#:
#: Used to represent a value about which we have no structural information —
#: most notably the item type of an *empty* array. Treated as a wildcard by
#: the diff engine (an unknown on either side never produces a change) and
#: absorbed by :func:`union` (``union([UNKNOWN, T]) == T``). Stays within the
#: documented four-kind ShapeNode system — it is not a new kind.
UNKNOWN: Final[UnionNode] = UnionNode(types=())


def is_unknown(n: ShapeNode) -> bool:
    """Is this the :data:`UNKNOWN` bottom shape (an empty union)?"""
    return n.kind == "union" and len(n.types) == 0


# ---------------------------------------------------------------------------
#  Type guards
# ---------------------------------------------------------------------------


def is_object(n: ShapeNode) -> bool:
    return n.kind == "object"


def is_array(n: ShapeNode) -> bool:
    return n.kind == "array"


def is_scalar(n: ShapeNode) -> bool:
    return n.kind == "scalar"


def is_union(n: ShapeNode) -> bool:
    return n.kind == "union"


def is_null(n: ShapeNode) -> bool:
    """Is this node exactly the ``null`` scalar?"""
    return n.kind == "scalar" and n.type == "null"


# ---------------------------------------------------------------------------
#  Canonical stringification
# ---------------------------------------------------------------------------


def stringify_shape(node: ShapeNode) -> str:
    """Produce a deterministic, canonical string for a shape.

    Object field order and union member order are normalized so that two
    structurally-equal shapes always stringify identically. Used for equality,
    deduplication and hashing.
    """
    if isinstance(node, ScalarNode):
        return f"s:{node.type}"
    if isinstance(node, ArrayNode):
        return f"a:[{stringify_shape(node.items)}]"
    if isinstance(node, ObjectNode):
        entries = (
            f"{json.dumps(key, ensure_ascii=False)}:{stringify_shape(node.fields[key])}"
            for key in sorted(node.fields)
        )
        return "o:{" + ",".join(entries) + "}"
    # UnionNode
    members = sorted(stringify_shape(t) for t in node.types)
    return "u:(" + "|".join(members) + ")"


def shapes_equal(a: ShapeNode, b: ShapeNode) -> bool:
    """Structural equality, independent of field/union ordering."""
    return stringify_shape(a) == stringify_shape(b)


# ---------------------------------------------------------------------------
#  Union normalization
# ---------------------------------------------------------------------------


def union(members: Iterable[ShapeNode]) -> ShapeNode:
    """Build a normalized union from a list of member shapes.

    - flattens nested unions,
    - deduplicates structurally-equal members,
    - returns the lone member directly when only one survives (no 1-ary unions),
    - sorts members canonically for stable output.

    Nested unions are flattened, so :data:`UNKNOWN` members (empty unions) are
    naturally absorbed: ``union([UNKNOWN, T]) == T``. With no surviving members
    it returns :data:`UNKNOWN` (the bottom shape) rather than raising.
    """
    flat: list[ShapeNode] = []
    for m in members:
        if isinstance(m, UnionNode):
            flat.extend(m.types)
        else:
            flat.append(m)

    seen: dict[str, ShapeNode] = {}
    for m in flat:
        key = stringify_shape(m)
        if key not in seen:
            seen[key] = m

    deduped = sorted(seen.values(), key=stringify_shape)

    if len(deduped) == 0:
        return UNKNOWN
    if len(deduped) == 1:
        return deduped[0]
    return UnionNode(types=tuple(deduped))


# ---------------------------------------------------------------------------
#  Nullability
# ---------------------------------------------------------------------------


def is_nullable(node: ShapeNode) -> bool:
    """Does this shape admit ``null``? True for the ``null`` scalar or any union containing it."""
    if is_null(node):
        return True
    if isinstance(node, UnionNode):
        return any(is_null(t) for t in node.types)
    return False


def without_null(node: ShapeNode) -> Optional[ShapeNode]:
    """Strip ``null`` out of a shape, returning the "non-null core".

    - ``null`` scalar → ``None`` (no core remains)
    - ``union(T | null)`` → ``T`` (or the reduced union)
    - anything else → unchanged
    """
    if is_null(node):
        return None
    if isinstance(node, UnionNode):
        rest = [t for t in node.types if not is_null(t)]
        if len(rest) == 0:
            return None
        return union(rest)
    return node


# ---------------------------------------------------------------------------
#  JSON serialization (snapshot interop with the TypeScript core)
# ---------------------------------------------------------------------------


def shape_to_json(node: ShapeNode) -> dict:
    """Serialize a shape to the same plain-JSON structure the TS core stores."""
    if isinstance(node, ScalarNode):
        return {"kind": "scalar", "type": node.type}
    if isinstance(node, ArrayNode):
        return {"kind": "array", "items": shape_to_json(node.items)}
    if isinstance(node, ObjectNode):
        return {
            "kind": "object",
            "fields": {k: shape_to_json(v) for k, v in node.fields.items()},
        }
    return {"kind": "union", "types": [shape_to_json(t) for t in node.types]}


def shape_from_json(data: Mapping) -> ShapeNode:
    """Parse a shape from its plain-JSON structure (inverse of :func:`shape_to_json`)."""
    kind = data.get("kind")
    if kind == "scalar":
        return ScalarNode(type=data["type"])
    if kind == "array":
        return ArrayNode(items=shape_from_json(data["items"]))
    if kind == "object":
        return ObjectNode(fields={k: shape_from_json(v) for k, v in data["fields"].items()})
    if kind == "union":
        return UnionNode(types=tuple(shape_from_json(t) for t in data["types"]))
    raise ValueError(f'schemind: invalid shape kind "{kind}"')
