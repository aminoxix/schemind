# contributing to schemind

thanks for wanting to help. contributions that stay true to schemind's core value are very welcome.

> **core value:** tell me when my API's shape changed, without me having to write a spec.

if a change fits that, open a PR. if you're unsure, open a discussion first.

---

## ⚙️ prerequisites

| tool | version | needed for |
|---|---|---|
| Node.js | ≥ 18 | core + frontend |
| pnpm | ≥ 9 | workspace package manager |
| Go | ≥ 1.21 | `examples/backend-go` (optional) |
| JDK + Maven | JDK ≥ 17, Maven ≥ 3.9 | `examples/backend-java` (optional) |

only Node + pnpm are required to work on the core. Go/Java backends are demo targets.

---

## 🛠 building

```bash
git clone https://github.com/aminoxix/schemind
cd schemind
pnpm i
```

- `pnpm build` — compile all packages (tsup → `dist/`)
- `pnpm test` — run tests in watch mode
- `pnpm test:run` — run tests once (CI)
- `pnpm typecheck` — strict tsc, no emit
- `pnpm lint` — Biome lint + format check
- `pnpm lint:fix` — auto-fix lint + formatting (run this before pushing)

everything green? you're set. the core lives in `packages/core` (published as `schemind`).

> before pushing: `pnpm lint:fix && pnpm typecheck && pnpm test:run`

---

## 📁 where things live

```
packages/core/src/
  types.ts        ShapeNode, DriftReport, Reporter … (the type backbone — read this first)
  extractor.ts    JSON → ShapeNode
  diff.ts         ShapeNode × ShapeNode → DriftReport
  engine.ts       observe(): the full extract→snapshot→diff→report loop
  fetch.ts        drop-in fetch wrapper (non-blocking)
  scan.ts         runScan(): CI scanner core
  cli.ts          the `schm` binary
  snapshot.ts     SnapshotStore + MemoryStorageDriver (browser-safe)
  storage/
    base.ts       JsonStorageDriver — serialization + read-time validation base
    local.ts      LocalStorageDriver (node:fs)
    redis.ts      RedisStorageDriver (bring your own client)
    s3.ts         S3StorageDriver (bring your own client)
  validate.ts     runtime validators for untrusted snapshot data
  config.ts       defineConfig
examples/
  backend-go/     Book API on :8080 (stdlib) + runtime drift toggle
  backend-java/   same API on :8081 (Spring Boot)
  frontend/       Next.js demo + Playwright e2e
```

---

## 🔒 house rules

- **zero runtime dependencies** — don't add one without a discussion
- **browser-safe `.` entry** — no `node:*` imports in `src/`. anything needing Node builtins goes behind `schemind/node` (see `src/node.ts`). CI greps `dist/index.js` for `node:fs` — keep it at 0
- **strict TypeScript** — no `any`, no `@ts-ignore`. cross untrusted boundaries using `src/validate.ts`, not `as`
- **tests for extractor + diff** — every shape/severity case gets a fixture

---

## 🔬 how a response becomes a drift report

```
fetch wrapper  ─┐
CLI scan       ─┼─►  engine.observe({ method, url, statusCode, body })
your own code  ─┘            │
                  normalize endpoint key  (/users/123 → /users/:id)
                             │
                  status 2xx? ──no──► skip (error shapes ≠ success shape)
                             │yes
                  extractShape(body)  →  ShapeNode
                             │
                  load baseline ── none ─► save baseline, done
                             │ exists
                  diff(baseline, shape) → DriftReport → reporters
```

the storage driver is just _where the baseline lives_. swapping it changes nothing above.

---

## 🖥 the `schm` CLI

```bash
schm init                                              # scaffold schemind.config.mjs + routes.json
schm scan    --base-url http://localhost:8080 --routes ./routes.json   # learn/update baselines
schm ci      --base-url http://localhost:8080 --routes ./routes.json   # exits 1 on breaking drift
schm accept  --base-url http://localhost:8080 --routes ./routes.json   # review drift, advance baselines (audit-trailed)
schm seed    --from openapi.json                       # seed baselines from an existing OpenAPI spec
schm status                                            # per-endpoint stability scores
schm gc      --stale-after 90d [--prune]               # list/remove baselines unchanged in N days
schm compare --from staging --to prod                  # diff two environments (--env scopes baselines)
schm record  --out fixture.json                        # export baselines to a portable fixture
schm replay  --base-url <url> --routes ./routes.json --fixture fixture.json
schm codegen --target ts|json-schema|openapi|msw [--out <file>]   # generate types/specs/mocks
schm dashboard [--port 4500] [--token <secret>]        # local web UI: health, drift, one-click accept
```

`schm ci --comment` posts/updates a PR comment in GitHub Actions; `scan/ci --migrations`
prints a TS migration per drifted endpoint. **Reporters** (Slack, GitHub, webhook+HMAC,
JSON, PagerDuty, OpenTelemetry) and **middleware** (`schemind/express`, `/next`, `/hono`)
are wired from `schemind.config.mjs`. Noise control: `ignore` (by name) + `ignorePaths`
(by path pattern). GraphQL: `observeGraphql()`. Backend hash fast-path: the Go adapter at
`adapters/schemind-go`. A ready-made GitHub Action lives in `action.yml`.

