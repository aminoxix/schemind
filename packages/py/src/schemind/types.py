"""schemind core type system.

These types are the backbone of the entire pipeline. They are intentionally
pure and structural — a ``ShapeNode`` never carries an actual response value,
only the *shape* of the data. This module is a faithful port of the TypeScript
core (``packages/core/src/types.ts``); do not rename or restructure without
updating every dependent module (extractor, diff engine, snapshot store,
reporters).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional, Union

# ---------------------------------------------------------------------------
#  Shape representation
# ---------------------------------------------------------------------------

#: The set of JSON-primitive types a :class:`ScalarNode` can represent.
#:
#: ``null`` is modelled as its own scalar type (rather than a nullability
#: flag) so the diff engine can reason about ``string`` → ``null`` transitions
#: uniformly. Nullable fields are expressed as a :class:`UnionNode` of the
#: concrete type plus ``ScalarNode(type='null')``.
ScalarType = Literal["string", "number", "boolean", "null"]


@dataclass(frozen=True, slots=True)
class ScalarNode:
    """A JSON primitive."""

    type: ScalarType
    kind: Literal["scalar"] = "scalar"


@dataclass(frozen=True, slots=True)
class ObjectNode:
    """An object with a fixed set of named fields, each its own shape."""

    fields: dict[str, "ShapeNode"]
    kind: Literal["object"] = "object"


@dataclass(frozen=True, slots=True)
class ArrayNode:
    """A homogeneous list. Heterogeneous arrays collapse their item shapes into a :class:`UnionNode`."""

    items: "ShapeNode"
    kind: Literal["array"] = "array"


@dataclass(frozen=True, slots=True)
class UnionNode:
    """A set of mutually-exclusive alternative shapes (e.g. nullable or mixed-type fields)."""

    types: tuple["ShapeNode", ...]
    kind: Literal["union"] = "union"


#: A structural fingerprint of a JSON value: types, nullability and nesting,
#: but **never** the underlying values.
ShapeNode = Union[ObjectNode, ArrayNode, ScalarNode, UnionNode]

#: Discriminant tag of a :data:`ShapeNode`.
ShapeKind = Literal["object", "array", "scalar", "union"]

# ---------------------------------------------------------------------------
#  Observation
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class AdapterMeta:
    """Metadata sourced from optional backend adapter headers.

    (``X-Schemind-Schema-Hash``, ``X-Schemind-Schema-Version``,
    ``X-Schemind-Source``.) Present only when a satellite adapter
    (schemind-go / -java / -py) is installed on the backend. The core works
    fully without it.
    """

    #: 8-char SHA-256 of the backend struct definition. Enables the hash fast-path.
    schema_hash: Optional[str] = None
    #: Backend's own monotonic version counter for this response type.
    schema_version: Optional[int] = None
    #: Source ``file:line`` of the response struct. Dev/staging only, never production.
    source: Optional[str] = None


@dataclass(frozen=True, slots=True)
class ObservedResponse:
    """A single observed API response, reduced to its shape."""

    #: Normalized endpoint, e.g. ``GET /api/users/:id``.
    endpoint: str
    #: HTTP status code of the observed response.
    status_code: int
    #: Extracted structure — never values.
    shape: ShapeNode
    #: ISO-8601 timestamp of when the response was observed.
    observed_at: str
    #: Enrichment from backend adapter headers, when present.
    meta: Optional[AdapterMeta] = None


# ---------------------------------------------------------------------------
#  Drift
# ---------------------------------------------------------------------------

#: Triage tiers, ordered from least to most urgent.
Severity = Literal["info", "warn", "breaking"]

#: The taxonomy of structural changes the diff engine can detect.
#: Severity is derived deterministically from this tag — see
#: :data:`schemind.severity.SEVERITY_BY_CHANGE_TYPE`.
ChangeType = Literal[
    "field_added",  # info
    "field_removed",  # breaking
    "type_changed",  # breaking
    "became_nullable",  # warn
    "became_required",  # warn
    "array_item_changed",  # breaking
]


@dataclass(frozen=True, slots=True)
class DriftChange:
    """A single field-level structural change between two shapes."""

    #: Dot-notation path to the changed node, e.g. ``user.role`` or ``items[].id``.
    path: str
    #: What kind of change occurred.
    type: ChangeType
    #: Severity derived from :attr:`type`.
    severity: Severity
    #: Shape before the change (``None`` for additions).
    from_: Optional[ShapeNode] = None
    #: Shape after the change (``None`` for removals).
    to: Optional[ShapeNode] = None


@dataclass(frozen=True, slots=True)
class DriftReport:
    """The full structural diff for a single endpoint observation."""

    #: Normalized endpoint the report concerns.
    endpoint: str
    #: Highest severity among :attr:`changes`. ``info`` when there are no changes.
    severity: Severity
    #: Every detected change, in stable document order.
    changes: tuple[DriftChange, ...] = field(default_factory=tuple)
