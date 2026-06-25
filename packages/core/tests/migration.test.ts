import { describe, expect, it } from 'vitest'
import { generateMigration } from '../src/codegen/index.js'
import { diffReport } from '../src/diff.js'
import { object, scalar } from '../src/shape.js'

describe('generateMigration (migration codegen on drift)', () => {
  it('emits before/after types and a change checklist', () => {
    const from = object({ id: scalar('number'), name: scalar('string') })
    const to = object({ id: scalar('string'), name: scalar('string') }) // id retyped
    const report = diffReport('GET /api/users', from, to)

    const out = generateMigration(report, from, to)
    expect(out).toContain('GetApiUsersBefore')
    expect(out).toContain('GetApiUsersAfter')
    expect(out).toContain('type_changed')
    expect(out).toMatch(/id: number/) // before
    expect(out).toMatch(/id: string/) // after
  })
})
