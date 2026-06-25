# schemind-go

Go backend adapter for [schemind](../../). Emits the schemind header protocol so
the core can take the **hash fast-path** — skipping shape extraction entirely
when your response struct hasn't changed.

## Install

```bash
go get github.com/aminoxix/schemind/adapters/schemind-go
```

## Use

```go
import schemind "github.com/aminoxix/schemind/adapters/schemind-go"

// net/http: inject the schema headers for your response type.
mux := http.NewServeMux()
// … register handlers …
handler := schemind.Middleware(1 /* version */, BookResponse{})(mux)
http.ListenAndServe(":8080", handler)
```

Or set headers manually:

```go
hash := schemind.Hash(BookResponse{}) // computed once, e.g. at startup
schemind.SetHeaders(w.Header(), hash, 1)
```

## How it works

- `Hash(v)` reflects over `v`'s type **once** (no per-request cost) and builds a
  canonical string of exported field names + types (honoring `json:"…"` tags,
  order-independent), then SHA-256 → first 8 hex chars.
- It injects `X-Schemind-Schema-Hash` and `X-Schemind-Schema-Version`.
- The schemind core, with `trustAdapterHash: true`, compares the hash to the
  stored baseline and **skips extraction + diff** when it matches.

`X-Schemind-Source` (dev/staging file:line) is intentionally **not** emitted by
this adapter — keep source paths out of production responses.

## Test

```bash
go test ./...
```

> Sibling adapters `schemind-py` (FastAPI/Django) and `schemind-java` (Spring) are
> on the roadmap — they implement the same header protocol.
