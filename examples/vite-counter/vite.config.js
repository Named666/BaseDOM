import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { basedom } from '../../vite/plugin.js';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [basedom()],
  resolve: {
    alias: {
      basedom: path.resolve(root, '../..')
    }
  },
  build: {
    outDir: path.resolve(root, '../../dist/vite-counter'),
    emptyOutDir: true
  }
});
