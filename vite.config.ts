/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Receivia',
        short_name: 'Receivia',
        description: 'Collections and cash-flow for small businesses',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#3f3f46',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only. Business data is never cached by the service worker; the app keeps its
        // own per-user copy of the forecast inputs (src/lib/offline.ts) and deletes it on sign-out.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/functions\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 3_000_000,
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // index.html is always fetched from the network first so a new deploy is never hidden by the cache.
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: { cacheName: 'html', networkTimeoutSeconds: 3 },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Pre-bundle every dependency at start-up so the dev server never re-optimises mid-session
  // (which reloads the page in a loop when a lazily imported screen pulls in a new package).
  optimizeDeps: {
    include: [
      '@hookform/resolvers/zod',
      '@supabase/supabase-js',
      '@tanstack/react-query',
      'fast-xml-parser',
      'i18next',
      'qrcode',
      'react',
      'react-dom',
      'react-dom/client',
      'react-hook-form',
      'react-i18next',
      'react-router-dom',
      'xlsx',
      'zod',
    ],
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tests/ai-evals/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
    environment: 'node',
  },
});
