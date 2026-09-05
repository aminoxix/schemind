<div align="center">

<img src="./assets/logo.svg" alt="schemind logo" width="120" />

# schemind

**your API's shape has a mind of its own. schemind watches it.**

[![npm](https://img.shields.io/npm/v/%40aminoxix%2Fschemind?color=1818ab&label=npm)](https://www.npmjs.com/package/@aminoxix/schemind)
[![license](https://img.shields.io/npm/l/%40aminoxix%2Fschemind?color=1818ab)](https://github.com/aminoxix/schemind/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/%40aminoxix%2Fschemind?color=1818ab)](https://nodejs.org)
[![zero deps](https://img.shields.io/badge/dependencies-zero-1818ab)](https://www.npmjs.com/package/@aminoxix/schemind)

[Quickstart](#quickstart) · [How it works](#how-it-works) · [Integrations](#integrations) · [CI gate](#ci-gate) · [Backend adapters](#backend-adapters)

</div>

---

## The problem

Your frontend calls `/api/users/:id` and trusts the shape of what comes back. Then, one day, a backend team renames `author` to `authorInfo`, or a field quietly becomes nullable — and nothing tells you until a user hits a blank screen in production.

No OpenAPI spec catches this if it's out of date. No TypeScript type catches this if the backend and frontend are different teams, different languages, or different repos entirely.

**schemind watches the actual shape of your API responses at runtime and tells you the moment it changes — no spec to write, no types to maintain.**

---

## Quickstart

```bash
npm install @aminoxix/schemind
# or
pnpm add @aminoxix/schemind
```

Drop it into your existing `fetch` calls — no rewrite required:

```ts
import { createSchemindFetch } from "@aminoxix/schemind";

const fetch = createSchemindFetch({
  onObserve: ({ endpoint, report }) => {
    if (report?.severity === "breaking") {
      console.error("API drift detected!", endpoint, report);
    }
  },
});

// every call through this fetch is now observed automatically
const res = await fetch("/api/users/42");
```

**Requires** Node.js `≥ 18` · zero runtime dependencies · works in browser, edge, and Node.

---

## How it works

schemind intercepts your API calls, extracts the *structural shape* of each JSON response (field names, types, nesting — **never** the actual values), and compares it to a stored baseline. When the shape drifts, you get a precise path and severity.

```
GET /api/users/:id  →  shape extracted  →  compared to baseline
                                                     │
                              field_removed     →  🔴 breaking
                              became_nullable   →  🟡 warn
                              field_added       →  🔵 info
```

The baseline is created automatically on first sight — subsequent calls diff against it. No schema to hand-write, ever.

| Change | Severity |
|---|---|
| `field_removed` | 🔴 breaking |
| `type_changed` | 🔴 breaking |
| `array_item_changed` | 🔴 breaking |
| `became_nullable` | 🟡 warn |
| `became_required` | 🟡 warn |
| `field_added` | 🔵 info |

---

## Integrations

schemind ships first-class adapters for whatever you're already using — pick one, no other code changes needed.

<table>
<tr><td width="50%" valign="top">

**Fetch wrapper** — the fastest way in
```ts
import { createSchemindFetch } from "@aminoxix/schemind";

export const fetch = createSchemindFetch({
  onObserve: ({ endpoint, report }) => {
    if (!report || report.changes.length === 0) return;
    console.warn(`[drift] ${endpoint}`, report);
  },
});
```

</td><td width="50%" valign="top">

**Express middleware**
```ts
import { schemindExpress } from "@aminoxix/schemind/express";

app.use(express.json()); // must come first
app.use(schemindExpress({
  onObserve: (r) => r.report && console.log(r.report),
}));
```

</td></tr>
<tr><td width="50%" valign="top">

**Next.js route wrapper**
```ts
import { withSchemind } from "@aminoxix/schemind/next";

export const GET = withSchemind(async (req) => {
  return Response.json(await getUsers());
});
```

</td><td width="50%" valign="top">

**Hono middleware**
```ts
import { schemindHono } from "@aminoxix/schemind/hono";

app.use("*", schemindHono());
```

</td></tr>
</table>

**TanStack Query** gets its own zero-touch integration — wrap your `QueryClient` once and every `useQuery` / `useMutation` in the app is observed automatically:

```ts
import { createSchemindQueryClient } from "@aminoxix/schemind/tanstack";

const queryClient = createSchemindQueryClient({
  onObserve: ({ endpoint, report }) => {
    if (report?.severity === "breaking") console.error("drift!", endpoint, report);
  },
});
```

Per-query hooks (`useSchemindQuery`, `useSchemindMutation`) and a low-level `wrapQueryFn` are also available for finer control — see the [full docs](https://github.com/aminoxix/schemind#tanstack-query-integration).

---

## CI gate — catch drift before it ships

The `schm` CLI probes your API, diffs shapes against a committed baseline, and fails the build on breaking drift. It's a contract test that needs no spec to maintain.

```bash
# scaffold config + routes file (run once)
npx schm init

# run the gate
npx schm ci --base-url https://staging.api.com --routes ./routes.json
```

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

## Persist baselines across runs

By default baselines live in memory and vanish on restart. Persist them so CI has something real to diff against:

```ts
import { createSchemind, SnapshotStore } from "@aminoxix/schemind";
import { LocalStorageDriver } from "@aminoxix/schemind/node";

const engine = createSchemind({
  store: new SnapshotStore(new LocalStorageDriver(".schemind/snapshots")),
});
```

Commit `.schemind/snapshots/` to git so CI always has a baseline.

| Driver | Import | Use case |
|---|---|---|
| `MemoryStorageDriver` *(default)* | `@aminoxix/schemind` | tests, browser |
| `LocalStorageDriver` | `@aminoxix/schemind/node` | local dev, CI with git-committed snapshots |
| `RedisStorageDriver` | `@aminoxix/schemind/node` | shared baseline across instances |
| `S3StorageDriver` | `@aminoxix/schemind/node` | durable shared baseline in CI |

Redis and S3 are bring-your-own-client — schemind stays dependency-free.

---

## Reduce noise

Ignore volatile fields (`updatedAt`, `requestId`, etc.) that change on every request but aren't real drift:

```ts
export default defineConfig({
  ignoreFields: ["updatedAt", "createdAt", "requestId"],
  ignorePaths: ["**.timestamp", "data[].traceId"],
});
```

---

## Notifications

Wire reporters straight into `schemind.config.mjs` — Slack, GitHub PR comments, generic webhooks (HMAC-signable), PagerDuty, and OpenTelemetry are all built in.

```ts
import { defineConfig, slackReporter, githubReporter } from "@aminoxix/schemind";

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

---

## Generate types & mocks from what you've observed

Once schemind has learned your API's real shapes, export them as usable artifacts — no manual spec-writing:

```bash
schm codegen --target ts      --out src/api-types.ts   # TypeScript interfaces
schm codegen --target openapi --out openapi.json       # OpenAPI 3.0 spec
schm codegen --target json-schema                       # JSON Schema (stdout)
schm codegen --target msw     --out src/mocks.ts        # MSW request handlers
```

Already have a spec? Seed baselines from it instead of starting cold:

```bash
schm seed --from openapi.json
```

---

## Local dashboard

```bash
schm dashboard
# → http://127.0.0.1:4500
```

Inspect endpoint health scores, trigger scans, and accept drift with one click.

---

## Backend adapters

Install a satellite adapter on your backend to unlock the hash fast-path — schemind skips shape extraction entirely when the response struct hasn't changed.

| Backend | Package | Status |
|---|---|---|
| Go (`net/http`) | `schemind-go` | ✅ available |
| Java / Spring Boot | `schemind-java` | ✅ available |
| Python (FastAPI / Django) | `schemind-py` | ✅ available |

---

## Why schemind?

- **No spec to maintain.** Baselines are learned at runtime, not hand-written and left to rot.
- **Language-agnostic core.** The same drift model (`none` / `breaking` / `warn` / `info`) works whether your backend is TypeScript, Go, Java, or Python.
- **Zero runtime dependencies.** Ships lean, works anywhere JavaScript runs — browser, edge, Node.
- **Drop-in, not a rewrite.** Wrap your existing `fetch`, add a middleware line, or wrap a query client — that's the whole integration.
- **CI-native.** Fails builds on real breaking changes, not on cosmetic diffs, with configurable severity thresholds.

---

## Contributing

Contributions are very welcome — see [CONTRIBUTING.md](https://github.com/aminoxix/schemind/blob/main/CONTRIBUTING.md) to get started. Good first areas: new backend adapters, additional reporters, and codegen targets.

## License

[MIT](https://github.com/aminoxix/schemind/blob/main/LICENSE) · built by [aminos](https://dev.iflyrich.space)
