# schemind demo — Book Library

A full, runnable harness that proves the schemind MVP: a Next.js frontend talks
to a Go backend through schemind's `fetch` wrapper, and the **DriftPanel** lights
up the moment the API's response shape changes — with **no backend changes**.

```
examples/
├── backend-go/     Go (stdlib) Book CRUD API on :8080, with a runtime drift toggle
├── backend-java/   Spring Boot twin of the same API on :8081 (JDK 17+, Maven)
├── backend-py/     Python (stdlib) twin on :8082, plus a schemind-py drift watcher
└── frontend/       Next.js app instrumented with schemind + Playwright e2e
```

All backends expose an **identical** API and drift toggle, so the frontend's
**Go / Java / Python** switcher targets any of them. The Go one needs no
toolchain beyond `go`; the Java one needs JDK 17+ and Maven (see
`backend-java/README.md`); the Python one runs on stdlib alone and doubles as
the demo for the in-repo [`schemind-py`](../packages/py) port
(`python3 watch.py`).

## Run it

**1. Backend** (`:8080`, stdlib only, no `go mod tidy` / network needed):

```bash
cd examples/backend-go
go run .
```

**2. Frontend** (`:3000`):

```bash
cd examples/frontend
pnpm dev
```

Open http://localhost:3000. The right-hand **schemind** panel shows a `baseline`
the first time each endpoint is seen.

## Seeing drift

Use the **Drift** dropdown in the toolbar (it flips the backend's response shape
at runtime via `POST /api/_drift?mode=…`), then watch the panel classify it:

| Mode | What the backend does | schemind verdict |
|---|---|---|
| `info` | adds a `genre` field | **INFO** — `field_added` |
| `warn` | makes `rating` nullable (`null`) | **WARN** — `became_nullable` |
| `breaking` | renames `author` → `authorInfo` | **BREAKING** — `field_removed` + `field_added` |

## Backend endpoints

| Method | Path | Description |
|---|---|---|
| GET | /api/books | List all books (`{ data, count }`) |
| GET | /api/books/{id} | Get one book |
| POST | /api/books | Create a book |
| PUT | /api/books/{id} | Update a book |
| DELETE | /api/books/{id} | Delete a book |
| POST | /api/_drift?mode=none\|info\|warn\|breaking | **Test control** — switch response shape |
| GET | /api/health | Health check |

## Prove the adapter hash fast-path

Both the Go and Python backends run their real schemind adapters and stamp
every book response with `X-Schemind-Schema-Hash` (one hash per drift mode).
With the backends up, assert the whole protocol — fast-path skips within a
mode, drift still caught on a mode flip — against both:

```bash
cd examples/frontend
pnpm prove:fastpath
```

## End-to-end tests (Playwright)

The e2e suite boots both servers automatically and asserts schemind detects each
drift severity through the real UI:

```bash
cd examples/frontend
pnpm e2e        # headless
pnpm e2e:ui     # interactive
```
