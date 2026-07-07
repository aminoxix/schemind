"""schemind example backend — Book Library CRUD API (Python, stdlib only).

Runs on :8082. Serves the same Book shape the Go/Java/Next examples use. Has a
runtime "drift toggle" (POST /api/_drift?mode=...) so tests can make the API's
response shape mutate on demand — exactly what schemind is built to catch.
"""

from __future__ import annotations

import json
import re
import sys
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional
from urllib.parse import parse_qs, urlsplit

# Zero-install bootstrap: use the in-repo schemind-py sources directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "packages" / "py" / "src"))

from schemind.adapter import HEADER_HASH, HEADER_VERSION, schema_hash  # noqa: E402

# ---------------------------------------------------------------------------
# Drift modes — change the *shape* of serialized books at runtime.
# ---------------------------------------------------------------------------

DRIFT_NONE = "none"  # canonical shape
DRIFT_BREAKING = "breaking"  # author -> authorInfo (field renamed/removed)
DRIFT_WARN = "warn"  # rating becomes null (nullable)
DRIFT_INFO = "info"  # add a new `genre` field (additive)
DRIFT_MODES = (DRIFT_NONE, DRIFT_BREAKING, DRIFT_WARN, DRIFT_INFO)

# ---------------------------------------------------------------------------
# schemind adapter protocol — per-drift-mode schema hashes.
#
# Each drift mode serializes a different *shape*, so each mode is a distinct
# schema version with its own hash (computed once at startup via the real
# schemind-py adapter). Within a mode the hash is stable → the core's
# trustAdapterHash fast-path can skip extraction; flipping the mode changes
# the hash → the core re-extracts and catches the drift. A single static hash
# here would be a footgun (unchanged hash + mutated shape = missed drift).
# ---------------------------------------------------------------------------


@dataclass
class _WireAuthor:
    name: str
    country: str


@dataclass
class _WireBookNone:  # canonical (drift mode "none")
    id: str
    title: str
    author: _WireAuthor
    tags: list[str]
    rating: float
    publishedAt: Optional[str]
    createdAt: str


@dataclass
class _WireBookBreaking:  # author renamed to authorInfo
    id: str
    title: str
    authorInfo: _WireAuthor
    tags: list[str]
    rating: float
    publishedAt: Optional[str]
    createdAt: str


@dataclass
class _WireBookWarn:  # rating becomes nullable
    id: str
    title: str
    author: _WireAuthor
    tags: list[str]
    rating: Optional[float]
    publishedAt: Optional[str]
    createdAt: str


@dataclass
class _WireBookInfo:  # additive genre field
    id: str
    title: str
    author: _WireAuthor
    tags: list[str]
    rating: float
    publishedAt: Optional[str]
    createdAt: str
    genre: str


SCHEMA_HASH_BY_MODE = {
    DRIFT_NONE: schema_hash(_WireBookNone),
    DRIFT_INFO: schema_hash(_WireBookInfo),
    DRIFT_WARN: schema_hash(_WireBookWarn),
    DRIFT_BREAKING: schema_hash(_WireBookBreaking),
}

SCHEMA_VERSION_BY_MODE = {DRIFT_NONE: 1, DRIFT_INFO: 2, DRIFT_WARN: 3, DRIFT_BREAKING: 4}

# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _new_id() -> str:
    return str(uuid.uuid4())


