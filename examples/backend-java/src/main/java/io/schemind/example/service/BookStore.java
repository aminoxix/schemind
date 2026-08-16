package io.schemind.example.service;

import io.schemind.example.model.Author;
import io.schemind.example.model.Book;
import io.schemind.example.model.BookInput;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * In-memory book store with a runtime "drift toggle" that changes the <em>shape</em>
 * of serialized books — the deterministic control surface schemind is built to detect.
 *
 * <p>All public operations return a {@link StoreResult} that bundles the serialized
 * response body with the drift mode captured under the same {@code synchronized}
 * block. This eliminates the TOCTOU race between reading the drift mode and building
 * the payload: the controller always stamps the schema hash that describes the exact
 * payload in the response, even if a concurrent {@code POST /api/_drift} arrives
 * mid-flight. Mirrors the Python backend's 3-tuple return pattern.
 */
@Service
public class BookStore {

    // ── Drift modes ───────────────────────────────────────────────────────────

    public static final String DRIFT_NONE     = "none";      // canonical shape
    public static final String DRIFT_BREAKING = "breaking";  // author → authorInfo
    public static final String DRIFT_WARN     = "warn";      // rating becomes null
    public static final String DRIFT_INFO     = "info";      // additive genre field

    public static final Set<String> DRIFT_MODES =
            Set.of(DRIFT_NONE, DRIFT_BREAKING, DRIFT_WARN, DRIFT_INFO);

    // ── Store ─────────────────────────────────────────────────────────────────

    private final Map<String, Book> books = new LinkedHashMap<>();
    private String drift = DRIFT_NONE;  // guarded by this

    public BookStore() {
        seed("Refactoring",                 new Author("Martin Fowler",    "UK"),  List.of("oop", "design"), 4.6);
        seed("Clean Code",                  new Author("Robert C. Martin", "USA"), List.of("craft"),          4.2);
        seed("The Go Programming Language", new Author("Alan Donovan",     "USA"), List.of("go"),             4.7);
    }

    private void seed(String title, Author author, List<String> tags, double rating) {
        Book b = Book.builder()
                .id(UUID.randomUUID().toString())
                .title(title).author(author).tags(tags).rating(rating)
                .createdAt(Instant.now().toString())
                .build();
        books.put(b.getId(), b);
    }

    // ── Operations — (body, drift) captured atomically ────────────────────────

    public synchronized StoreResult<Map<String, Object>> list() {
        List<Map<String, Object>> data = new ArrayList<>(books.size());
        for (Book b : books.values()) data.add(serialize(b));
        return new StoreResult<>(Map.of("data", data, "count", data.size()), drift);
    }

    public synchronized StoreResult<Map<String, Object>> get(String id) {
        Book b = books.get(id);
        if (b == null) return new StoreResult<>(Map.of("error", "not found"), drift);
        return new StoreResult<>(Map.of("data", serialize(b)), drift);
    }

    public synchronized StoreResult<Map<String, Object>> create(BookInput in) {
        Book b = Book.builder()
                .id(UUID.randomUUID().toString())
                .title(in.title())
                .author(in.author() != null ? in.author() : new Author("", ""))
                .tags(in.tags()     != null ? in.tags()   : List.of())
                .rating(in.rating() != null ? in.rating() : 0.0)
                .createdAt(Instant.now().toString())
                .build();
        books.put(b.getId(), b);
        return new StoreResult<>(Map.of("data", serialize(b)), drift);
    }

    public synchronized StoreResult<Map<String, Object>> update(String id, BookInput in) {
        Book b = books.get(id);
        if (b == null) return new StoreResult<>(Map.of("error", "not found"), drift);
        b.setTitle(in.title());
        b.setAuthor(in.author() != null ? in.author() : new Author("", ""));
        b.setTags(in.tags()     != null ? in.tags()   : List.of());
        b.setRating(in.rating() != null ? in.rating() : 0.0);
        return new StoreResult<>(Map.of("data", serialize(b)), drift);
    }

    public synchronized StoreResult<Map<String, Object>> remove(String id) {
        if (!books.containsKey(id))
            return new StoreResult<>(Map.of("error", "not found"), drift);
        books.remove(id);
        return new StoreResult<>(Map.of("data", Map.of("id", id)), drift);
    }

    public synchronized String getDrift() { return drift; }

    public synchronized StoreResult<Map<String, Object>> setDrift(String mode) {
        this.drift = mode;
        return new StoreResult<>(Map.of("drift", mode), mode);
    }

    // ── Serialization ─────────────────────────────────────────────────────────

    /** Called only from synchronized methods — safe to read {@code drift} directly. */
    private Map<String, Object> serialize(Book b) {
        Author a = b.getAuthor() != null ? b.getAuthor() : new Author("", "");
        Map<String, Object> author = new LinkedHashMap<>();
        author.put("name",    a.name());
        author.put("country", a.country());

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id",          b.getId());
        m.put("title",       b.getTitle());
        m.put("author",      author);
        m.put("tags",        b.getTags());
        m.put("rating",      b.getRating());
        m.put("publishedAt", b.getPublishedAt());   // null in canonical shape
        m.put("createdAt",   b.getCreatedAt());

        switch (drift) {
            case DRIFT_BREAKING -> m.put("authorInfo", m.remove("author"));
            case DRIFT_WARN     -> m.put("rating",     null);
            case DRIFT_INFO     -> m.put("genre",      "fiction");
            default             -> { /* none — canonical shape */ }
        }
        return m;
    }
}
