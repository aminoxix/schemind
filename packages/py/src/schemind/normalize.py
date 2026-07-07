"""Endpoint normalization. Port of ``packages/core/src/normalize.ts``.

Turns a concrete request into a stable, parameterized endpoint key so that
``/api/users/123`` and ``/api/users/456`` collapse to a single
``GET /api/users/:id`` — otherwise every distinct id would get its own
snapshot.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final
from urllib.parse import urlsplit


@dataclass(frozen=True, slots=True)
class ParamPattern:
    """A path-rewriting rule applied during normalization."""

    #: Compiled pattern; every occurrence is rewritten.
    pattern: re.Pattern[str]
    #: Replacement, e.g. ``/:id``.
    replacement: str


_UUID = re.compile(
    r"/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?=/|$)"
)
_NUMERIC = re.compile(r"/\d+(?=/|$)")

#: Default rules: UUID segments and purely-numeric segments both collapse to
#: ``/:id``. Override via the ``patterns`` argument for hashes, slugs, etc.
DEFAULT_PARAM_PATTERNS: Final[tuple[ParamPattern, ...]] = (
    ParamPattern(pattern=_UUID, replacement="/:id"),
    ParamPattern(pattern=_NUMERIC, replacement="/:id"),
)


def path_of(url: str) -> str:
    """Extract the pathname from an absolute or relative URL, dropping query/hash."""
    path = urlsplit(url).path
    return path if path.startswith("/") else f"/{path}"


def origin_of(url: str) -> str:
    """Extract the origin (``scheme://host:port``) of an **absolute** URL, or
    ``''`` for a relative one. Used to keep endpoints from different hosts in
    separate snapshots — ``api-a.com/api/users`` and ``api-b.com/api/users``
    must not collide.
    """
    parts = urlsplit(url)
    if parts.scheme and parts.netloc:
        return f"{parts.scheme}://{parts.netloc}"
    return ""


def normalize_path(path: str, patterns: Sequence[ParamPattern] = DEFAULT_PARAM_PATTERNS) -> str:
    """Apply param patterns to a pathname."""
    out = path
    for rule in patterns:
        out = rule.pattern.sub(rule.replacement, out)
    # Collapse any accidental trailing slash (but keep root "/").
    if len(out) > 1 and out.endswith("/"):
        out = out[:-1]
    return out


def normalize_endpoint(
    method: str,
    url: str,
    *,
    patterns: Sequence[ParamPattern] = DEFAULT_PARAM_PATTERNS,
    include_origin: bool = True,
) -> str:
    """Build a normalized endpoint key.

    - relative URL → ``GET /api/users/:id``
    - absolute URL → ``GET http://api.example.com/api/users/:id``
      (origin included by default; set ``include_origin=False`` when several
      hosts proxy one logical API and should be merged — relative URLs never
      carry an origin)
    """
    origin = origin_of(url) if include_origin else ""
    return f"{method.upper()} {origin}{normalize_path(path_of(url), patterns)}"
