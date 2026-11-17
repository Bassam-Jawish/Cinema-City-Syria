import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The API's port in development: DEFAULT_DEV_PORT in server/config.ts, not the demo server's 4000, so a
// demo left running cannot serve this site. Not PORT: tools set that for the web app.
const API_PORT = Number(process.env.API_PORT ?? 4100);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  // Pre-bundle every heavy dependency up front, so Vite never re-optimises mid-session
  // (which would load two copies of React into an open page).
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react-router',
      'three',
      'three/addons/geometries/RoundedBoxGeometry.js',
      'three/addons/utils/BufferGeometryUtils.js',
      'three/addons/lights/RectAreaLightUniformsLib.js',
      '@react-three/fiber',
      '@react-three/drei',
      'motion/react',
      'zustand',
      'lucide-react',
      'qrcode',
      'clsx',
    ],
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      // The API (and its Server-Sent Events stream) lives on the Node server.
      '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: 'node',
    include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
