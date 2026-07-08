# schemind example — Go backend (net/http)

Runs on `:8080`. Serves the Book Library CRUD API.

## Run

```bash
go mod tidy
go run main.go
```

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | /api/books | List all books |
| GET | /api/books/:id | Get book by ID |
| POST | /api/books | Create book |
| PUT | /api/books/:id | Update book |
| DELETE | /api/books/:id | Delete book |

## Simulating drift (for schemind testing)

To trigger a **breaking** drift: rename `author` → `authorInfo` in the `Book` struct and restart.

To trigger a **warn** drift: change `Rating float64` → `Rating *float64` (make it nullable).

To trigger an **info** drift: add a new `Genre string` field to `Book`.

## schemind-go adapter (hash fast-path)

This backend runs the real [`schemind-go`](../../adapters/schemind-go) adapter:
every book response carries `X-Schemind-Schema-Hash` / `X-Schemind-Schema-Version`.
Because the drift toggle changes the serialized *shape*, each drift mode is its
own schema version with its own hash (computed once at startup). A core with
`trustAdapterHash: true` (the demo frontend) skips extraction while the hash is
stable and re-extracts — catching the drift — the moment the mode flips.
