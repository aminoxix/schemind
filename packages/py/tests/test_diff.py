"""Port of packages/core/tests/diff.test.ts — the Phase-0 exit-criterion suite:
the diff engine must classify 100% of fixture cases with the correct severity.
"""

import unittest

from schemind import (
    UNKNOWN,
    DriftChange,
    array,
    diff_report,
    diff_shapes,
    extract_shape,
    object_,
    scalar,
    union,
)

STR = scalar("string")
NUM = scalar("number")
BOOL = scalar("boolean")
NUL = scalar("null")


class DiffAssertions(unittest.TestCase):
    def at(self, changes: list[DriftChange], path: str) -> DriftChange:
        """Find the single change at a given path (asserts exactly one)."""
        found = [c for c in changes if c.path == path]
        self.assertEqual(len(found), 1, f'expected exactly one change at "{path}", got {found!r}')
        return found[0]

    def expect_change(self, changes, path, type_, severity):
        change = self.at(changes, path)
        self.assertEqual(change.type, type_)
        self.assertEqual(change.severity, severity)


class TestSixChangeTypes(DiffAssertions):
    """The six change types with correct severity."""

    def test_field_added_is_info(self):
        from_ = object_({"a": STR})
        to = object_({"a": STR, "b": NUM})
        self.expect_change(diff_shapes(from_, to), "b", "field_added", "info")

    def test_field_removed_is_breaking(self):
        from_ = object_({"a": STR, "b": NUM})
        to = object_({"a": STR})
        self.expect_change(diff_shapes(from_, to), "b", "field_removed", "breaking")

    def test_type_changed_is_breaking(self):
        from_ = object_({"a": STR})
        to = object_({"a": NUM})
        self.expect_change(diff_shapes(from_, to), "a", "type_changed", "breaking")

    def test_became_nullable_gained_null_in_union_is_warn(self):
        from_ = object_({"a": STR})
        to = object_({"a": union([STR, NUL])})
        self.expect_change(diff_shapes(from_, to), "a", "became_nullable", "warn")

    def test_became_nullable_value_now_null_only_is_warn(self):
        # The canonical Go/Java demo: Rating float64 → *float64, observed as null.
        from_ = object_({"rating": NUM})
        to = object_({"rating": NUL})
        self.expect_change(diff_shapes(from_, to), "rating", "became_nullable", "warn")

    def test_became_required_lost_null_is_warn(self):
        from_ = object_({"a": union([STR, NUL])})
        to = object_({"a": STR})
        self.expect_change(diff_shapes(from_, to), "a", "became_required", "warn")

    def test_array_item_changed_is_breaking(self):
        from_ = object_({"tags": array(STR)})
        to = object_({"tags": array(NUM)})
        self.expect_change(diff_shapes(from_, to), "tags[]", "array_item_changed", "breaking")


class TestRecursionAndPaths(DiffAssertions):
    def test_nested_object_additions_have_dotted_path(self):
        from_ = object_({"user": object_({"id": NUM})})
        to = object_({"user": object_({"id": NUM, "name": STR})})
        self.expect_change(diff_shapes(from_, to), "user.name", "field_added", "info")

    def test_deeply_nested_type_changes_have_precise_path(self):
        from_ = object_({"a": object_({"b": object_({"c": STR})})})
        to = object_({"a": object_({"b": object_({"c": NUM})})})
        self.expect_change(diff_shapes(from_, to), "a.b.c", "type_changed", "breaking")

    def test_field_level_granularity_inside_array_items(self):
        from_ = object_({"items": array(object_({"id": NUM}))})
        to = object_({"items": array(object_({"id": STR}))})
        self.expect_change(diff_shapes(from_, to), "items[].id", "type_changed", "breaking")

    def test_wholesale_array_element_replacement(self):
        from_ = object_({"items": array(STR)})
        to = object_({"items": array(object_({"id": NUM}))})
        self.expect_change(diff_shapes(from_, to), "items[]", "array_item_changed", "breaking")


class TestEmptyArrayWildcard(unittest.TestCase):
    """Empty arrays act as a wildcard (no spurious drift)."""

    def test_populated_to_empty_produces_no_change(self):
        from_ = object_({"tags": array(STR)})
        to = object_({"tags": array(UNKNOWN)})
        self.assertEqual(diff_shapes(from_, to), [])

    def test_empty_to_populated_produces_no_change(self):
        from_ = object_({"tags": array(UNKNOWN)})
        to = object_({"tags": array(STR)})
        self.assertEqual(diff_shapes(from_, to), [])


class TestIdenticalShapes(unittest.TestCase):
    def test_reports_nothing_for_structurally_equal_shapes(self):
        shape = object_({"a": STR, "b": array(object_({"c": BOOL}))})
        self.assertEqual(diff_shapes(shape, shape), [])

    def test_insensitive_to_object_key_order(self):
        from_ = object_({"a": STR, "b": NUM})
        to = object_({"b": NUM, "a": STR})
        self.assertEqual(diff_shapes(from_, to), [])


class TestDiffReportSeverityAggregation(unittest.TestCase):
    def test_takes_the_highest_severity_among_changes(self):
        from_ = object_({"a": STR, "keep": NUM})
        # type_changed(breaking) + field_removed(breaking) + field_added(info)
        to = object_({"a": NUM, "added": BOOL})
        report = diff_report("GET /api/x", from_, to)
        self.assertEqual(report.endpoint, "GET /api/x")
        self.assertEqual(report.severity, "breaking")
        self.assertGreaterEqual(len(report.changes), 2)

    def test_info_when_only_additive_changes_occur(self):
        from_ = object_({"a": STR})
        to = object_({"a": STR, "b": NUM})
        self.assertEqual(diff_report("GET /api/x", from_, to).severity, "info")

    def test_info_no_drift_for_identical_shapes(self):
        shape = object_({"a": STR})
        report = diff_report("GET /api/x", shape, shape)
        self.assertEqual(report.severity, "info")
        self.assertEqual(report.changes, ())


class TestEndToEndViaExtractShape(DiffAssertions):
    def test_detects_breaking_type_change_on_real_response_shape(self):
        v1 = extract_shape({"user": {"id": 42, "name": "A", "role": None}, "tokens": ["a", "b"]})
        v2 = extract_shape({"user": {"id": "42", "name": "A", "role": None}, "tokens": ["a", "b"]})
        report = diff_report("GET /api/me", v1, v2)
        self.assertEqual(report.severity, "breaking")
        self.expect_change(list(report.changes), "user.id", "type_changed", "breaking")


if __name__ == "__main__":
    unittest.main()
