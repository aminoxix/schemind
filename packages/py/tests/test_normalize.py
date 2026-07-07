"""Port of packages/core/tests/normalize.test.ts."""

import unittest

from schemind import normalize_endpoint, normalize_path, origin_of, path_of


class TestPathOf(unittest.TestCase):
    def test_extracts_pathname_from_absolute_urls_dropping_query_hash(self):
        self.assertEqual(path_of("http://localhost:8080/api/books?sort=asc#x"), "/api/books")

    def test_handles_relative_urls(self):
        self.assertEqual(path_of("/api/books?x=1"), "/api/books")
        self.assertEqual(path_of("api/books"), "/api/books")


class TestOriginOf(unittest.TestCase):
    def test_returns_origin_for_absolute_urls(self):
        self.assertEqual(origin_of("http://localhost:8080/api/books"), "http://localhost:8080")
        self.assertEqual(origin_of("https://api.example.com/x"), "https://api.example.com")

    def test_returns_empty_string_for_relative_urls(self):
        self.assertEqual(origin_of("/api/books"), "")
        self.assertEqual(origin_of("api/books"), "")


class TestNormalizePath(unittest.TestCase):
    def test_collapses_numeric_ids(self):
        self.assertEqual(normalize_path("/api/books/123"), "/api/books/:id")
        self.assertEqual(normalize_path("/api/users/42/posts/99"), "/api/users/:id/posts/:id")

    def test_collapses_uuids(self):
        self.assertEqual(
            normalize_path("/api/books/3f2504e0-4f89-41d3-9a0c-0305e82c3301"), "/api/books/:id"
        )

    def test_leaves_param_free_paths_untouched(self):
        self.assertEqual(normalize_path("/api/books"), "/api/books")


class TestNormalizeEndpoint(unittest.TestCase):
    def test_uppercases_method_and_keeps_relative_paths_origin_free(self):
        self.assertEqual(normalize_endpoint("POST", "/api/auth/login"), "POST /api/auth/login")
        self.assertEqual(normalize_endpoint("get", "/api/books/7"), "GET /api/books/:id")

    def test_includes_origin_for_absolute_urls_by_default(self):
        self.assertEqual(
            normalize_endpoint("get", "http://localhost:8080/api/books/7"),
            "GET http://localhost:8080/api/books/:id",
        )

    def test_keeps_different_hosts_in_separate_keys(self):
        a = normalize_endpoint("GET", "https://api-a.com/api/users/1")
        b = normalize_endpoint("GET", "https://api-b.com/api/users/2")
        self.assertNotEqual(a, b)
        self.assertEqual(a, "GET https://api-a.com/api/users/:id")

    def test_can_merge_hosts_when_include_origin_is_false(self):
        self.assertEqual(
            normalize_endpoint("GET", "http://localhost:8080/api/books/7", include_origin=False),
            "GET /api/books/:id",
        )


if __name__ == "__main__":
    unittest.main()
