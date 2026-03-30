import pg from 'pg'

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err)
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
      console.warn(`Slow query (${duration}ms):`, text.slice(0, 120))
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
}

export type DbClient = typeof db
