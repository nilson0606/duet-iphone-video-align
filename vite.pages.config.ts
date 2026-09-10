import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';

// A separate static build shares the editor without loading Sites server plugins.
export default defineConfig({
  root: fileURLToPath(new URL('./static-entry', import.meta.url)),
  base: process.env.PAGES_BASE_PATH || '/',
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  build: {
    outDir: fileURLToPath(new URL('./dist-pages', import.meta.url)),
    emptyOutDir: true,
  },
});
