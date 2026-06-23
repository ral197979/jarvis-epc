/**
 * Denver Engineering — Shared pino logger
 * Import this in service files that need structured logging.
 */
import pino from 'pino'

export const log = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  // pino-pretty only in local development — staging and production use structured JSON
  ...(process.env['NODE_ENV'] === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
})
