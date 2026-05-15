import { config } from './config.js'
import http from 'http'
import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import { router } from './api/router.js'
import { errorHandler } from './api/middleware/error.js'
import { createWsServer } from './ws/server.js'

const app = express()
const server = http.createServer(app)

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
createWsServer(server)

server.listen(config.PORT, () => {
  console.log(`API + WS server listening on port ${config.PORT}`)
})

export { app, server }
