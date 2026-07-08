"""JSON value → :data:`ShapeNode` extraction. Port of ``packages/core/src/extractor.ts``."""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass

from .shape import UNKNOWN, array, object_, scalar, union
from .types import ShapeNode

DEFAULT_SAMPLE_SIZE = 3
DEFAULT_MAX_DEPTH = 32


@dataclass(frozen=True, slots=True)
class _Resolved:
    sample_size: int
    max_depth: int
    ignore: frozenset[str]


def extract_shape(
    value: object,
    *,
    array_sample_size: int | None = None,
    max_depth: int | None = None,
    ignore: Collection[str] = (),
) -> ShapeNode:
    """Convert an arbitrary JSON value into a :data:`ShapeNode` — a structural
    fingerprint capturing types, nullability and nesting but **never** values.

    Mapping:

    - ``None`` → ``scalar('null')``
    - ``str`` / ``int`` / ``float`` / ``bool`` → corresponding scalar
      (``bool`` checked before number: it subclasses ``int`` in Python)
    - list/tuple → ``array(items)`` where ``items`` is the union of the first
      ``array_sample_size`` element shapes; an empty array yields
      ``array(UNKNOWN)``
    - dict → ``object_(fields)`` preserving key insertion order, minus
      ``ignore``\\ d keys
    - anything past ``max_depth`` → :data:`UNKNOWN`

    Heterogeneous arrays are handled at O(1) cost regardless of array length
    because only the leading sample is unioned. Values that are not
    JSON-representable (functions, sets, bytes, …) raise ``TypeError``.
    """
    resolved = _Resolved(
        sample_size=max(1, array_sample_size if array_sample_size is not None else DEFAULT_SAMPLE_SIZE),
        max_depth=max(1, max_depth if max_depth is not None else DEFAULT_MAX_DEPTH),
        ignore=frozenset(ignore),
    )
    return _extract(value, resolved, 0)


def _extract(value: object, opts: _Resolved, depth: int) -> ShapeNode:
    if value is None:
        return scalar("null")

    # Depth guard: stop descending into containers past the limit.
    if depth >= opts.max_depth and isinstance(value, (list, tuple, dict)):
        return UNKNOWN

    # bool before number: bool is a subclass of int.
    if isinstance(value, bool):
        return scalar("boolean")
    if isinstance(value, str):
        return scalar("string")
    if isinstance(value, (int, float)):
        return scalar("number")

    if isinstance(value, (list, tuple)):
        if len(value) == 0:
            return array(UNKNOWN)
        sampled = [_extract(item, opts, depth + 1) for item in value[: opts.sample_size]]
        return array(union(sampled))

    if isinstance(value, dict):
        fields: dict[str, ShapeNode] = {}
        for key, child in value.items():
            key = str(key)
            if key in opts.ignore:
                continue
            fields[key] = _extract(child, opts, depth + 1)
        return object_(fields)

    raise TypeError(
        f'schemind: cannot extract a shape from a value of type "{type(value).__name__}"'
    )
