"""Port of packages/core/tests/extractor.test.ts."""

import unittest

from schemind import UNKNOWN, array, extract_shape, object_, scalar, union


class TestExtractShape(unittest.TestCase):
    def test_maps_json_primitives_to_scalar_nodes(self):
        self.assertEqual(extract_shape("hi"), scalar("string"))
        self.assertEqual(extract_shape(42), scalar("number"))
        self.assertEqual(extract_shape(True), scalar("boolean"))
        self.assertEqual(extract_shape(None), scalar("null"))

    def test_bool_is_boolean_not_number(self):
        # Python-specific hazard: bool subclasses int.
        self.assertEqual(extract_shape(False), scalar("boolean"))
        self.assertEqual(extract_shape(0), scalar("number"))

    def test_extracts_nested_objects_never_values(self):
        shape = extract_shape(
            {"user": {"id": 42, "name": "Anshumaan", "role": None}, "tokens": ["abc", "def"]}
        )
        self.assertEqual(
            shape,
            object_(
                {
                    "user": object_(
                        {
                            "id": scalar("number"),
                            "name": scalar("string"),
                            "role": scalar("null"),
                        }
                    ),
                    "tokens": array(scalar("string")),
                }
            ),
        )

    def test_represents_a_null_field_as_the_null_scalar(self):
        self.assertEqual(extract_shape({"role": None}), object_({"role": scalar("null")}))

    def test_unions_heterogeneous_array_item_shapes_deduped(self):
        shape = extract_shape([1, "two", 3])
        self.assertEqual(shape, array(union([scalar("number"), scalar("string")])))

    def test_models_an_empty_array_as_unknown_items(self):
        self.assertEqual(extract_shape([]), array(UNKNOWN))
        self.assertEqual(extract_shape({"tags": []}), object_({"tags": array(UNKNOWN)}))

    def test_samples_only_the_first_3_items_by_default(self):
        # 4th item is a number but must not appear in the inferred item shape.
        shape = extract_shape(["a", "b", "c", 99])
        self.assertEqual(shape, array(scalar("string")))

    def test_respects_a_custom_array_sample_size(self):
        shape = extract_shape(["a", "b", "c", 99], array_sample_size=4)
        self.assertEqual(shape, array(union([scalar("number"), scalar("string")])))

    def test_handles_deep_nesting(self):
        shape = extract_shape({"a": {"b": {"c": [{"d": 1}]}}})
        self.assertEqual(
            shape,
            object_(
                {"a": object_({"b": object_({"c": array(object_({"d": scalar("number")}))})})}
            ),
        )

    def test_unions_object_shapes_across_sampled_array_items(self):
        shape = extract_shape([{"id": 1}, {"id": 2, "extra": True}])
        self.assertEqual(
            shape,
            array(
                union(
                    [
                        object_({"id": scalar("number")}),
                        object_({"id": scalar("number"), "extra": scalar("boolean")}),
                    ]
                )
            ),
        )

    def test_raises_on_unrepresentable_values(self):
        with self.assertRaises(TypeError):
            extract_shape(lambda: None)
        with self.assertRaises(TypeError):
            extract_shape({1, 2, 3})
        with self.assertRaises(TypeError):
            extract_shape(b"bytes")

    def test_collapses_nesting_beyond_max_depth_to_unknown(self):
        self.assertEqual(
            extract_shape({"a": {"b": {"c": 1}}}, max_depth=2),
            object_({"a": object_({"b": UNKNOWN})}),
        )
        # A pathologically deep object must not blow the stack.
        deep: object = 1
        for _ in range(100_000):
            deep = {"a": deep}
        extract_shape(deep, max_depth=32)  # must not raise

    def test_drops_ignored_fields_at_any_depth(self):
        shape = extract_shape(
            {"id": 1, "updatedAt": "x", "user": {"name": "a", "requestId": "r"}},
            ignore=["updatedAt", "requestId"],
        )
        self.assertEqual(
            shape,
            object_({"id": scalar("number"), "user": object_({"name": scalar("string")})}),
        )


if __name__ == "__main__":
    unittest.main()
