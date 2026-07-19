package io.schemind;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

class SchemindAdapterTest {

    // ── Wire types mirroring the book-library example ─────────────────────────

    record Author(String name, String country) {}

    record BookNone(
            String id, String title, Author author,
            List<String> tags, double rating,
            Optional<String> publishedAt, String createdAt) {}

    record BookBreaking(                          // author → authorInfo (field rename)
            String id, String title, Author authorInfo,
            List<String> tags, double rating,
            Optional<String> publishedAt, String createdAt) {}

    record BookWarn(                              // rating becomes nullable
            String id, String title, Author author,
            List<String> tags, Optional<Double> rating,
            Optional<String> publishedAt, String createdAt) {}

    record BookInfo(                              // additive genre field
            String id, String title, Author author,
            List<String> tags, double rating,
            Optional<String> publishedAt, String createdAt, String genre) {}

    // ── Canonical string ──────────────────────────────────────────────────────

    @Test
    void canonicalString_simpleRecord() {
        // Fields must be sorted; Optional<T> maps to (null|T).
        String canon = SchemindAdapter.canonicalOf(BookNone.class, new java.util.HashSet<>());
        // Sorted field order: author, createdAt, id, publishedAt, rating, tags, title
        assertEquals(
            "{author:{country:string,name:string},createdAt:string,id:string," +
            "publishedAt:(null|string),rating:number,tags:[string],title:string}",
            canon
        );
    }

    @Test
    void canonicalString_breakingDrift_fieldRename() {
        String canon = SchemindAdapter.canonicalOf(BookBreaking.class, new java.util.HashSet<>());
        // "authorInfo" instead of "author"
        assertTrue(canon.contains("authorInfo:"), "expected 'authorInfo' key");
        assertFalse(canon.contains("\"author\":"),  "unexpected 'author' key");
    }

    @Test
    void canonicalString_warnDrift_nullableRating() {
        String warnCanon = SchemindAdapter.canonicalOf(BookWarn.class, new java.util.HashSet<>());
        String noneCanon = SchemindAdapter.canonicalOf(BookNone.class, new java.util.HashSet<>());
        assertTrue(warnCanon.contains("rating:(null|number)"), "expected nullable rating");
        assertTrue(noneCanon.contains("rating:number"),        "expected non-nullable rating");
        assertNotEquals(warnCanon, noneCanon);
    }

    @Test
    void canonicalString_infoDrift_additiveField() {
        String infoCanon = SchemindAdapter.canonicalOf(BookInfo.class, new java.util.HashSet<>());
        assertTrue(infoCanon.contains("genre:string"), "expected 'genre' field");
    }

    // ── Hash ──────────────────────────────────────────────────────────────────

    @Test
    void schemaHash_is8Chars() {
        String hash = SchemindAdapter.schemaHash(BookNone.class);
        assertEquals(8, hash.length());
        assertTrue(hash.matches("[0-9a-f]{8}"), "hash must be lowercase hex");
    }

    @Test
    void schemaHash_stable_acrossInvocations() {
        String a = SchemindAdapter.schemaHash(BookNone.class);
        String b = SchemindAdapter.schemaHash(BookNone.class);
        assertEquals(a, b, "hash must be deterministic");
    }

    @Test
    void schemaHash_differs_acrossDriftModes() {
        String none     = SchemindAdapter.schemaHash(BookNone.class);
        String breaking = SchemindAdapter.schemaHash(BookBreaking.class);
        String warn     = SchemindAdapter.schemaHash(BookWarn.class);
        String info     = SchemindAdapter.schemaHash(BookInfo.class);

        assertNotEquals(none,     breaking, "none vs breaking must differ");
        assertNotEquals(none,     warn,     "none vs warn must differ");
        assertNotEquals(none,     info,     "none vs info must differ");
        assertNotEquals(breaking, warn,     "breaking vs warn must differ");
        assertNotEquals(breaking, info,     "breaking vs info must differ");
        assertNotEquals(warn,     info,     "warn vs info must differ");
    }

    // ── Primitives & scalars ──────────────────────────────────────────────────

    @Test
    void canonicalOf_primitives() {
        var seen = new java.util.HashSet<Class<?>>();
        assertEquals("string", SchemindAdapter.canonicalOf(String.class,  seen));
        assertEquals("bool",   SchemindAdapter.canonicalOf(boolean.class, seen));
        assertEquals("number", SchemindAdapter.canonicalOf(double.class,  seen));
        assertEquals("number", SchemindAdapter.canonicalOf(int.class,     seen));
        assertEquals("number", SchemindAdapter.canonicalOf(Long.class,    seen));
    }

    // ── Generics ─────────────────────────────────────────────────────────────

    @Test
    void canonicalOf_optionalString_isNullable() throws Exception {
        // Resolve Optional<String> from the record component's generic type.
        var rc    = BookNone.class.getRecordComponent("publishedAt");
        var canon = SchemindAdapter.canonicalOf(rc.getGenericType(), new java.util.HashSet<>());
        assertEquals("(null|string)", canon);
    }

    @Test
    void canonicalOf_listOfString() throws Exception {
        var rc    = BookNone.class.getRecordComponent("tags");
        var canon = SchemindAdapter.canonicalOf(rc.getGenericType(), new java.util.HashSet<>());
        assertEquals("[string]", canon);
    }

    record WithMap(Map<String, Integer> index) {}

    @Test
    void canonicalOf_mapType() {
        String canon = SchemindAdapter.canonicalOf(WithMap.class, new java.util.HashSet<>());
        assertEquals("{index:map[string]number}", canon);
    }

    // ── Cycle detection ───────────────────────────────────────────────────────

    record Node(String value, Optional<Node> next) {}

    @Test
    void canonicalOf_recursiveType_doesNotInfiniteLoop() {
        assertDoesNotThrow(() -> SchemindAdapter.canonicalOf(Node.class, new java.util.HashSet<>()));
        String canon = SchemindAdapter.canonicalOf(Node.class, new java.util.HashSet<>());
        assertTrue(canon.contains("ref:Node"), "recursive ref must be collapsed");
    }
}
