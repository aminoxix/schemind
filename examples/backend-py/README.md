# schemind example — Python backend (http.server)

Runs on `:8082` (override with `PORT`). Serves the Book Library CRUD API — the
same contract as the Go (`:8080`) and Java (`:8081`) examples. Stdlib only, no
dependencies.

## Run

```bash
python3 main.py
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

Flip the response shape at runtime — no restart needed:

```bash
curl -X POST "localhost:8082/api/_drift?mode=breaking"   # author → authorInfo
curl -X POST "localhost:8082/api/_drift?mode=warn"       # rating becomes null
curl -X POST "localhost:8082/api/_drift?mode=info"       # adds a `genre` field
curl -X POST "localhost:8082/api/_drift?mode=none"       # canonical shape
```

## schemind-py adapter (hash fast-path)

This backend runs the real [`schemind.adapter`](../../packages/py) module:
every book response carries `X-Schemind-Schema-Hash` / `X-Schemind-Schema-Version`.
Because the drift toggle changes the serialized *shape*, each drift mode is its
own schema version with its own hash (computed once at startup from per-mode
dataclasses). A core with `trustAdapterHash: true` (the demo frontend) skips
extraction while the hash is stable and re-extracts — catching the drift — the
moment the mode flips. The Go and Python adapters canonicalize identically, so
the same shape yields the **same hash across languages**.

## Watch the drift with schemind-py

`watch.py` uses the in-repo [`schemind-py`](../../packages/py) core to learn a
baseline from `GET /api/books`, then walks every drift mode and prints the
classified changes:

```bash
python3 main.py &   # or in another terminal
python3 watch.py
```

Expected output: `info` flags `[].genre · field_added`, `warn` flags
`[].rating · became_nullable`, and `breaking` flags the `author` rename.
