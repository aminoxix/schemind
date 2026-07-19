# schemind-java

> Java backend adapter for [@aminoxix/schemind](https://www.npmjs.com/package/@aminoxix/schemind).

Computes a deterministic schema hash of a response type **at startup** (via reflection — never per-request) and injects the schemind header protocol so the core can skip shape extraction entirely when the hash is unchanged.

## install

```xml
<dependency>
  <groupId>io.schemind</groupId>
  <artifactId>schemind-java</artifactId>
  <version>0.1.0</version>
</dependency>
```

Requires Java 17+. No runtime dependencies (Jakarta Servlet API is `provided`).

## usage

### static response type (recommended)

```java
import io.schemind.SchemindAdapter;

// Compute once at application startup:
private static final String HASH    = SchemindAdapter.schemaHash(BookResponse.class);
private static final int    VERSION = 1;

@GetMapping("/api/books")
public ResponseEntity<BooksResponse> listBooks(HttpServletResponse response) {
    SchemindAdapter.setHeaders(response, HASH, VERSION);
    return ResponseEntity.ok(store.list());
}
```

### dynamic shapes (runtime drift — see example backend)

When the API shape changes at runtime (e.g. a drift toggle), pre-compute one
hash per shape variant and stamp the right one per response, captured atomically
alongside the serialized body:

```java
record WireAuthor(String name, String country) {}
record WireBookNone(String id, String title, WireAuthor author,
                    List<String> tags, double rating,
                    Optional<String> publishedAt, String createdAt) {}
record WireBookInfo(String id, String title, WireAuthor author,
                    List<String> tags, double rating,
                    Optional<String> publishedAt, String createdAt, String genre) {}

Map<String, String> HASH_BY_MODE = Map.of(
    "none", SchemindAdapter.schemaHash(WireBookNone.class),
    "info", SchemindAdapter.schemaHash(WireBookInfo.class)
);

// In controller — mode captured atomically with body:
var result = store.list();    // returns StoreResult<T>(body, mode)
SchemindAdapter.setHeaders(response, HASH_BY_MODE.get(result.drift()), 1);
```

### servlet filter (static type)

```java
@Bean
public FilterRegistrationBean<SchemindAdapter.SchemindFilter> schemindFilter() {
    var reg = new FilterRegistrationBean<>(SchemindAdapter.filterFor(BookResponse.class, 1));
    reg.addUrlPatterns("/api/*");
    return reg;
}
```

## supported types

| Type | Example | Canonical form |
|---|---|---|
| `String` | `String name` | `string` |
| numbers | `double rating`, `int count` | `number` |
| `boolean` / `Boolean` | `boolean active` | `bool` |
| `Optional<T>` | `Optional<String> publishedAt` | `(null\|string)` |
| `List<T>` / `Collection<T>` | `List<String> tags` | `[string]` |
| `Map<K,V>` | `Map<String, Integer> counts` | `map[string]number` |
| nested record/POJO | `Author author` | `{country:string,name:string}` |
| recursive type | `Optional<Node> next` | `ref:Node` |

Works with: Java records (16+), Lombok `@Data`/`@Value` classes, plain POJOs with declared fields.

## wire protocol

Two response headers are injected:

| Header | Example | Meaning |
|---|---|---|
| `X-Schemind-Schema-Hash` | `a3f1c9d2` | SHA-256 (8 chars) of the canonical type string |
| `X-Schemind-Schema-Version` | `1` | Monotonic integer; increment on intentional shape changes |

The schemind core reads these headers. When the hash matches the stored baseline, extraction is skipped entirely (fast-path). When the hash changes, the core re-extracts and diffs the new shape.
