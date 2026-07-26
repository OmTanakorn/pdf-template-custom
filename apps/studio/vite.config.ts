import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The studio never renders PDFs itself — Chromium lives in the API process.
    proxy: { '/api': 'http://localhost:8787' },
  },
});
