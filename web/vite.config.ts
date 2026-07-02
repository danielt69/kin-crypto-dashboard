import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-time proxy so the browser talks same-origin and the frontend never
// needs to know where the API lives (nginx plays the same role in docker).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/health': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
