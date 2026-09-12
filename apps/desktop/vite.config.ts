import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => ({
  define: { __SAMPLE_BUILD__: JSON.stringify(mode === 'sample') },
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
}));