`routes.json`:

```json
[
  { "method": "GET",  "path": "/api/books" },
  { "method": "GET",  "path": "/api/books/:id", "params": { "id": "<real-id>" } },
  { "method": "POST", "path": "/api/auth/login", "body": { "email": "a@b.c", "password": "x" } }
]
```

to run the CLI from this repo during development:

```bash
pnpm build
node packages/core/dist/cli.js scan --base-url http://localhost:8080 --routes ./routes.json
```

---

## 💾 storage drivers

every driver implements four methods — `read` / `write` / `list` / `remove`.

| driver | entry | use |
|---|---|---|
| `MemoryStorageDriver` | `schemind` | default — tests, browser, short runs |
| `LocalStorageDriver` | `schemind/node` | JSON files in `.schemind/snapshots/` |
| `RedisStorageDriver` | `schemind/node` | shared baseline across instances |
| `S3StorageDriver` | `schemind/node` | durable team baseline in CI |

`RedisStorageDriver` and `S3StorageDriver` are bring-your-own-client — you pass the client so schemind never depends on `ioredis` or `aws-sdk`.

### redis

```bash
pnpm add ioredis   # your dep, not schemind's
```

```js
// schemind.config.mjs
import { defineConfig } from 'schemind'
import { RedisStorageDriver } from 'schemind/node'
import Redis from 'ioredis'

export default defineConfig({
  baseUrl: 'https://staging.api.com',
  routes: './routes.json',
  storage: new RedisStorageDriver(new Redis(process.env.REDIS_URL)),
  ci: { failOn: 'breaking' },
})
```

`node-redis` v4 works too — it satisfies the same `get/set/del/keys` interface.

### S3

```bash
pnpm add @aws-sdk/client-s3
```

```js
// schemind.config.mjs
import { defineConfig } from 'schemind'
import { S3StorageDriver } from 'schemind/node'
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'

const s3 = new S3Client({})
const Bucket = process.env.SCHEMIND_BUCKET

export default defineConfig({
  baseUrl: 'https://staging.api.com',
  routes: './routes.json',
  storage: new S3StorageDriver({
    async getObject(key) {
      try { return await (await s3.send(new GetObjectCommand({ Bucket, Key: key }))).Body.transformToString() }
      catch (e) { if (e.name === 'NoSuchKey') return null; throw e }
    },
    async putObject(key, body)  { await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: body })) },
    async deleteObject(key)     { await s3.send(new DeleteObjectCommand({ Bucket, Key: key })) },
    async listKeys(prefix) {
      const out = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix }))
      return (out.Contents ?? []).map((o) => o.Key).filter(Boolean)
    },
  }),
})
```

### writing your own driver

extend `JsonStorageDriver` and implement four raw-text methods — you get canonical JSON serialization and read-time validation for free (corrupt or hand-edited records throw `SchemindValidationError` instead of poisoning the diff engine):

```ts
import { JsonStorageDriver, type RawRecord } from 'schemind'

class MyKvDriver extends JsonStorageDriver {
  constructor(private kv: MyClient, private prefix = 'schemind:') { super() }
  protected readText(endpoint)           { return this.kv.get(this.prefix + endpoint) }
  protected async writeText(e, s)        { await this.kv.set(this.prefix + e, s) }
  protected async deleteText(endpoint)   { await this.kv.del(this.prefix + endpoint) }
  protected async readAllText(): Promise<RawRecord[]> {
    const keys = await this.kv.keys(this.prefix + '*')
    return Promise.all(keys.map(async (id) => ({ id, text: (await this.kv.get(id)) ?? '' })))
  }
}
```

see `tests/storage-drivers.test.ts` for the fake-client testing pattern — no live Redis/S3 needed.

---

## 🎮 running the demo

```bash
# terminal 1 — pick a backend
cd examples/backend-go   && go run .            # :8080
cd examples/backend-java && mvn spring-boot:run # :8081

# terminal 2 — the frontend
cd examples/frontend && pnpm dev                # http://localhost:3000
```

use the **drift** dropdown to mutate the backend's response shape and watch the schemind panel classify it live.

```bash
cd examples/frontend && pnpm e2e   # boots Go + Next, drives Chromium
```

---

## ✅ before opening a PR

```bash
pnpm typecheck    # no any, no ts-ignore
pnpm test:run     # all tests green
pnpm build        # dist builds + index.js stays node-free
```

add tests for any extractor/diff/driver behaviour you touch. keep the severity rules in [ARCHITECTURE.md](./ARCHITECTURE.md) intact unless explicitly agreed in a discussion.

---

## 🐛 reporting bugs

open a GitHub issue with:

- schemind version (`pnpm list schemind`)
- Node.js version (`node -v`)
- minimal reproduction — a JSON body + expected vs. actual drift output
- stack trace if relevant

---

## 📰 license

by contributing, you agree your changes are released under the [MIT license](./LICENSE).

---

### built with ♡ by

> **profile** [@aminoxix](https://aminoxix.me) · **x** [@aminoxix](https://twitter.com/aminoxix)
