import type { ShapeNode } from './types.js'

/**
 * Remove fields from a {@link ShapeNode} whose **path** matches a suppression
 * pattern — depth-aware noise control beyond `ignore` (which drops by name at
 * any depth). Paths use the diff engine's format: `.` between object fields and
 * `[]` for array levels, e.g. `data[].author.name`.
 *
 * Pattern syntax:
 * - `updatedAt` — that field at the root only
 * - `*.updatedAt` — `updatedAt` one level deep (`*` = one field segment)
 * - `**.timestamp` — `timestamp` at any depth (`**` = anything)
 * - `items[].requestId` — `requestId` inside an array's items
 */
export function prunePaths(node: ShapeNode, patterns: readonly string[]): ShapeNode {
  if (patterns.length === 0) return node
  const matchers = patterns.map(compile)
  return walk(node, '', matchers)
}

function walk(node: ShapeNode, path: string, matchers: readonly RegExp[]): ShapeNode {
  switch (node.kind) {
    case 'object': {
      const fields: Record<string, ShapeNode> = {}
      for (const [key, child] of Object.entries(node.fields)) {
        const childPath = path ? `${path}.${key}` : key
        if (matchers.some((m) => m.test(childPath))) continue // suppressed
        fields[key] = walk(child, childPath, matchers)
      }
      return { kind: 'object', fields }
    }
    case 'array':
      return { kind: 'array', items: walk(node.items, `${path}[]`, matchers) }
    case 'union':
      return { kind: 'union', types: node.types.map((t) => walk(t, path, matchers)) }
    default:
      return node
  }
}

function compile(pattern: string): RegExp {
  const tokens: string[] = []
  let i = 0
  while (i < pattern.length) {
    if (pattern.startsWith('[]', i)) {
      tokens.push('\\[\\]')
      i += 2
    } else if (pattern.startsWith('**', i)) {
      tokens.push('.*')
      i += 2
    } else if (pattern[i] === '*') {
      tokens.push('[^.\\[\\]]+')
      i += 1
    } else if (pattern[i] === '.') {
      tokens.push('\\.')
      i += 1
    } else {
      tokens.push(pattern[i]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      i += 1
    }
  }
  return new RegExp(`^${tokens.join('')}$`)
}
