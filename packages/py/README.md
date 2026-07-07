# schemind-py

> your API's shape has a mind of its own. schemind watches it.

Python port of the [`@aminoxix/schemind`](https://www.npmjs.com/package/@aminoxix/schemind)
core: learns what an API actually returns at runtime and flags when a response
shape silently mutates, classified by severity (`info` / `warn` / `breaking`).

**Zero runtime dependencies.** Python ≥ 3.10. Fully typed (`py.typed`).

## Status

Ports the classification engine — the heart of schemind — with the TypeScript
core's test suite translated case-for-case (61 tests):

| Module | Port of | What it does |
|---|---|---|
| `schemind.types` | `types.ts` | `ShapeNode` model, `DriftChange`/`DriftReport`, severities |
| `schemind.severity` | `severity.ts` | the locked change-type → severity rules |
| `schemind.shape` | `shape.ts` | constructors, canonical stringify, union normalization, nullability |
| `schemind.extractor` | `extractor.ts` | JSON value → shape (array sampling, depth guard, ignores) |
| `schemind.normalize` | `normalize.ts` | endpoint keys — `/api/users/123` → `GET /api/users/:id` |
| `schemind.diff` | `diff.ts` | the drift classifier (six change types, recursive paths) |
| `schemind.adapter` | `adapters/schemind-go` | backend adapter — schema-hash headers + ASGI/WSGI middleware |

Not yet ported: snapshot store, engine orchestrator, reporters.

## Use

```python
from schemind import diff_report, extract_shape, normalize_endpoint

endpoint = normalize_endpoint("GET", "https://api.example.com/users/42")
# → "GET https://api.example.com/users/:id"

baseline = extract_shape({"id": 1, "name": "Ada", "role": None})
observed = extract_shape({"id": "1", "name": "Ada", "role": None})

report = diff_report(endpoint, baseline, observed)
report.severity            # "breaking"
report.changes[0].path     # "id"
report.changes[0].type     # "type_changed"
```

Shapes serialize to the same plain-JSON structure the TypeScript core stores,
so baselines are interoperable:

```python
from schemind import shape_from_json, shape_to_json

shape_to_json(baseline)    # {"kind": "object", "fields": {...}}
```

## Backend adapter (FastAPI / Django / any ASGI or WSGI app)

Computes a deterministic 8-char schema hash of your response type **once at
startup** (dataclass, `TypedDict`, `NamedTuple`, or Pydantic model — duck-typed,
pydantic is never imported) and stamps every response with the schemind header
protocol (`X-Schemind-Schema-Hash` / `X-Schemind-Schema-Version`), unlocking the
core's hash fast-path:

```python
from schemind.adapter import asgi_middleware   # FastAPI / Starlette
app = asgi_middleware(app, version=1, response_type=BookResponse)

from schemind.adapter import wsgi_middleware   # Django / Flask
application = wsgi_middleware(application, version=1, response_type=BookResponse)
```

The hash changes whenever a field is added, removed, renamed, or retyped — and
is field-order-independent. Only adopt it when the type is the single source of
truth for the serialized shape (a runtime-mutated shape with an unchanged hash
would be skipped by the fast-path).

## Demo

`examples/backend-py/watch.py` runs this core against the drifting example
backend and prints classified drift live.

## Test

```bash
cd packages/py
PYTHONPATH=src python3 -m unittest discover -s tests
```

## License

MIT
