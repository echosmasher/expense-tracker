import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { config } from './config.js'
import { router } from './api/router.js'
import { errorHandler } from './api/middleware/error.js'
import { db } from './db/client.js'
import { logger } from './logger.js'

const app = express()

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

export { app }
