/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js', '@supabase/ssr'],
          papaparse: ['papaparse'],
          icons: ['lucide-react'],
        },
      },
    },
  },
  server: {
    proxy: {
      // Coincall
      '/coincall': {
        target: 'https://api.coincall.com',
        changeOrigin: true,
        rewrite: p => p.replace(/^\/coincall/, ''),
      },
      // Deribit HTTP JSON-RPC
      '/deribit': {
        target: 'https://www.deribit.com/api/v2',
        changeOrigin: true,
        rewrite: p => p.replace(/^\/deribit/, ''),
      },
    },
  },
});