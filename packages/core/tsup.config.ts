import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/node.ts',
    'src/cli.ts',
    'src/express.ts',
    'src/next.ts',
    'src/hono.ts',
    'src/tanstack.ts',
  ],
  format: ['esm'],
  target: 'node18',
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  minify: false,
})
