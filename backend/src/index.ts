import { config } from './config.js'
import http from 'http'
import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { router } from './api/router.js'
import { errorHandler } from './api/middleware/error.js'
import { ensureBucket } from './storage/minio.js'
import { db } from './db/client.js'
import { logger } from './logger.js'

const app = express()
const server = http.createServer(app)

// In prod, nginx is the single reverse-proxy hop in front of the API.
// Without this, rate limiting would key on the nginx container IP.
app.set('trust proxy', 1)

// Middleware
app.use(helmet())
app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }))
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

// Structured request logging with auto-generated request IDs.
// req.log is request-scoped and includes the ID, so downstream logs correlate.
app.use(pinoHttp({ logger }))

// Routes
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1')
    res.json({ status: 'ok' })
  } catch (err) {
    req.log.error({ err }, 'Health check failed')
    res.status(503).json({ status: 'unhealthy', reason: 'database unreachable' })
  }
})
app.use('/api/v1', router)

// Error handler (must be last)
app.use(errorHandler)

async function start() {
  await ensureBucket()
  server.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'API server listening')
  })
}

let isShuttingDown = false

async function shutdown(signal: string) {
  if (isShuttingDown) return
  isShuttingDown = true
  logger.info({ signal }, 'Shutting down')

  // Hard timeout: if cleanup hangs, exit anyway. Docker SIGKILLs at 10s by default.
  const forceExit = setTimeout(() => {
    logger.error('Forced shutdown after 8s — cleanup hung')
    process.exit(1)
  }, 8_000)
  forceExit.unref()

  server.close(async (err) => {
    if (err) logger.error({ err }, 'Error closing HTTP server')
    try {
      await db.end()
      logger.info('Shutdown complete')
      clearTimeout(forceExit)
      process.exit(err ? 1 : 0)
    } catch (poolErr) {
      logger.error({ err: poolErr }, 'Error closing DB pool')
      process.exit(1)
    }
  })
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

start().catch((err) => {
  logger.fatal({ err }, 'Startup failed')
  process.exit(1)
})

export { app, server }
