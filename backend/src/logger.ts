import { pino } from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // Redact secrets if they ever end up in a logged object.
  redact: ['*.password', '*.token', '*.accessToken', '*.refreshToken', '*.authorization'],
})
