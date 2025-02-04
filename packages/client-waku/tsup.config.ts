import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  format: ['esm'],
  // Externalize any built-in or native modules:
  external: [
    'fs',
    'path',
    'crypto'
  ]
});
