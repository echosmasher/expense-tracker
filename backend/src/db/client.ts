import pg from 'pg'
import { logger } from '../logger.js'

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error')
})

export const db = {
  /**
   * Execute a typed query. All monetary values must be integers (øre).
   * No ORM — use explicit SQL.
   */
  async query<T extends pg.QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<pg.QueryResult<T>> {
    const start = Date.now()
    const result = await pool.query<T>(text, values)
    const duration = Date.now() - start
    if (duration > 1000) {
      logger.warn({ durationMs: duration, query: text.slice(0, 120) }, 'Slow query')
    }
    return result
  },

  /** Acquire a client for multi-statement transactions. */
  async transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  },

  /** Close the pool. Call once during graceful shutdown. */
  async end(): Promise<void> {
    await pool.end()
  },
}

export type DbClient = typeof db
