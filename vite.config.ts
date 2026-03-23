/**
 * Vite Configuration for UI Components
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src/ui/tracing-dashboard',
  build: {
    outDir: resolve(__dirname, 'dist/ui/tracing'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/ui/tracing-dashboard/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/traces': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
