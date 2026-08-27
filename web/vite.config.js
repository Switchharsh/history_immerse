import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The engine runs separately; proxying keeps the browser same-origin so there is no
    // CORS or App Check surprise in dev that wouldn't happen in production.
    proxy: {
      '/api': {
        target: process.env.PARLEY_API ?? 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
