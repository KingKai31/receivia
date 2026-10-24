/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
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
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
