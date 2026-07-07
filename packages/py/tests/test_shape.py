"""Port of packages/core/tests/shape.test.ts."""

import unittest

from schemind import (
    UNKNOWN,
    array,
    is_nullable,
    object_,
    scalar,
    shapes_equal,
    stringify_shape,
    union,
    without_null,
)

STR = scalar("string")
NUM = scalar("number")
NUL = scalar("null")


class TestUnionNormalization(unittest.TestCase):
    def test_deduplicates_structurally_equal_members(self):
        self.assertEqual(union([STR, STR, NUM]), union([STR, NUM]))

    def test_collapses_single_surviving_member(self):
        # No 1-ary unions.
        self.assertEqual(union([STR, STR]), STR)

    def test_flattens_nested_unions(self):
        nested = union([union([STR, NUM]), NUL])
        self.assertEqual(nested, union([STR, NUM, NUL]))

    def test_absorbs_unknown_the_bottom_shape(self):
        self.assertEqual(union([UNKNOWN, STR]), STR)

    def test_returns_unknown_for_empty_member_list(self):
        self.assertEqual(union([]), UNKNOWN)
        self.assertEqual(union([UNKNOWN, UNKNOWN]), UNKNOWN)

    def test_orders_members_canonically_and_stably(self):
        self.assertEqual(stringify_shape(union([NUM, STR])), stringify_shape(union([STR, NUM])))


class TestStringifyAndEquality(unittest.TestCase):
    def test_independent_of_object_key_order(self):
        self.assertTrue(shapes_equal(object_({"a": STR, "b": NUM}), object_({"b": NUM, "a": STR})))

    def test_distinguishes_different_shapes(self):
        self.assertFalse(shapes_equal(array(STR), array(NUM)))
        self.assertFalse(shapes_equal(STR, NUM))


class TestNullabilityHelpers(unittest.TestCase):
    def test_is_nullable_detects_null_scalar_and_unions_containing_it(self):
        self.assertTrue(is_nullable(NUL))
        self.assertTrue(is_nullable(union([STR, NUL])))
        self.assertFalse(is_nullable(STR))
        self.assertFalse(is_nullable(union([STR, NUM])))

    def test_without_null_strips_null_from_a_union(self):
        self.assertEqual(without_null(union([STR, NUL])), STR)
        self.assertEqual(without_null(union([STR, NUM, NUL])), union([STR, NUM]))

    def test_without_null_returns_none_when_no_core_remains(self):
        self.assertIsNone(without_null(NUL))

    def test_without_null_leaves_non_nullable_shapes_unchanged(self):
        self.assertEqual(without_null(STR), STR)


if __name__ == "__main__":
    unittest.main()
