// End-to-end proof of the adapter hash fast-path against the live demo backends.
//
// Requires the Go (:8080) and Python (:8082) example backends to be running:
//   cd examples/backend-go && go run .
//   cd examples/backend-py && python3 main.py
//
// Run:  pnpm prove:fastpath   (from examples/frontend)
//
// For each backend it drives the real header path — createSchemindFetch reads
// X-Schemind-Schema-Hash, the engine (trustAdapterHash: true) takes the
// fast-path — and asserts:
//   1. observe /api/books (mode=none)  → baseline created, full extraction
//   2. observe again (same mode)       → hash matches   → skipped === true   (FAST-PATH)
//   3. flip mode=breaking, observe     → hash mismatch  → severity 'breaking' (DRIFT CAUGHT)
//   4. observe again (still breaking)  → baseline not advanced → drift re-reported
//   5. flip mode=none, observe         → hash matches baseline → skipped again
import { createSchemind, createSchemindFetch } from '@aminoxix/schemind'

const CASES = [
  ['Go', process.env.GO_URL ?? 'http://localhost:8080'],
  ['Python', process.env.PY_URL ?? 'http://localhost:8082'],
]

let failures = 0
function check(label, cond, detail) {
  console.log(`  ${cond ? '✓' : '✗ FAIL'} ${label}${detail ? `  (${detail})` : ''}`)
  if (!cond) failures++
}

for (const [name, base] of CASES) {
  console.log(`\n=== ${name} backend (${base}) ===`)

  try {
    await fetch(`${base}/api/health`)
  } catch {
    console.log('  ✗ SKIP — backend not reachable. Start it first (see header comment).')
    failures++
    continue
  }

  const engine = createSchemind({ trustAdapterHash: true })
  // Observation is fire-and-forget (fires after the response returns), so each
  // observe() awaits the next onObserve callback.
  let pending
  const sfetch = createSchemindFetch({ engine, onObserve: (r) => pending?.(r) })
  const observe = async () => {
    const next = new Promise((resolve) => {
      pending = resolve
    })
    await sfetch(`${base}/api/books`)
    return next
  }
  const setMode = (m) => fetch(`${base}/api/_drift?mode=${m}`, { method: 'POST' })

  await setMode('none')
  const r1 = await observe()
  check(
    'baseline created (full extraction)',
    r1.created === true && r1.skipped === false,
    `created=${r1.created} skipped=${r1.skipped}`,
  )

  const r2 = await observe()
  check(
    'same mode → hash fast-path skips extraction',
    r2.skipped === true && r2.report === null,
    `skipped=${r2.skipped}`,
  )

  await setMode('breaking')
  const r3 = await observe()
  check(
    'mode flip → hash mismatch → drift caught',
    r3.skipped === false && r3.report?.severity === 'breaking',
    `skipped=${r3.skipped} severity=${r3.report?.severity}`,
  )
  check(
    'breaking changes name the author rename',
    r3.report?.changes.some((c) => c.path.includes('author') && c.type === 'field_removed'),
  )

  const r4 = await observe()
  check(
    'drift stays visible (baseline not advanced)',
    r4.skipped === false && r4.report?.severity === 'breaking',
  )

  await setMode('none')
  const r5 = await observe()
  check('back to baseline mode → fast-path resumes', r5.skipped === true, `skipped=${r5.skipped}`)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
