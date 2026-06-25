#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { access, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { pathToFileURL } from 'node:url'
import {
  type CodegenSnapshot,
  generateJsonSchema,
  generateMigration,
  generateMsw,
  generateOpenApi,
  generateTypeScript,
  seedFromOpenApi,
} from './codegen/index.js'
import { compareShapeSets } from './compare.js'
import type { SchemindConfig } from './config.js'
import { startDashboard } from './dashboard.js'
import { createSchemind } from './engine.js'
import { createFixture, parseFixture } from './fixture.js'
import { rankEndpointHealth, staleEndpoints } from './health.js'
import { formatReport } from './reporters/format.js'
import { githubReporter } from './reporters/github.js'
import { type ScanRoute, runScan } from './scan.js'
import { SEVERITY_RANK } from './severity.js'
import {
  MemoryStorageDriver,
  type Snapshot,
  SnapshotStore,
  type StorageDriver,
} from './snapshot.js'
import { LocalStorageDriver } from './storage/local.js'
import type { Reporter, Severity } from './types.js'

type Flags = Record<string, string | boolean>

async function main(argv: string[]): Promise<void> {
  const [command = 'help', ...rest] = argv
  if (command === '--version' || command === '-v') return printVersion()
  if (command === 'help' || command === '--help' || command === '-h') return printHelp()

  const flags = parseFlags(rest)
  switch (command) {
    case 'scan':
      return runScanCommand(flags, { ci: false })
    case 'ci':
      return runScanCommand(flags, { ci: true })
    case 'accept':
      return runAccept(flags)
    case 'codegen':
      return runCodegen(flags)
    case 'seed':
      return runSeed(flags)
    case 'dashboard':
      return runDashboard(flags)
    case 'status':
      return runStatus(flags)
    case 'gc':
      return runGc(flags)
    case 'compare':
      return runCompare(flags)
    case 'record':
      return runRecord(flags)
    case 'replay':
      return runReplay(flags)
    case 'init':
      return runInit()
    default:
      console.error(`schm: unknown command "${command}"\n`)
      printHelp()
      process.exitCode = 1
  }
}

async function runScanCommand(flags: Flags, opts: { ci: boolean }): Promise<void> {
  const config = await loadConfig(str(flags.config))

  const baseUrl = str(flags['base-url']) ?? config.baseUrl
  if (!baseUrl) return fail('missing --base-url (or `baseUrl` in config)')

  const routes = await resolveRoutes(flags, config)
  if (!routes) return fail('missing --routes <file> (or `routes` in config)')

  const driver = resolveDriver(flags, config, str(flags.env))
  const store = new SnapshotStore(driver)
  const includeOrigin = config.includeOrigin ?? false // single base-url → path-only keys

  const reporters: Reporter[] = config.reporters ? [...config.reporters] : []
  if (flags.comment === true) {
    const gh = githubReporterFromEnv()
    if (gh) reporters.push(gh)
    else console.warn('schm: --comment needs GITHUB_TOKEN, GITHUB_REPOSITORY and a PR ref')
  }

  const engine = createSchemind({
    store,
    includeOrigin,
    updateOnDrift: !opts.ci && flags.update === true,
    trustAdapterHash: config.trustAdapterHash ?? false,
    ...(reporters.length ? { reporters } : {}),
    ...(config.ignoreFields || config.ignorePaths
      ? {
          extract: {
            ...(config.ignoreFields ? { ignore: config.ignoreFields } : {}),
            ...(config.ignorePaths ? { ignorePaths: config.ignorePaths } : {}),
          },
        }
      : {}),
  })

  console.log(`schemind ${opts.ci ? 'ci' : 'scan'} → ${baseUrl}  (${routes.length} routes)`)
  const summary = await runScan({ baseUrl, routes, engine, ...scanGuards(flags, config) })

  const color = Boolean(process.stdout.isTTY)
  for (const endpoint of summary.created) console.log(`  + learned   ${endpoint}`)
  for (const report of summary.reports) console.log(formatReport(report, color))
  for (const r of summary.results) {
    if (r.error) console.log(`  ! error     ${r.method} ${r.url} — ${r.error}`)
  }

  // Migration snippets for drifted endpoints (old type → new type).
  if (flags.migrations === true) {
    for (const r of summary.results) {
      const report = r.result?.report
      if (!r.endpoint || !report || report.changes.length === 0) continue
      const prev = await store.load(r.endpoint)
      if (prev) console.log(`\n${generateMigration(report, prev.shape, r.result!.observed.shape)}`)
    }
  }

  const errors = summary.results.filter((r) => r.error).length
  console.log(
    `\n${summary.results.length} routes · ${summary.created.length} new · ` +
      `${summary.reports.length} drifted · ${errors} errors · highest: ${summary.severity}`,
  )

  if (opts.ci) {
    const failOn =
      (str(flags['fail-on']) as Severity | undefined) ?? config.ci?.failOn ?? 'breaking'
    const breached = summary.reports.some((r) => SEVERITY_RANK[r.severity] >= SEVERITY_RANK[failOn])
    if (breached || errors > 0) {
      console.error(
        `\n✗ failing: drift at or above "${failOn}"${errors ? ` (and ${errors} request errors)` : ''}`,
      )
      process.exitCode = 1
    } else {
      console.log(`\n✓ no drift at or above "${failOn}"`)
    }
  }
}

