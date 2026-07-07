"""Severity rules + shape JSON round-trip (interop with the TS snapshot format)."""

import unittest

from schemind import (
    SEVERITY_BY_CHANGE_TYPE,
    UNKNOWN,
    array,
    highest_severity,
    max_severity,
    object_,
    scalar,
    shape_from_json,
    shape_to_json,
    union,
)


class TestSeverityRules(unittest.TestCase):
    def test_locked_product_rules(self):
        self.assertEqual(
            SEVERITY_BY_CHANGE_TYPE,
            {
                "field_added": "info",
                "field_removed": "breaking",
                "type_changed": "breaking",
                "became_nullable": "warn",
                "became_required": "warn",
                "array_item_changed": "breaking",
            },
        )

    def test_max_severity(self):
        self.assertEqual(max_severity("info", "warn"), "warn")
        self.assertEqual(max_severity("breaking", "warn"), "breaking")
        self.assertEqual(max_severity("info", "info"), "info")

    def test_highest_severity_empty_is_info(self):
        self.assertEqual(highest_severity([]), "info")
        self.assertEqual(highest_severity(["info", "breaking", "warn"]), "breaking")


class TestShapeJsonRoundTrip(unittest.TestCase):
    def test_round_trips_a_nested_shape(self):
        shape = object_(
            {
                "id": scalar("number"),
                "tags": array(UNKNOWN),
                "role": union([scalar("string"), scalar("null")]),
                "nested": object_({"ok": scalar("boolean")}),
            }
        )
        self.assertEqual(shape_from_json(shape_to_json(shape)), shape)

    def test_matches_the_ts_plain_json_structure(self):
        self.assertEqual(shape_to_json(scalar("string")), {"kind": "scalar", "type": "string"})
        self.assertEqual(
            shape_to_json(array(scalar("number"))),
            {"kind": "array", "items": {"kind": "scalar", "type": "number"}},
        )
        self.assertEqual(shape_to_json(UNKNOWN), {"kind": "union", "types": []})

    def test_rejects_invalid_kind(self):
        with self.assertRaises(ValueError):
            shape_from_json({"kind": "nope"})


if __name__ == "__main__":
    unittest.main()
