import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
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
});