async function runCodegen(flags: Flags): Promise<void> {
  const config = await loadConfig(str(flags.config))
  const store = new SnapshotStore(resolveDriver(flags, config, str(flags.env)))
  const snapshots = await loadAllSnapshots(store)
  if (snapshots.length === 0) return fail('no snapshots found — run `schm scan` first')

  const target = str(flags.target) ?? 'ts'
  let output: string
  switch (target) {
    case 'ts':
    case 'typescript':
      output = generateTypeScript(snapshots)
      break
    case 'json-schema':
      output = `${JSON.stringify(generateJsonSchema(snapshots), null, 2)}\n`
      break
    case 'openapi':
      output = `${JSON.stringify(generateOpenApi(snapshots), null, 2)}\n`
      break
    case 'msw':
      output = generateMsw(snapshots)
      break
    default:
      return fail(`unknown --target "${target}" (ts | json-schema | openapi | msw)`)
  }

  const out = str(flags.out)
  if (out !== undefined) {
    await writeFile(resolve(process.cwd(), out), output, 'utf8')
    console.log(`schemind: wrote ${snapshots.length} endpoint(s) → ${out}`)
  } else {
    process.stdout.write(output)
  }
}

async function runDashboard(flags: Flags): Promise<void> {
  const config = await loadConfig(str(flags.config))
  const store = new SnapshotStore(resolveDriver(flags, config, str(flags.env)))
  const baseUrl = str(flags['base-url']) ?? config.baseUrl
  let routes: ScanRoute[] | undefined
  try {
    routes = (await resolveRoutes(flags, config)) ?? undefined
  } catch {
    routes = undefined
  }

  const host = str(flags.host) ?? '127.0.0.1'
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1'
  // Binding off-loopback with no token is unsafe (accept is irreversible) — mint one.
  let token = str(flags.token)
  if (!token && !loopback) {
    token = randomUUID()
    console.warn('schm: non-loopback bind without --token — generated a one-time token')
  }

  const { url } = startDashboard({
    store,
    host,
    port: Number(str(flags.port) ?? '4500'),
    includeOrigin: config.includeOrigin ?? false,
    ...(baseUrl ? { baseUrl } : {}),
    ...(routes ? { routes } : {}),
    ...(token ? { token } : {}),
  })
  const openUrl = token ? `${url}/#token=${token}` : url
  console.log(`schemind dashboard → ${openUrl}`)
  if (token) console.log('  (token-gated: open the URL above so the page can authorize actions)')
  console.log('press Ctrl+C to stop')
}

