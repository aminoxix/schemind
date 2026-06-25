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
 * In-memory book store with a runtime "drift toggle" that changes the *shape*
 * of serialized books — the deterministic control surface schemind is built to
 * detect. Mirrors {@code examples/backend-go/main.go}.
 */
@Service
public class BookStore {

    public static final String DRIFT_NONE = "none";        // canonical shape
    public static final String DRIFT_BREAKING = "breaking"; // author -> authorInfo
    public static final String DRIFT_WARN = "warn";         // rating becomes null
    public static final String DRIFT_INFO = "info";         // add a `genre` field

    public static final Set<String> DRIFT_MODES =
            Set.of(DRIFT_NONE, DRIFT_BREAKING, DRIFT_WARN, DRIFT_INFO);

    private final Map<String, Book> books = new LinkedHashMap<>();
    private volatile String drift = DRIFT_NONE;

    public BookStore() {
        seed("Refactoring", new Author("Martin Fowler", "UK"), List.of("oop", "design"), 4.6);
        seed("Clean Code", new Author("Robert C. Martin", "USA"), List.of("craft"), 4.2);
        seed("The Go Programming Language", new Author("Alan Donovan", "USA"), List.of("go"), 4.7);
    }

    private void seed(String title, Author author, List<String> tags, double rating) {
        Book b = Book.builder()
                .id(UUID.randomUUID().toString())
                .title(title)
                .author(author)
                .tags(tags)
                .rating(rating)
                .createdAt(Instant.now().toString())
                .build();
        books.put(b.getId(), b);
    }

    public synchronized List<Map<String, Object>> list() {
        List<Map<String, Object>> out = new ArrayList<>(books.size());
        for (Book b : books.values()) {
            out.add(serialize(b));
        }
        return out;
    }

    public synchronized Map<String, Object> get(String id) {
        Book b = books.get(id);
        return b == null ? null : serialize(b);
    }

    public synchronized Map<String, Object> create(BookInput in) {
        Book b = Book.builder()
                .id(UUID.randomUUID().toString())
                .title(in.title())
                .author(in.author())
                .tags(in.tags() == null ? List.of() : in.tags())
                .rating(in.rating() == null ? 0.0 : in.rating())
                .createdAt(Instant.now().toString())
                .build();
        books.put(b.getId(), b);
        return serialize(b);
    }

    public synchronized Map<String, Object> update(String id, BookInput in) {
        Book b = books.get(id);
        if (b == null) {
            return null;
        }
        b.setTitle(in.title());
        b.setAuthor(in.author());
        b.setTags(in.tags() == null ? List.of() : in.tags());
        b.setRating(in.rating() == null ? 0.0 : in.rating());
        return serialize(b);
    }

    public synchronized boolean remove(String id) {
        return books.remove(id) != null;
    }

    public String getDrift() {
        return drift;
    }

    public void setDrift(String mode) {
        this.drift = mode;
    }

    /** Render a book into a map whose shape depends on the active drift mode. */
    private Map<String, Object> serialize(Book b) {
        Author a = b.getAuthor() != null ? b.getAuthor() : new Author("", "");
        Map<String, Object> author = new LinkedHashMap<>();
        author.put("name", a.name());
        author.put("country", a.country());

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", b.getId());
        m.put("title", b.getTitle());
        m.put("author", author);
        m.put("tags", b.getTags());
        m.put("rating", b.getRating());
        m.put("publishedAt", b.getPublishedAt()); // null in the canonical shape
        m.put("createdAt", b.getCreatedAt());

        switch (drift) {
            case DRIFT_BREAKING -> {
                m.put("authorInfo", m.remove("author"));
            }
            case DRIFT_WARN -> m.put("rating", null);
            case DRIFT_INFO -> m.put("genre", "fiction");
            default -> { /* none — canonical shape */ }
        }
        return m;
    }
}
