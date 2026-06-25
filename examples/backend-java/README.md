# schemind example — Java backend (Spring Boot)

The Java twin of `../backend-go`. Same Book Library API, same JSON shapes, same
runtime **drift toggle** — on `:8081` instead of `:8080`, so the Next.js
frontend's backend switcher (and schemind) can target either interchangeably.

## Prerequisites

- **JDK 17+** (Spring Boot 3 requires it)
- **Maven 3.9+** (`mvn`)

## Run

```bash
cd examples/backend-java
mvn spring-boot:run
```

Serves on `:8081`. Verify:

```bash
curl localhost:8081/api/health
curl localhost:8081/api/books
```

## Endpoints

Identical to the Go example:

| Method | Path | Description |
|---|---|---|
| GET | /api/books | List all books (`{ data, count }`) |
| GET | /api/books/{id} | Get one book |
| POST | /api/books | Create a book |
| PUT | /api/books/{id} | Update a book |
| DELETE | /api/books/{id} | Delete a book |
| POST | /api/_drift?mode=none\|info\|warn\|breaking | **Test control** — switch response shape |
| GET | /api/_drift | Current drift mode |
| GET | /api/health | Health check |

## Simulating drift

```bash
curl -XPOST 'localhost:8081/api/_drift?mode=breaking'   # author -> authorInfo
curl -XPOST 'localhost:8081/api/_drift?mode=warn'       # rating -> null
curl -XPOST 'localhost:8081/api/_drift?mode=info'       # adds `genre`
curl -XPOST 'localhost:8081/api/_drift?mode=none'       # back to canonical
```

In the demo UI, pick **Java** in the header switcher, then use the **Drift**
dropdown — the schemind panel reacts exactly as it does for Go.

## Tests

```bash
mvn test
```

`BookApiTest` asserts the seeded canonical shape and that `breaking` drift
renames `author` → `authorInfo` in the response (the same contract the Go
example and the schemind core tests exercise).
