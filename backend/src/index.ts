import { config } from './config.js'
import http from 'http'
import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import { router } from './api/router.js'
import { errorHandler } from './api/middleware/error.js'
import { createWsServer } from './ws/server.js'
import { ensureBucket } from './storage/minio.js'
import { db } from './db/client.js'

const app = express()
const server = http.createServer(app)

// In prod, nginx is the single reverse-proxy hop in front of the API.
// Without this, rate limiting would key on the nginx container IP.
app.set('trust proxy', 1)

// Middleware
app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }))
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

// Request logger
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.path}`)
  next()
})

// Routes
app.get('/health', (_req, res) => res.json({ status: 'ok' }))
app.use('/api/v1', router)

// Error handler (must be last)
app.use(errorHandler)

// WebSocket server attached to same HTTP server
const wss = createWsServer(server)

async function start() {
  await ensureBucket()
  server.listen(config.PORT, () => {
    console.log(`API + WS server listening on port ${config.PORT}`)
  })
}

let isShuttingDown = false

async function shutdown(signal: string) {
  if (isShuttingDown) return
  isShuttingDown = true
  console.log(`Received ${signal}, shutting down...`)

  // Hard timeout: if cleanup hangs, exit anyway. Docker SIGKILLs at 10s by default.
  const forceExit = setTimeout(() => {
    console.error('Forced shutdown after 8s — cleanup hung')
    process.exit(1)
  }, 8_000)
  forceExit.unref()

  // Terminate WS clients (they'll reconnect via the client's normal logic)
  for (const client of wss.clients) client.terminate()
  wss.close()

  server.close(async (err) => {
    if (err) console.error('Error closing HTTP server:', err)
    try {
      await db.end()
      console.log('Shutdown complete.')
      clearTimeout(forceExit)
      process.exit(err ? 1 : 0)
    } catch (poolErr) {
      console.error('Error closing DB pool:', poolErr)
      process.exit(1)
    }
  })
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

start().catch((err) => {
  console.error('Startup failed:', err)
  process.exit(1)
})

export { app, server }
