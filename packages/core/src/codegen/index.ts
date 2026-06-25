/**
 * Code generation from observed shapes. Walk a {@link ShapeNode} → emit:
 * - TypeScript interfaces ({@link generateTypeScript})
 * - JSON Schema / OpenAPI ({@link generateJsonSchema} / {@link generateOpenApi})
 * - MSW handlers ({@link generateMsw})
 *
 * All pure string/object generation — browser-safe, no I/O.
 */
export { endpointToTypeName, isSafeKey, nameAllocator } from './naming.js'
export {
  generateTypeScript,
  shapeToTypeScript,
  type TypeScriptOptions,
} from './typescript.js'
export {
  generateJsonSchema,
  generateOpenApi,
  shapeToJsonSchema,
  type JsonSchema,
  type JsonSchemaOptions,
  type OpenApiInfo,
} from './jsonSchema.js'
export { generateMsw, mockFromShape } from './msw.js'
export { shapeFromJsonSchema, seedFromOpenApi } from './fromJsonSchema.js'
export { generateMigration } from './migration.js'
export type { CodegenSnapshot } from './types.js'