/** Build a GitHub PR-comment reporter from the Actions environment, if available. */
function githubReporterFromEnv(): Reporter | null {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPOSITORY
  const match = (process.env.GITHUB_REF ?? '').match(/refs\/pull\/(\d+)\//)
  if (!token || !repo || !match) return null
  return githubReporter({ token, repo, pullNumber: Number(match[1]) })
}

async function runGc(flags: Flags): Promise<void> {
  const config = await loadConfig(str(flags.config))
  const store = new SnapshotStore(resolveDriver(flags, config, str(flags.env)))
  const maxAgeMs = parseDuration(str(flags['stale-after']) ?? '90d')
  if (maxAgeMs === null) return fail('invalid --stale-after (use e.g. 90d, 24h, 30m)')

  const snapshots: Snapshot[] = []
  for (const endpoint of await store.list()) {
    const snap = await store.load(endpoint)
    if (snap) snapshots.push(snap)
  }
  const stale = staleEndpoints(snapshots, maxAgeMs)
  if (stale.length === 0) {
    console.log('schemind gc: no stale endpoints ✓')
    return
  }

  const prune = flags.prune === true
  console.log(
    `schemind gc: ${stale.length} stale endpoint(s)${prune ? ' (pruning)' : ' (dry run — pass --prune to remove)'}`,
  )
  for (const s of stale) {
    console.log(`  ${prune ? '✗ removed' : '·'} ${s.endpoint}  (${s.ageDays}d old)`)
    if (prune) await store.remove(s.endpoint)
  }
}

async function runSeed(flags: Flags): Promise<void> {
  const config = await loadConfig(str(flags.config))
  const from = str(flags.from)
  if (!from) return fail('seed needs --from <openapi.json>')

  const doc = JSON.parse(await readFile(resolve(process.cwd(), from), 'utf8'))
  const seeds = seedFromOpenApi(doc)
  if (seeds.length === 0) return fail('no JSON response schemas found in the spec')

  const store = new SnapshotStore(resolveDriver(flags, config, str(flags.env)))
  for (const { endpoint, shape } of seeds) {
    await store.commit(endpoint, shape, {
      acceptance: { acceptedBy: 'seed', reason: `seeded from ${from}` },
    })
  }
  console.log(`schemind: seeded ${seeds.length} endpoint(s) from ${from}`)
}

async function runStatus(flags: Flags): Promise<void> {
  const config = await loadConfig(str(flags.config))
  const store = new SnapshotStore(resolveDriver(flags, config, str(flags.env)))
  const snapshots: Snapshot[] = []
  for (const endpoint of await store.list()) {
    const snap = await store.load(endpoint)
    if (snap) snapshots.push(snap)
  }
  if (snapshots.length === 0) return fail('no snapshots found — run `schm scan` first')

  console.log('score   v   chg   age(d)   endpoint')
  for (const h of rankEndpointHealth(snapshots)) {
    const line = `${pad(String(h.score), 5)}  ${pad(String(h.version), 2)}  ${pad(String(h.changes), 4)}  ${pad(String(h.ageDays), 6)}   ${h.endpoint}`
    console.log(`  ${line}`)
  }
}

async function runCompare(flags: Flags): Promise<void> {
  const config = await loadConfig(str(flags.config))
  const from = str(flags.from)
  const to = str(flags.to)
  if (!from || !to) return fail('compare needs --from <env> and --to <env>')

  const base = await loadAllSnapshots(new SnapshotStore(resolveDriver(flags, config, from)))
  const target = await loadAllSnapshots(new SnapshotStore(resolveDriver(flags, config, to)))
  if (base.length === 0) return fail(`no snapshots in env "${from}"`)

  const cmp = compareShapeSets(base, target)
  const color = Boolean(process.stdout.isTTY)
  console.log(`schemind compare: ${from} → ${to}`)
  for (const report of cmp.reports) console.log(formatReport(report, color))
  if (cmp.onlyInBase.length) console.log(`  only in ${from}: ${cmp.onlyInBase.join(', ')}`)
  if (cmp.onlyInTarget.length) console.log(`  only in ${to}: ${cmp.onlyInTarget.join(', ')}`)
  console.log(`\n${cmp.reports.length} differing endpoints · highest: ${cmp.severity}`)

  const failOn = (str(flags['fail-on']) as Severity | undefined) ?? config.ci?.failOn ?? 'breaking'
  if (cmp.reports.some((r) => SEVERITY_RANK[r.severity] >= SEVERITY_RANK[failOn])) {
    console.error(`\n✗ ${from} differs from ${to} at or above "${failOn}"`)
    process.exitCode = 1
  } else {
    console.log(`\n✓ ${from} matches ${to} below "${failOn}"`)
  }
}

async function runRecord(flags: Flags): Promise<void> {
  const config = await loadConfig(str(flags.config))
  const snapshots = await loadAllSnapshots(
    new SnapshotStore(resolveDriver(flags, config, str(flags.env))),
  )
  if (snapshots.length === 0) return fail('no snapshots to record — run `schm scan` first')

  const fixture = createFixture(snapshots)
  const json = `${JSON.stringify(fixture, null, 2)}\n`
  const out = str(flags.out)
  if (out !== undefined) {
    await writeFile(resolve(process.cwd(), out), json, 'utf8')
    console.log(`schemind: recorded ${snapshots.length} endpoint(s) → ${out}`)
  } else {
    process.stdout.write(json)
  }
}

async function runReplay(flags: Flags): Promise<void> {
  const config = await loadConfig(str(flags.config))
  const baseUrl = str(flags['base-url']) ?? config.baseUrl
  if (!baseUrl) return fail('replay needs --base-url')
  const routes = await resolveRoutes(flags, config)
  if (!routes) return fail('replay needs --routes <file>')
  const fixturePath = str(flags.fixture)
  if (!fixturePath) return fail('replay needs --fixture <file>')

  const fixture = parseFixture(
    JSON.parse(await readFile(resolve(process.cwd(), fixturePath), 'utf8')),
    fixturePath,
  )

  // Seed an in-memory baseline from the recorded fixture, then scan the target.
  const store = new SnapshotStore(new MemoryStorageDriver({ maxEntries: 0 }))
  for (const [endpoint, shape] of Object.entries(fixture.shapes)) {
    await store.commit(endpoint, shape)
  }
  const engine = createSchemind({ store, includeOrigin: false })

  console.log(`schemind replay → ${baseUrl}  (vs fixture ${fixturePath})`)
  const summary = await runScan({ baseUrl, routes, engine, ...scanGuards(flags, config) })
  const color = Boolean(process.stdout.isTTY)
  for (const report of summary.reports) console.log(formatReport(report, color))
  console.log(
    `\n${summary.results.length} routes · ${summary.reports.length} drifted · highest: ${summary.severity}`,
  )

  const failOn = (str(flags['fail-on']) as Severity | undefined) ?? config.ci?.failOn ?? 'breaking'
  if (summary.reports.some((r) => SEVERITY_RANK[r.severity] >= SEVERITY_RANK[failOn])) {
    console.error(`\n✗ candidate drifts from the recorded fixture at or above "${failOn}"`)
    process.exitCode = 1
  } else {
    console.log(`\n✓ candidate matches the recorded fixture below "${failOn}"`)
  }
}

async function runAccept(flags: Flags): Promise<void> {
  const config = await loadConfig(str(flags.config))
  const baseUrl = str(flags['base-url']) ?? config.baseUrl
  if (!baseUrl) return fail('accept needs --base-url')
  const routes = await resolveRoutes(flags, config)
  if (!routes) return fail('accept needs --routes <file>')

  const store = new SnapshotStore(resolveDriver(flags, config, str(flags.env)))
  const engine = createSchemind({ store, includeOrigin: config.includeOrigin ?? false })
  const summary = await runScan({ baseUrl, routes, engine, ...scanGuards(flags, config) })

  const drifted = summary.results.filter(
    (r) => r.result?.report && r.result.report.changes.length > 0,
  )
  if (drifted.length === 0) {
    console.log('schemind accept: no drift to accept ✓')
    return
  }

  const acceptedBy = str(flags.by) ?? process.env.USER ?? 'unknown'
  const reason = str(flags.reason)
  const autoYes = flags.yes === true
  // Accepting drift is permanent (stamps the audit trail). Never accept silently:
  // require an interactive TTY to confirm, or an explicit --yes.
  if (!autoYes && !process.stdin.isTTY) {
    return fail(
      'accept needs an interactive terminal to confirm — pass --yes to accept non-interactively',
    )
  }
  const color = Boolean(process.stdout.isTTY)
  const rl = autoYes ? null : createInterface({ input: process.stdin, output: process.stdout })

  let accepted = 0
  let skipped = 0
  try {
    for (const entry of drifted) {
      const result = entry.result!
      console.log(`\n${formatReport(result.report!, color)}`)
      let take = autoYes
      if (rl) {
        const answer = (await rl.question('  accept this change? [y]es / [n]o / [q]uit: '))
          .trim()
          .toLowerCase()
        if (answer === 'q') break
        take = answer === 'y' || answer === 'yes'
      }
      if (take) {
        await store.commit(result.endpoint, result.observed.shape, {
          acceptance: { acceptedBy, ...(reason !== undefined ? { reason } : {}) },
        })
        accepted++
        console.log(`  ✓ accepted ${result.endpoint}`)
      } else {
        skipped++
      }
    }
  } finally {
    rl?.close()
  }
  console.log(`\nschemind accept: ${accepted} accepted, ${skipped} left flagged (by ${acceptedBy})`)
}

/* ----------------------------- config + io ------------------------------- */

async function loadConfig(explicit?: string): Promise<SchemindConfig> {
  const candidates = explicit
    ? [explicit]
    : ['schemind.config.mjs', 'schemind.config.js', 'schemind.config.json']
  for (const file of candidates) {
    const abs = resolve(process.cwd(), file)
    if (!(await exists(abs))) continue
    if (abs.endsWith('.json')) return JSON.parse(await readFile(abs, 'utf8')) as SchemindConfig
    const mod = (await import(pathToFileURL(abs).href)) as { default?: SchemindConfig }
    return mod.default ?? (mod as SchemindConfig)
  }
  return {}
}

async function resolveRoutes(flags: Flags, config: SchemindConfig): Promise<ScanRoute[] | null> {
  const fromFlag = str(flags.routes)
  const source = fromFlag ?? config.routes
  if (source === undefined) return null
  if (Array.isArray(source)) return source
  const abs = resolve(process.cwd(), source)
  return JSON.parse(await readFile(abs, 'utf8')) as ScanRoute[]
}

function resolveDriver(flags: Flags, config: SchemindConfig, env?: string): StorageDriver {
  const storage = config.storage
  // A ready driver instance (this is how Redis/S3 get wired) — duck-typed.
  if (storage && typeof (storage as StorageDriver).read === 'function') {
    return storage as StorageDriver
  }
  const shorthand = (storage ?? {}) as { driver?: 'local' | 'memory'; path?: string }
  if (shorthand.driver === 'memory') return new MemoryStorageDriver()
  // Multi-environment (F6): scope the local snapshot dir by env name.
  const base = str(flags.snapshots) ?? shorthand.path ?? join('.schemind', 'snapshots')
  return new LocalStorageDriver(env ? join(base, env) : base)
}

/** Load every stored snapshot as `{ endpoint, shape }` pairs. */
async function loadAllSnapshots(store: SnapshotStore): Promise<CodegenSnapshot[]> {
  const out: CodegenSnapshot[] = []
  for (const endpoint of await store.list()) {
    const snap = await store.load(endpoint)
    if (snap) out.push({ endpoint: snap.endpoint, shape: snap.shape })
  }
  return out
}

async function runInit(): Promise<void> {
  const config = `import { defineConfig } from 'schemind'

export default defineConfig({
  baseUrl: 'http://localhost:8080',
  routes: './routes.json',
  // storage: new LocalStorageDriver('.schemind/snapshots'), // default
  ci: { failOn: 'breaking' },
})
`
  const routes = `[
  { "method": "GET", "path": "/api/books" },
  { "method": "GET", "path": "/api/books/:id", "params": { "id": "1" } }
]
`
  await writeIfAbsent('schemind.config.mjs', config)
  await writeIfAbsent('routes.json', routes)
  console.log('schemind: initialized schemind.config.mjs + routes.json')
}

/* ------------------------------- helpers --------------------------------- */

function parseFlags(args: string[]): Flags {
  const flags: Flags = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (!arg.startsWith('--')) continue
    const eq = arg.indexOf('=')
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1)
      continue
    }
    const key = arg.slice(2)
    const next = args[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next
      i++
    } else {
      flags[key] = true
    }
  }
  return flags
}

