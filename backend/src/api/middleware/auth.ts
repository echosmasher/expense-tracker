import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

export interface AuthUser {
  userId: string
  email: string
}

declare global {
  // Express types are extended via namespace merging — the only way to add req.user.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } })
    return
  }

  const token = authHeader.slice(7)
  try {
    const secret = process.env.JWT_ACCESS_SECRET
    if (!secret) throw new Error('JWT_ACCESS_SECRET not configured')
    const payload = jwt.verify(token, secret) as AuthUser & { iat: number; exp: number }
    req.user = { userId: payload.userId, email: payload.email }
    next()
  } catch {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } })
  }
}
