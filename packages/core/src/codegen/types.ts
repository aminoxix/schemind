import type { ShapeNode } from '../types.js'

/** The minimal slice of a {@link Snapshot} the code generators consume. */
export interface CodegenSnapshot {
  endpoint: string
  shape: ShapeNode
}
