import 'dotenv/config'
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
app.use(cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', credentials: true }))
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

const PORT = parseInt(process.env.PORT ?? '3001', 10)
server.listen(PORT, () => {
  console.log(`API + WS server listening on port ${PORT}`)
})

export { app, server }
