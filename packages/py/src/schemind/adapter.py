"""schemind backend adapter for Python (FastAPI / Starlette / Django / Flask).

The Python twin of ``adapters/schemind-go``: computes a deterministic schema
hash of a response type (at startup, via type hints — never per-request) and
injects the schemind header protocol so the core can take the hash fast-path:
skip shape extraction entirely when the hash is unchanged.

Supported response types: dataclasses, ``TypedDict``\\ s, ``NamedTuple``\\ s,
plain annotated classes, and Pydantic models (duck-typed via ``model_fields`` —
pydantic itself is never imported). Stdlib only.

Usage (FastAPI / any ASGI app)::

    from schemind.adapter import asgi_middleware
    app = asgi_middleware(app, version=1, response_type=BookResponse)

Usage (Django / Flask / any WSGI app)::

    from schemind.adapter import wsgi_middleware
    application = wsgi_middleware(application, version=1, response_type=BookResponse)

⚠️  The hash reflects the *static* type definition. If your handler mutates the
serialized shape at runtime (like the drift-toggling example backends do), an
unchanged hash would make the core skip extraction and miss the drift — only
adopt the adapter when the type is the single source of truth for the shape.
"""

from __future__ import annotations

import dataclasses
import hashlib
import types
from collections.abc import Awaitable, Callable, Iterable, MutableMapping
from typing import Any, ClassVar, Optional, Union, get_args, get_origin, get_type_hints

#: Header names of the schemind adapter protocol.
HEADER_HASH = "X-Schemind-Schema-Hash"
HEADER_VERSION = "X-Schemind-Schema-Version"

# ---------------------------------------------------------------------------
#  Hash
# ---------------------------------------------------------------------------


def schema_hash(response_type: type) -> str:
    """The 8-char schema hash for a response type.

    A SHA-256 (truncated) of a canonical string of the type's field names +
    types. Stable across runs and field order; changes whenever a field is
    added, removed, renamed, or retyped.
    """
    digest = hashlib.sha256(_canonical(response_type, set()).encode()).hexdigest()
    return digest[:8]


def _fields_of(t: type) -> Optional[dict[str, Any]]:
    """Field name → annotation for anything class-like, or ``None`` for non-models."""
    # Pydantic (v2) models — duck-typed so pydantic is never a dependency.
    model_fields = getattr(t, "model_fields", None)
    if isinstance(model_fields, dict) and model_fields:
        return {name: getattr(f, "annotation", Any) for name, f in model_fields.items()}
    # Dataclasses, TypedDicts, NamedTuples, plain annotated classes.
    if dataclasses.is_dataclass(t) or hasattr(t, "__annotations__"):
        try:
            hints = get_type_hints(t)
        except Exception:
            # Unresolvable forward refs → fall back to the raw annotation
            # strings. Deterministic, but the hash then depends on whether refs
            # resolve at call time — keep response models importable at runtime.
            hints = dict(getattr(t, "__annotations__", {}))
        if hints:
            return {
                k: v
                for k, v in hints.items()
                # ClassVars are class-level constants — never on the wire.
                if not k.startswith("_") and get_origin(v) is not ClassVar
            }
    return None


def _union(members: Iterable[str]) -> str:
    """Canonical union text: deduped, ``null`` first (matching the Go adapter's
    ``(null|T)`` pointer form), remaining members sorted; 1-ary unions collapse.
    """
    unique = set(members)
    ordered = (["null"] if "null" in unique else []) + sorted(unique - {"null"})
    if len(ordered) == 1:
        return ordered[0]
    return "(" + "|".join(ordered) + ")"


def _canonical(t: Any, seen: set) -> str:
    """Canonical structural string for a type annotation (order-independent)."""
    if t is None or t is type(None):
        return "null"
    if t is Any:
        return "any"

    origin = get_origin(t)
    if origin is not None:
        args = get_args(t)
        # Optional[T] / Union[...] / `X | Y` → canonical union (null-first).
        if origin is Union or origin is types.UnionType:
            return _union(_canonical(a, seen) for a in args)
        if origin is tuple:
            # tuple[T, ...] is homogeneous; a fixed-size tuple serializes as a
            # JSON array whose element type is the union of all element types —
            # every position must contribute to the hash.
            if len(args) == 2 and args[1] is Ellipsis:
                return f"[{_canonical(args[0], seen)}]"
            inner = _union(_canonical(a, seen) for a in args) if args else "any"
            return f"[{inner}]"
        if origin in (list, set, frozenset):
            inner = _canonical(args[0], seen) if args else "any"
            return f"[{inner}]"
        if origin is dict:
            key = _canonical(args[0], seen) if args else "any"
            val = _canonical(args[1], seen) if len(args) > 1 else "any"
            return f"map[{key}]{val}"
        return _canonical(origin, seen)

    if isinstance(t, type):
        if issubclass(t, bool):
            return "bool"
        if issubclass(t, str):
            return "string"
        if issubclass(t, (int, float)):
            return "number"
        if t in (list, tuple, set, frozenset):
            return "[any]"
        if t is dict:
            return "map[any]any"

        fields = _fields_of(t)
        if fields is not None:
            if t in seen:
                return f"ref:{t.__name__}"
            # Shared across the whole traversal (matching the Go adapter's map):
            # a class seen once — recursively OR as an earlier sibling field —
            # collapses to `ref:Name` on every later occurrence.
            seen.add(t)
            entries = sorted(f"{name}:{_canonical(ann, seen)}" for name, ann in fields.items())
            return "{" + ",".join(entries) + "}"
        return t.__name__

    return str(t)


# ---------------------------------------------------------------------------
#  Middleware
# ---------------------------------------------------------------------------


def wsgi_middleware(app: Callable, *, version: int, response_type: type) -> Callable:
    """Wrap a WSGI app (Django, Flask, …) so every response carries the schema
    headers. The hash is computed once here — zero per-request cost.
    """
    hash_ = schema_hash(response_type)
    extra = [(HEADER_HASH, hash_), (HEADER_VERSION, str(version))]

    def wrapped(environ: dict, start_response: Callable) -> Iterable[bytes]:
        def start(status: str, headers: list, exc_info: Any = None) -> Any:
            return start_response(status, list(headers) + extra, exc_info)

        return app(environ, start)

    return wrapped


def asgi_middleware(app: Callable, *, version: int, response_type: type) -> Callable:
    """Wrap an ASGI app (FastAPI, Starlette, …) so every HTTP response carries
    the schema headers. The hash is computed once here — zero per-request cost.
    """
    hash_ = schema_hash(response_type)
    extra = [
        (HEADER_HASH.lower().encode(), hash_.encode()),
        (HEADER_VERSION.lower().encode(), str(version).encode()),
    ]

    async def wrapped(
        scope: MutableMapping[str, Any],
        receive: Callable[[], Awaitable[Any]],
        send: Callable[[Any], Awaitable[None]],
    ) -> None:
        if scope.get("type") != "http":
            await app(scope, receive, send)
            return

        async def send_with_headers(message: MutableMapping[str, Any]) -> None:
            if message.get("type") == "http.response.start":
                message = dict(message)
                message["headers"] = list(message.get("headers") or []) + extra
            await send(message)

        await app(scope, receive, send_with_headers)

    return wrapped
