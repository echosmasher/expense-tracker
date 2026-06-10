import { config } from './config.js'
import http from 'http'
import { app } from './app.js'
import { ensureBucket } from './storage/minio.js'
import { db } from './db/client.js'
import { logger } from './logger.js'

const server = http.createServer(app)

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
