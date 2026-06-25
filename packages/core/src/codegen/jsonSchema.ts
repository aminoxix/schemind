import { isNull, isUnknown } from '../shape.js'
import type { ShapeNode } from '../types.js'
import { endpointToTypeName, nameAllocator } from './naming.js'
import type { CodegenSnapshot } from './types.js'

/** A JSON Schema (or OpenAPI Schema) fragment. */
export type JsonSchema = Record<string, unknown>

export interface JsonSchemaOptions {
  /** Emit OpenAPI 3.0 flavor (`nullable: true` instead of a `null` type). */
  openapi?: boolean
}

/** Convert a {@link ShapeNode} into a JSON Schema (draft-07) or OpenAPI 3.0 fragment. */
export function shapeToJsonSchema(node: ShapeNode, options: JsonSchemaOptions = {}): JsonSchema {
  const openapi = options.openapi ?? false
  switch (node.kind) {
    case 'scalar':
      if (node.type === 'null') return openapi ? { nullable: true } : { type: 'null' }
      return { type: node.type }
    case 'array':
      return {
        type: 'array',
        items: isUnknown(node.items) ? {} : shapeToJsonSchema(node.items, options),
      }
    case 'object': {
      const keys = Object.keys(node.fields)
      const properties: Record<string, JsonSchema> = {}
      for (const key of keys) properties[key] = shapeToJsonSchema(node.fields[key]!, options)
      return { type: 'object', properties, required: keys, additionalProperties: false }
    }
    case 'union': {
      if (node.types.length === 0) return {} // unknown → any
      const nonNull = node.types.filter((t) => !isNull(t))
      const nullable = node.types.some(isNull)
      if (nonNull.length === 0) return openapi ? { nullable: true } : { type: 'null' }

      const schemas = nonNull.map((t) => shapeToJsonSchema(t, options))
      const base: JsonSchema = schemas.length === 1 ? schemas[0]! : { anyOf: schemas }
      if (!nullable) return base
      return openapi ? { ...base, nullable: true } : { anyOf: [...schemas, { type: 'null' }] }
    }
  }
}

/** A draft-07 bundle: one schema per endpoint under `$defs`. */
export function generateJsonSchema(snapshots: readonly CodegenSnapshot[]): JsonSchema {
  const allocate = nameAllocator()
  const defs: Record<string, JsonSchema> = {}
  for (const snap of snapshots) {
    defs[allocate(snap.endpoint)] = shapeToJsonSchema(snap.shape)
  }
  return { $schema: 'http://json-schema.org/draft-07/schema#', $defs: defs }
}

export interface OpenApiInfo {
  title?: string
  version?: string
}

/** A full OpenAPI 3.0.3 document: `paths` + `components.schemas` from observed shapes. */
export function generateOpenApi(
  snapshots: readonly CodegenSnapshot[],
  info: OpenApiInfo = {},
): JsonSchema {
  const schemas: Record<string, JsonSchema> = {}
  const paths: Record<string, Record<string, unknown>> = {}

  for (const snap of snapshots) {
    const name = endpointToTypeName(snap.endpoint)
    schemas[name] = shapeToJsonSchema(snap.shape, { openapi: true })

    const { method, path, params } = parseEndpoint(snap.endpoint)
    const operation: Record<string, unknown> = {
      responses: {
        '200': {
          description: 'Observed by schemind',
          content: { 'application/json': { schema: { $ref: `#/components/schemas/${name}` } } },
        },
      },
    }
    if (params.length > 0) {
      operation.parameters = params.map((p) => ({
        name: p,
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }))
    }
    paths[path] ??= {}
    paths[path]![method] = operation
  }

  return {
    openapi: '3.0.3',
    info: { title: info.title ?? 'schemind-observed API', version: info.version ?? '0.0.0' },
    paths,
    components: { schemas },
  }
}

function parseEndpoint(endpoint: string): { method: string; path: string; params: string[] } {
  const space = endpoint.search(/\s/)
  const method = (space === -1 ? endpoint : endpoint.slice(0, space)).toLowerCase()
  let rawPath = space === -1 ? '/' : endpoint.slice(space + 1)
  // Strip an origin if endpoints were keyed with one.
  try {
    rawPath = new URL(rawPath).pathname
  } catch {
    /* relative path — already a pathname */
  }
  const params: string[] = []
  const path = rawPath.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) => {
    params.push(name)
    return `{${name}}`
  })
  return { method, path, params }
}
