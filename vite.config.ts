import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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