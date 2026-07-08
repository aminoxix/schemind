"""Port of adapters/schemind-go/schemind_test.go + middleware coverage."""

import asyncio
import re
import unittest
from dataclasses import dataclass
from typing import ClassVar, Optional, TypedDict

from schemind.adapter import (
    HEADER_HASH,
    HEADER_VERSION,
    _canonical,
    asgi_middleware,
    schema_hash,
    wsgi_middleware,
)


@dataclass
class Author:
    name: str
    country: str


@dataclass
class Book:
    id: str
    title: str
    author: Author
    tags: list[str]
    rating: float


class TestSchemaHash(unittest.TestCase):
    def test_hash_is_stable_8_hex(self):
        h1 = schema_hash(Book)
        h2 = schema_hash(Book)
        self.assertEqual(h1, h2)
        self.assertRegex(h1, r"^[0-9a-f]{8}$")

    def test_hash_changes_on_rename(self):
        @dataclass
        class BookRenamed:
            id: str
            title: str
            author_info: Author  # renamed
            tags: list[str]
            rating: float

        self.assertNotEqual(schema_hash(Book), schema_hash(BookRenamed))

    def test_hash_changes_on_retype(self):
        @dataclass
        class BookRetyped:
            id: str
            title: str
            author: Author
            tags: list[str]
            rating: Optional[float]  # float → nullable

        self.assertNotEqual(schema_hash(Book), schema_hash(BookRetyped))

    def test_hash_changes_on_add_and_remove(self):
        @dataclass
        class BookPlus:
            id: str
            title: str
            author: Author
            tags: list[str]
            rating: float
            genre: str  # added

        @dataclass
        class BookMinus:
            id: str
            title: str
            author: Author
            tags: list[str]  # rating removed

        self.assertNotEqual(schema_hash(Book), schema_hash(BookPlus))
        self.assertNotEqual(schema_hash(Book), schema_hash(BookMinus))

    def test_hash_ignores_field_order(self):
        @dataclass
        class A:
            x: str
            y: str

        @dataclass
        class B:
            y: str
            x: str

        self.assertEqual(schema_hash(A), schema_hash(B))

    def test_optional_syntaxes_are_equivalent(self):
        @dataclass
        class WithOptional:
            rating: Optional[float]

        @dataclass
        class WithPipe:
            rating: float | None

        self.assertEqual(schema_hash(WithOptional), schema_hash(WithPipe))

    def test_supports_typed_dicts(self):
        class BookTD(TypedDict):
            id: str
            title: str

        self.assertRegex(schema_hash(BookTD), r"^[0-9a-f]{8}$")
        # Same fields as an equivalent dataclass hash to the same value.
        @dataclass
        class BookDC:
            title: str
            id: str

        self.assertEqual(schema_hash(BookTD), schema_hash(BookDC))

    def test_recursive_types_do_not_loop(self):
        @dataclass
        class Node:
            value: int
            next: Optional["Node"]

        self.assertRegex(schema_hash(Node), r"^[0-9a-f]{8}$")

    def test_bool_is_not_number(self):
        @dataclass
        class WithBool:
            flag: bool

        @dataclass
        class WithInt:
            flag: int

        self.assertNotEqual(schema_hash(WithBool), schema_hash(WithInt))


class TestGoParityCanonicalForm(unittest.TestCase):
    """Pins the canonical text format shared with adapters/schemind-go."""

    def test_nullable_is_null_first(self):
        # Go emits `(null|T)` for `*T`; Python must agree for every T,
        # including ones that would sort before "null" alphabetically.
        self.assertEqual(_canonical(Optional[bool], set()), "(null|bool)")
        self.assertEqual(_canonical(Optional[list[str]], set()), "(null|[string])")
        self.assertEqual(_canonical(Optional[float], set()), "(null|number)")

    def test_repeated_sibling_class_collapses_to_ref(self):
        # Go's shared seen-map collapses the SECOND occurrence of a struct
        # anywhere in the traversal to `ref:Name` — Python must match.
        @dataclass
        class Address:
            city: str

        @dataclass
        class Order:
            billing: Address
            shipping: Address

        self.assertEqual(
            _canonical(Order, set()),
            "{billing:{city:string},shipping:ref:Address}",
        )

    def test_fixed_tuple_elements_all_contribute(self):
        # tuple[str, int] serializes as a JSON array mixing both types — a
        # retype of ANY position must change the hash.
        @dataclass
        class A:
            pair: tuple[str, int]

        @dataclass
        class B:
            pair: tuple[str, str]

        self.assertNotEqual(schema_hash(A), schema_hash(B))
        self.assertEqual(_canonical(tuple[str, int], set()), "[(number|string)]")
        # Homogeneous tuple ≡ list on the wire.
        self.assertEqual(_canonical(tuple[str, ...], set()), _canonical(list[str], set()))

    def test_class_vars_never_reach_the_wire_or_the_hash(self):
        @dataclass
        class Plain:
            name: str

        @dataclass
        class WithConst:
            name: str
            TABLE: ClassVar[str] = "books"

        self.assertEqual(schema_hash(Plain), schema_hash(WithConst))


class TestWsgiMiddleware(unittest.TestCase):
    def test_injects_headers(self):
        def app(environ, start_response):
            start_response("200 OK", [("Content-Type", "application/json")])
            return [b"{}"]

        captured: dict = {}

        def start_response(status, headers, exc_info=None):
            captured["status"] = status
            captured["headers"] = headers

        wrapped = wsgi_middleware(app, version=3, response_type=Book)
        body = b"".join(wrapped({}, start_response))

        self.assertEqual(body, b"{}")
        headers = dict(captured["headers"])
        self.assertEqual(headers[HEADER_HASH], schema_hash(Book))
        self.assertEqual(headers[HEADER_VERSION], "3")
        self.assertEqual(headers["Content-Type"], "application/json")


class TestAsgiMiddleware(unittest.TestCase):
    def test_injects_headers_on_http_responses(self):
        async def app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"{}"})

        wrapped = asgi_middleware(app, version=1, response_type=Book)
        sent: list = []

        asyncio.run(wrapped({"type": "http"}, None, _collect(sent)))
        start = next(m for m in sent if m["type"] == "http.response.start")
        headers = {k.decode(): v.decode() for k, v in start["headers"]}
        self.assertEqual(headers[HEADER_HASH.lower()], schema_hash(Book))
        self.assertEqual(headers[HEADER_VERSION.lower()], "1")

    def test_passes_non_http_scopes_through(self):
        seen: list = []

        async def app(scope, receive, send):
            seen.append(scope["type"])

        wrapped = asgi_middleware(app, version=1, response_type=Book)
        asyncio.run(wrapped({"type": "lifespan"}, None, _collect([])))
        self.assertEqual(seen, ["lifespan"])


def _collect(into: list):
    async def send(message):
        into.append(message)

    return send


if __name__ == "__main__":
    unittest.main()
