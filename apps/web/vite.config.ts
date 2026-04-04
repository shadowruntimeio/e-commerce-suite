import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  define: {
    // Make API base URL available at build time for production
    __API_URL__: JSON.stringify(process.env.VITE_API_URL ?? ''),
  },
})