const str = (v: string | boolean | undefined): string | undefined =>
  typeof v === 'string' ? v : undefined

const pad = (s: string, n: number): string => s.padStart(n)

/** Parse a duration like `90d`, `24h`, `30m`, `45s` into milliseconds. */
function parseDuration(input: string): number | null {
  const match = input.trim().match(/^(\d+)\s*([dhms])$/)
  if (!match) return null
  const n = Number(match[1])
  const unit = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1000 }[match[2]!]!
  return n * unit
}

function scanGuards(
  flags: Flags,
  config: SchemindConfig,
): { blockPrivateNetworks: boolean; maxBodyBytes?: number } {
  return {
    blockPrivateNetworks: config.blockPrivateNetworks ?? flags['block-private'] === true,
    ...(config.maxBodyBytes !== undefined ? { maxBodyBytes: config.maxBodyBytes } : {}),
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function writeIfAbsent(file: string, content: string): Promise<void> {
  const abs = resolve(process.cwd(), file)
  if (await exists(abs)) {
    console.log(`  skip ${file} (exists)`)
    return
  }
  await writeFile(abs, content, 'utf8')
  console.log(`  create ${file}`)
}

function fail(message: string): void {
  console.error(`schm: ${message}`)
  process.exitCode = 1
}

function printVersion(): void {
  console.log('schemind 0.1.0')
}

function printHelp(): void {
  console.log(`schm — schemind CLI

Usage:
  schm scan --base-url <url> --routes <file>   Observe routes, learn/update baselines, report drift
  schm ci   --base-url <url> --routes <file>   Like scan, but exit 1 on drift (CI gate)
  schm accept --base-url <url> --routes <file> Review drift and advance baselines (audit-trailed)
  schm seed   --from openapi.json              Seed baselines from an existing OpenAPI spec
  schm status                                  Per-endpoint stability scores
  schm gc --stale-after 90d [--prune]          List/remove baselines unchanged in N days
  schm compare --from <env> --to <env>         Diff two environments' baselines (e.g. staging vs prod)
  schm record  --out <file>                    Export baselines to a portable fixture
  schm replay  --base-url <url> --routes <file> --fixture <file>   Diff a target against a fixture
  schm codegen --target <fmt> [--out <file>]   Generate types/specs/mocks from stored baselines
  schm dashboard [--port 4500]                 Local web UI: health, drift, one-click accept
  schm init                                    Scaffold schemind.config.mjs + routes.json

Flags:
  --base-url <url>     Target origin (or set baseUrl in config)
  --routes <file>      Path to routes.json (or set routes in config)
  --env <name>         Scope baselines to an environment (dev / staging / prod)
  --snapshots <dir>    Baseline directory for the local driver (default .schemind/snapshots)
  --config <file>      Config file (default schemind.config.{mjs,js,json})
  --fail-on <sev>      ci/compare/replay: min severity to fail on — info | warn | breaking
  --target <fmt>       codegen: ts | json-schema | openapi | msw (default ts)
  --out <file>         codegen / record: write to a file instead of stdout
  --from, --to <env>   compare: the two environments to diff
  --fixture <file>     replay: the recorded fixture to diff against
  --from <file>        seed: the OpenAPI spec (JSON) to seed baselines from
  --migrations         scan/ci: print a TS migration snippet per drifted endpoint
  --comment            ci: post/update a PR comment (uses GITHUB_TOKEN in Actions)
  --port <n>           dashboard: port to serve on (default 4500)
  --host <addr>        dashboard: bind address (default 127.0.0.1)
  --token <secret>     dashboard: bearer token gating accept/scan (auto-set off-loopback)
  --yes                accept: accept all drift non-interactively
  --by <name>          accept: identity recorded in the audit trail (default $USER)
  --reason <text>      accept: rationale recorded in the audit trail
  --update             scan: accept drift and advance baselines
  -v, --version        Print version
  -h, --help           Show this help

Storage (Redis / S3) is wired in schemind.config.mjs by exporting a driver instance.
See CONTRIBUTING.md.`)
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exitCode = 1
})
