import { UNKNOWN, array, object, scalar, union } from '../shape.js'
import type { ShapeNode } from '../types.js'
import type { CodegenSnapshot } from './types.js'

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const NULL: ShapeNode = scalar('null')
const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head'])

/**
 * Convert a JSON Schema / OpenAPI Schema fragment into a {@link ShapeNode} — the
 * inverse of {@link shapeToJsonSchema}. Resolves local `$ref`s against `root`,
 * handles `nullable`, `anyOf`/`oneOf`/`allOf`, and type arrays.
 */
export function shapeFromJsonSchema(schema: unknown, root: Obj = {}): ShapeNode {
  return convert(schema, root, new Set())
}

function convert(schema: unknown, root: Obj, seen: ReadonlySet<string>): ShapeNode {
  if (!isObj(schema)) return UNKNOWN

  if (typeof schema.$ref === 'string') {
    const resolved = resolveRef(schema.$ref, root, seen)
    return resolved ? convert(resolved.node, root, resolved.seen) : UNKNOWN
  }

  if (Array.isArray(schema.anyOf))
    return wrapNullable(union(schema.anyOf.map((s) => convert(s, root, seen))), schema)
  if (Array.isArray(schema.oneOf))
    return wrapNullable(union(schema.oneOf.map((s) => convert(s, root, seen))), schema)
  if (Array.isArray(schema.allOf))
    return wrapNullable(mergeObjects(schema.allOf.map((s) => convert(s, root, seen))), schema)

  if (Array.isArray(schema.type)) {
    return union(schema.type.map((t) => scalarFor(String(t))))
  }

  let node: ShapeNode
  switch (schema.type) {
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
    case 'null':
      node = scalarFor(schema.type)
      break
    case 'array':
      node = array(schema.items !== undefined ? convert(schema.items, root, seen) : UNKNOWN)
      break
    case 'object':
      node = objectFrom(schema, root, seen)
      break
    default:
      node = isObj(schema.properties) ? objectFrom(schema, root, seen) : UNKNOWN
  }
  return wrapNullable(node, schema)
}

function scalarFor(type: string): ShapeNode {
  switch (type) {
    case 'integer':
    case 'number':
      return scalar('number')
    case 'boolean':
      return scalar('boolean')
    case 'null':
      return NULL
    default:
      return scalar('string')
  }
}

function objectFrom(schema: Obj, root: Obj, seen: ReadonlySet<string>): ShapeNode {
  const props = isObj(schema.properties) ? schema.properties : {}
  const fields: Record<string, ShapeNode> = {}
  for (const [key, value] of Object.entries(props)) fields[key] = convert(value, root, seen)
  return object(fields)
}

function mergeObjects(nodes: ShapeNode[]): ShapeNode {
  const fields: Record<string, ShapeNode> = {}
  for (const n of nodes) if (n.kind === 'object') Object.assign(fields, n.fields)
  return object(fields)
}

function wrapNullable(node: ShapeNode, schema: Obj): ShapeNode {
  return schema.nullable === true ? union([node, NULL]) : node
}

function resolveRef(
  ref: string,
  root: Obj,
  seen: ReadonlySet<string>,
): { node: unknown; seen: ReadonlySet<string> } | null {
  if (!ref.startsWith('#/') || seen.has(ref)) return null // external or cyclic
  let cur: unknown = root
  for (const part of ref.slice(2).split('/')) {
    if (!isObj(cur)) return null
    cur = cur[part.replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  if (cur === undefined) return null
  return { node: cur, seen: new Set(seen).add(ref) }
}

/**
 * Seed baselines from an OpenAPI document — turn each operation's 2xx JSON
 * response schema into a `{ endpoint, shape }` pair. Lets teams with an existing
 * spec start without observing live traffic.
 */
export function seedFromOpenApi(doc: unknown): CodegenSnapshot[] {
  if (!isObj(doc) || !isObj(doc.paths)) return []
  const seeds: CodegenSnapshot[] = []
  for (const [path, methods] of Object.entries(doc.paths)) {
    if (!isObj(methods)) continue
    for (const [method, operation] of Object.entries(methods)) {
      if (!HTTP_METHODS.has(method.toLowerCase()) || !isObj(operation)) continue
      const schema = pickResponseSchema(operation)
      if (schema === undefined) continue
      seeds.push({
        endpoint: `${method.toUpperCase()} ${openApiPathToKey(path)}`,
        shape: shapeFromJsonSchema(schema, doc),
      })
    }
  }
  return seeds
}

function pickResponseSchema(operation: Obj): unknown {
  if (!isObj(operation.responses)) return undefined
  const responses = operation.responses
  const status =
    Object.keys(responses).find((s) => /^2\d\d$/.test(s)) ??
    (responses['2XX'] !== undefined ? '2XX' : undefined) ??
    (responses.default !== undefined ? 'default' : undefined)
  if (status === undefined) return undefined
  const response = responses[status]
  if (!isObj(response) || !isObj(response.content)) return undefined
  for (const [mediaType, media] of Object.entries(response.content)) {
    if (/\bjson\b/i.test(mediaType) && isObj(media)) return media.schema
  }
  return undefined
}

/** `/users/{id}` → `/users/:id` to match schemind's endpoint keys. */
function openApiPathToKey(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ':$1')
}
