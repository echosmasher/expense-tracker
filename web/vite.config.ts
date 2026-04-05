import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': process.env.VITE_API_URL ?? 'http://localhost:3001',
      '/ws': { target: process.env.VITE_WS_URL ?? 'ws://localhost:3001', ws: true },
    },
  },
})
