"""schemind-py — your API's shape has a mind of its own. schemind watches it.

Python port of the ``@aminoxix/schemind`` core: learns what an API actually
returns at runtime and flags when a response shape silently mutates, classified
by severity (``info`` / ``warn`` / ``breaking``).
"""

from .diff import diff_report, diff_shapes
from .extractor import extract_shape
from .normalize import (
    DEFAULT_PARAM_PATTERNS,
    ParamPattern,
    normalize_endpoint,
    normalize_path,
    origin_of,
    path_of,
)
from .severity import (
    SEVERITY_BY_CHANGE_TYPE,
    SEVERITY_RANK,
    highest_severity,
    max_severity,
    severity_of,
)
from .shape import (
    UNKNOWN,
    array,
    is_array,
    is_null,
    is_nullable,
    is_object,
    is_scalar,
    is_union,
    is_unknown,
    object_,
    scalar,
    shape_from_json,
    shape_to_json,
    shapes_equal,
    stringify_shape,
    union,
    union_node,
    without_null,
)
from .types import (
    AdapterMeta,
    ArrayNode,
    ChangeType,
    DriftChange,
    DriftReport,
    ObjectNode,
    ObservedResponse,
    ScalarNode,
    ScalarType,
    Severity,
    ShapeKind,
    ShapeNode,
    UnionNode,
)

__version__ = "0.1.0"

__all__ = [
    # types
    "AdapterMeta",
    "ArrayNode",
    "ChangeType",
    "DriftChange",
    "DriftReport",
    "ObjectNode",
    "ObservedResponse",
    "ScalarNode",
    "ScalarType",
    "Severity",
    "ShapeKind",
    "ShapeNode",
    "UnionNode",
    # severity
    "SEVERITY_BY_CHANGE_TYPE",
    "SEVERITY_RANK",
    "highest_severity",
    "max_severity",
    "severity_of",
    # shape
    "UNKNOWN",
    "array",
    "is_array",
    "is_null",
    "is_nullable",
    "is_object",
    "is_scalar",
    "is_union",
    "is_unknown",
    "object_",
    "scalar",
    "shape_from_json",
    "shape_to_json",
    "shapes_equal",
    "stringify_shape",
    "union",
    "union_node",
    "without_null",
    # extractor
    "extract_shape",
    # diff
    "diff_report",
    "diff_shapes",
    # normalize
    "DEFAULT_PARAM_PATTERNS",
    "ParamPattern",
    "normalize_endpoint",
    "normalize_path",
    "origin_of",
    "path_of",
]
