import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/ui/tracing/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
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