class Store:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.books: dict[str, dict[str, Any]] = {}
        self.order: list[str] = []
        self.drift = DRIFT_NONE
        for title, author, country, tags, rating in (
            ("Refactoring", "Martin Fowler", "UK", ["oop", "design"], 4.6),
            ("Clean Code", "Robert C. Martin", "USA", ["craft"], 4.2),
            ("Fluent Python", "Luciano Ramalho", "Brazil", ["python"], 4.7),
        ):
            book = {
                "id": _new_id(),
                "title": title,
                "author": {"name": author, "country": country},
                "tags": tags,
                "rating": rating,
                "publishedAt": None,
                "createdAt": _now(),
            }
            self.books[book["id"]] = book
            self.order.append(book["id"])

    def serialize(self, book: dict[str, Any]) -> dict[str, Any]:
        """Render a book into a dict whose *shape* depends on the drift mode."""
        m: dict[str, Any] = {
            "id": book["id"],
            "title": book["title"],
            "author": dict(book["author"]),
            "tags": list(book["tags"]),
            "rating": book["rating"],
            "publishedAt": book["publishedAt"],
            "createdAt": book["createdAt"],
        }
        if self.drift == DRIFT_BREAKING:
            m["authorInfo"] = m.pop("author")
        elif self.drift == DRIFT_WARN:
            m["rating"] = None
        elif self.drift == DRIFT_INFO:
            m["genre"] = "fiction"
        return m

    # -- operations (all under the lock) ------------------------------------

    def list(self) -> tuple[int, dict[str, Any], str]:
        with self._lock:
            data = [self.serialize(self.books[i]) for i in self.order]
            return 200, {"data": data, "count": len(data)}, self.drift

    def get(self, book_id: str) -> tuple[int, dict[str, Any], str]:
        with self._lock:
            book = self.books.get(book_id)
            if book is None:
                return 404, {"error": "not found"}, self.drift
            return 200, {"data": self.serialize(book)}, self.drift

    def create(self, body: dict[str, Any]) -> tuple[int, dict[str, Any], str]:
        with self._lock:
            book = {
                "id": _new_id(),
                "title": body.get("title", ""),
                "author": {
                    "name": (body.get("author") or {}).get("name", ""),
                    "country": (body.get("author") or {}).get("country", ""),
                },
                "tags": body.get("tags") or [],
                "rating": body.get("rating", 0),
                "publishedAt": None,
                "createdAt": _now(),
            }
            self.books[book["id"]] = book
            self.order.append(book["id"])
            return 201, {"data": self.serialize(book)}, self.drift

    def update(self, book_id: str, body: dict[str, Any]) -> tuple[int, dict[str, Any], str]:
        with self._lock:
            book = self.books.get(book_id)
            if book is None:
                return 404, {"error": "not found"}, self.drift
            book["title"] = body.get("title", "")
            book["author"] = {
                "name": (body.get("author") or {}).get("name", ""),
                "country": (body.get("author") or {}).get("country", ""),
            }
            book["tags"] = body.get("tags") or []
            book["rating"] = body.get("rating", 0)
            return 200, {"data": self.serialize(book)}, self.drift

    def remove(self, book_id: str) -> tuple[int, dict[str, Any]]:
        with self._lock:
            if book_id not in self.books:
                return 404, {"error": "not found"}
            del self.books[book_id]
            self.order.remove(book_id)
            return 200, {"data": {"id": book_id}}

    def set_drift(self, mode: Optional[str]) -> tuple[int, dict[str, Any]]:
        if mode not in DRIFT_MODES:
            return 400, {"error": "invalid mode", "allowed": list(DRIFT_MODES)}
        with self._lock:
            self.drift = mode
            return 200, {"drift": mode}

    def get_drift(self) -> tuple[int, dict[str, Any]]:
        with self._lock:
            return 200, {"drift": self.drift}


STORE = Store()

# ---------------------------------------------------------------------------
# HTTP wiring
# ---------------------------------------------------------------------------

_BOOK_ID = re.compile(r"^/api/books/([^/]+)$")


class Handler(BaseHTTPRequestHandler):
    server_version = "schemind-example-py"

    # -- helpers -------------------------------------------------------------

    def _write_json(self, status: int, body: dict[str, Any], mode: Optional[str] = None) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self._cors()
        # schemind adapter protocol: stamp book-shaped success responses. `mode`
        # was captured under the same store lock that serialized the body, so
        # the hash always describes this exact payload (no TOCTOU with the
        # drift toggle).
        if mode is not None and status < 400:
            self.send_header(HEADER_HASH, SCHEMA_HASH_BY_MODE[mode])
            self.send_header(HEADER_VERSION, str(SCHEMA_VERSION_BY_MODE[mode]))
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header(
            "Access-Control-Expose-Headers", f"{HEADER_HASH}, {HEADER_VERSION}"
        )

    def _read_body(self) -> Optional[dict[str, Any]]:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            parsed = json.loads(raw or b"{}")
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            return None

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - stdlib signature
        pass  # keep test output quiet

    # -- verbs ---------------------------------------------------------------

    def do_OPTIONS(self) -> None:  # noqa: N802 - stdlib naming
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlsplit(self.path).path
        if path == "/api/books":
            self._write_json(*STORE.list())
        elif m := _BOOK_ID.match(path):
            self._write_json(*STORE.get(m.group(1)))
        elif path == "/api/_drift":
            self._write_json(*STORE.get_drift())
        elif path == "/api/health":
            self._write_json(200, {"status": "ok"})
        else:
            self._write_json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        parts = urlsplit(self.path)
        if parts.path == "/api/books":
            body = self._read_body()
            if body is None:
                self._write_json(400, {"error": "invalid JSON body"})
                return
            self._write_json(*STORE.create(body))
        elif parts.path == "/api/_drift":
            mode = (parse_qs(parts.query).get("mode") or [None])[0]
            self._write_json(*STORE.set_drift(mode))
        else:
            self._write_json(404, {"error": "not found"})

    def do_PUT(self) -> None:  # noqa: N802
        path = urlsplit(self.path).path
        if m := _BOOK_ID.match(path):
            body = self._read_body()
            if body is None:
                self._write_json(400, {"error": "invalid JSON body"})
                return
            self._write_json(*STORE.update(m.group(1), body))
        else:
            self._write_json(404, {"error": "not found"})

    def do_DELETE(self) -> None:  # noqa: N802
        path = urlsplit(self.path).path
        if m := _BOOK_ID.match(path):
            self._write_json(*STORE.remove(m.group(1)))
        else:
            self._write_json(404, {"error": "not found"})


def main() -> None:
    import os

    port = int(os.environ.get("PORT", "8082"))
    server = ThreadingHTTPServer(("", port), Handler)
    print(f"schemind example (Python) listening on :{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
