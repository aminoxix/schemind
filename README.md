# schemind

> your API's shape has a mind of its own. schemind watches it.

[![npm](https://img.shields.io/npm/v/%40aminoxix%2Fschemind?color=18181b&label=npm)](https://www.npmjs.com/package/@aminoxix/schemind)
[![license](https://img.shields.io/npm/l/%40aminoxix%2Fschemind?color=18181b)](./LICENSE)
[![node](https://img.shields.io/node/v/%40aminoxix%2Fschemind?color=18181b)](https://nodejs.org)

schemind learns what your APIs *actually return* at runtime — no spec to write, no types to maintain — and tells you the moment a response shape silently changes.

```ts
import { createSchemindFetch } from "@aminoxix/schemind";

const fetch = createSchemindFetch({
  onObserve: ({ endpoint, report }) => {
    if (report?.severity === "breaking") console.error("API drift!", endpoint, report);
  },
});

// drop-in. every existing fetch call is observed automatically.
const res = await fetch("/api/users/42");
```

---

## install

```bash
npm install @aminoxix/schemind
# pnpm add @aminoxix/schemind
```

**requires** Node.js `≥ 18` · zero runtime dependencies · works in browser, edge, and Node

---

## how it works

@aminoxix/schemind intercepts your API calls, extracts the structural shape of each JSON response (types and nesting — never the actual values), and compares it against a stored baseline. when the shape drifts, it tells you immediately with a precise path and severity.

```
GET /api/users/:id  →  shape extracted  →  compare to baseline
                                                    ↓
                              field_removed    →  breaking 🔴
                              became_nullable  →  warn     🟡
                              field_added      →  info     🔵
```

the baseline is created automatically on first sight. subsequent calls diff against it.

---

## use it

### as a fetch wrapper

the fastest integration — one import, your existing calls work unchanged.

```ts
// lib/fetch.ts
import { createSchemindFetch } from "@aminoxix/schemind";

export const fetch = createSchemindFetch({
  onObserve: ({ endpoint, report }) => {
    if (!report || report.changes.length === 0) return;
    console.warn(`[drift] ${endpoint}`, report);
  },
  onError: (err) => console.error("[schemind]", err),
});
```

### as Express middleware

```ts
import { schemindExpress } from "@aminoxix/schemind/express";

app.use(express.json());  // must come first
app.use(schemindExpress({ onObserve: (r) => r.report && console.log(r.report) }));
```

tracks both response shapes and request body shapes automatically.

### as a Next.js route wrapper

```ts
import { withSchemind } from "@aminoxix/schemind/next";

export const GET = withSchemind(async (req) => {
  return Response.json(await getUsers());
});
```

### as a Hono middleware

```ts
import { schemindHono } from "@aminoxix/schemind/hono";

app.use("*", schemindHono());
```

---

## persist baselines across runs

by default baselines live in memory (gone on restart). to persist them:

```ts
import { createSchemind, SnapshotStore } from "@aminoxix/schemind";
import { LocalStorageDriver } from "@aminoxix/schemind/node";

const engine = createSchemind({
  store: new SnapshotStore(new LocalStorageDriver(".schemind/snapshots")),
});
```

commit `.schemind/snapshots/` to git so CI has a baseline to diff against.

---

## CI gate

the `schm` CLI probes your API, compares shapes to the committed baseline, and exits 1 on breaking drift — a contract test with no spec to maintain.

```bash
# scaffold config + routes file (run once)
npx schm init

# run the gate
npx schm ci --base-url https://staging.api.com --routes ./routes.json
```

`routes.json`:

```json
[
  { "method": "GET",  "path": "/api/users" },
  { "method": "GET",  "path": "/api/users/:id", "params": { "id": "1" } },
  { "method": "POST", "path": "/api/auth/login", "body": { "email": "a@b.c", "password": "x" } }
]
```

### GitHub Action

```yaml
- uses: aminoxix/schemind@v0.5.0
  with:
    base-url: https://staging.api.com
    routes: ./routes.json
    fail-on: breaking   # info | warn | breaking
    comment: true       # post/update a PR comment with the drift table
```

---

## drift severity

| change | severity |
|---|---|
| `field_removed` | 🔴 breaking |
| `type_changed` | 🔴 breaking |
| `array_item_changed` | 🔴 breaking |
| `became_nullable` | 🟡 warn |
| `became_required` | 🟡 warn |
| `field_added` | 🔵 info |

---

## notifications

wire reporters in `schemind.config.mjs`:

```ts
import { defineConfig, slackReporter, githubReporter, webhookReporter } from "@aminoxix/schemind";

export default defineConfig({
  baseUrl: "https://staging.api.com",
  routes: "./routes.json",
  reporters: [
    slackReporter({
      webhookUrl: process.env.SCHEMIND_SLACK_WEBHOOK,
      notifyOn: ["warn", "breaking"],
    }),
    githubReporter({
      token: process.env.GITHUB_TOKEN,
      repo: process.env.GITHUB_REPOSITORY,
      pullNumber: Number(process.env.PR_NUMBER),
    }),
  ],
  ci: { failOn: "breaking" },
});
```

also available: `webhookReporter` (HMAC-signable), `pagerDutyReporter`, `otelReporter`.

---

## reduce noise

ignore volatile fields (`updatedAt`, `requestId`, etc.) that change every response but don't represent shape drift:

```ts
export default defineConfig({
  ignoreFields: ["updatedAt", "createdAt", "requestId"],
  ignorePaths:  ["**.timestamp", "data[].traceId"],
});
```

---

## generate types and mocks from observed shapes

once schemind has learned your API shapes, export them as artifacts:

```bash
schm codegen --target ts          --out src/api-types.ts   # TypeScript interfaces
schm codegen --target openapi     --out openapi.json       # OpenAPI 3.0 spec
schm codegen --target json-schema                          # JSON Schema (stdout)
schm codegen --target msw         --out src/mocks.ts       # MSW request handlers
```

seed baselines from an existing spec so you don't start cold:

```bash
schm seed --from openapi.json
```

---

## local dashboard

inspect endpoint health scores, run scans, and accept drift with one click:

```bash
schm dashboard
# → http://127.0.0.1:4500
```

---

## other storage options

| driver | import | use case |
|---|---|---|
| `MemoryStorageDriver` *(default)* | `@aminoxix/schemind` | tests, browser |
| `LocalStorageDriver` | `@aminoxix/schemind/node` | local dev, CI with git-committed snapshots |
| `RedisStorageDriver` | `@aminoxix/schemind/node` | shared baseline across multiple instances |
| `S3StorageDriver` | `@aminoxix/schemind/node` | durable shared baseline in CI |

Redis and S3 are bring-your-own-client — schemind stays dependency-free.

---

## backend adapters (optional)

install a satellite on your backend to unlock the hash fast-path — schemind skips shape extraction entirely when the response struct hasn't changed.

| backend | package | status |
|---|---|---|
| Go (net/http) | `schemind-go` | ✅ available |
| Java / Spring Boot | `schemind-java` | 🔜 coming soon |
| Python (FastAPI / Django) | `schemind-py` | 🔜 coming soon |

---

## contributing

see [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## license

[MIT](./LICENSE) · built by [aminos](https://aminoxix.me)
