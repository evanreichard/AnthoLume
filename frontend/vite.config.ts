import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: ['lin-va-terminal'],
    proxy: {
      '/api': {
        target: 'http://localhost:8585',
        changeOrigin: true,
      },
      '/assets': {
        target: 'http://localhost:8585',
        changeOrigin: true,
      },
      '/manifest.json': {
        target: 'http://localhost:8585',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
