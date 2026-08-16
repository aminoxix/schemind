package io.schemind.example.wire;

import io.schemind.SchemindAdapter;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Wire shapes for each drift mode — used <em>only</em> for schema hash
 * computation at startup. Never instantiated at request time.
 *
 * <p>Mirrors {@code examples/backend-py/main.py} {@code _WireBook*} dataclasses
 * and {@code examples/backend-go/main.go} {@code bookWire*} structs: one record
 * per shape variant so the adapter can compute a distinct, stable hash for each.
 *
 * <p>A single static hash shared across drift modes would be a footgun — the
 * core's fast-path trusts the hash and skips shape extraction, so an unchanged
 * hash on a mutated shape means the drift goes undetected. One hash per mode
 * guarantees the hash changes exactly when the shape changes.
 */
public final class WireTypes {

    private WireTypes() {}

    // ── Nested author shape (same across all modes) ───────────────────────────

    public record WireAuthor(String country, String name) {}

    // ── Per-mode wire shapes ──────────────────────────────────────────────────

    /** Canonical shape — drift mode "none". */
    public record WireBookNone(
            String id, String title, WireAuthor author,
            List<String> tags, double rating,
            Optional<String> publishedAt, String createdAt) {}

    /** "breaking" — {@code author} field renamed to {@code authorInfo}. */
    public record WireBookBreaking(
            String id, String title, WireAuthor authorInfo,
            List<String> tags, double rating,
            Optional<String> publishedAt, String createdAt) {}

    /** "warn" — {@code rating} becomes nullable (was {@code double}, now {@code Optional<Double>}). */
    public record WireBookWarn(
            String id, String title, WireAuthor author,
            List<String> tags, Optional<Double> rating,
            Optional<String> publishedAt, String createdAt) {}

    /** "info" — additive {@code genre} field (backward-compatible). */
    public record WireBookInfo(
            String id, String title, WireAuthor author,
            List<String> tags, double rating,
            Optional<String> publishedAt, String createdAt, String genre) {}

    // ── Pre-computed hash maps (startup cost only) ────────────────────────────

    /**
     * Schema hash keyed by drift mode. Computed once via reflection at class
     * load time — zero per-request overhead.
     *
     * <p>Stamp the right hash alongside the response body captured under the
     * store lock to avoid TOCTOU races with the drift toggle. See
     * {@code BookController} for the pattern.
     */
    public static final Map<String, String> SCHEMA_HASH_BY_MODE = Map.of(
            "none",     SchemindAdapter.schemaHash(WireBookNone.class),
            "breaking", SchemindAdapter.schemaHash(WireBookBreaking.class),
            "warn",     SchemindAdapter.schemaHash(WireBookWarn.class),
            "info",     SchemindAdapter.schemaHash(WireBookInfo.class)
    );

    /** Schema version keyed by drift mode. Increment on intentional shape changes. */
    public static final Map<String, Integer> SCHEMA_VERSION_BY_MODE = Map.of(
            "none", 1, "info", 2, "warn", 3, "breaking", 4
    );
}
