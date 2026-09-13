import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // The manifest and icons already live in public/ (checked in, not generated)
      // so this plugin's job is the service worker: precache the shell, fall back
      // to it for navigations, and never cache anything under /api/.
      manifest: false,
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /\/api\//,
            handler: 'NetworkOnly',
          },
        ],
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  server: {
    port: 3000,
    proxy: {
      '/api': process.env.VITE_API_URL ?? 'http://localhost:3001',
      '/ws': { target: process.env.VITE_WS_URL ?? 'ws://localhost:3001', ws: true },
    },
  },
})
