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
