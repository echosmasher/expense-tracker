import type { IncomingMessage, Server } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import jwt from 'jsonwebtoken'

interface AuthUser {
  userId: string
  email: string
}

interface AuthenticatedSocket extends WebSocket {
  userId?: string
  householdIds?: Set<string>
  isAlive: boolean
}

// householdId → Set of authenticated sockets
const rooms = new Map<string, Set<AuthenticatedSocket>>()

function addToRoom(householdId: string, socket: AuthenticatedSocket) {
  if (!rooms.has(householdId)) rooms.set(householdId, new Set())
  rooms.get(householdId)!.add(socket)
}

function removeFromAllRooms(socket: AuthenticatedSocket) {
  for (const [householdId, sockets] of rooms) {
    sockets.delete(socket)
    if (sockets.size === 0) rooms.delete(householdId)
  }
}

export type WsEvent =
  | { type: 'expense.confirmed'; householdId: string; expenseId: string; confirmedBy: string }
  | { type: 'settlement.ready'; householdId: string; settlementId: string }
  | { type: 'settlement.completed'; householdId: string; settlementId: string }
  | { type: 'project.settlement.ready'; householdId: string; projectId: string; settlementId: string }
  | { type: 'settlement.transaction.updated'; settlementId: string; transactionId: string; paidAt: string }

/** Broadcast an event to all authenticated members of a household. */
export function broadcast(householdId: string, event: WsEvent) {
  const sockets = rooms.get(householdId)
  if (!sockets) return
  const payload = JSON.stringify(event)
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload)
    }
  }
}

export function createWsServer(httpServer: Server) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

  // Heartbeat: drop dead connections every 30s
  const pingInterval = setInterval(() => {
    wss.clients.forEach((rawSocket) => {
      const socket = rawSocket as AuthenticatedSocket
      if (!socket.isAlive) {
        removeFromAllRooms(socket)
        socket.terminate()
        return
      }
      socket.isAlive = false
      socket.ping()
    })
  }, 30_000)

  wss.on('close', () => clearInterval(pingInterval))

  wss.on('connection', (rawSocket: WebSocket, _req: IncomingMessage) => {
    const socket = rawSocket as AuthenticatedSocket
    socket.isAlive = true
    socket.householdIds = new Set()

    // Require auth within 10 seconds
    const authTimeout = setTimeout(() => {
      if (!socket.userId) {
        socket.close(4001, 'Authentication timeout')
      }
    }, 10_000)

    socket.on('pong', () => { socket.isAlive = true })

    socket.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as unknown
        if (
          typeof msg !== 'object' ||
          msg === null ||
          (msg as Record<string, unknown>).type !== 'auth'
        ) return

        const token = (msg as Record<string, unknown>).accessToken
        if (typeof token !== 'string') return

        const secret = process.env.JWT_ACCESS_SECRET!
        const payload = jwt.verify(token, secret) as AuthUser
        socket.userId = payload.userId
        clearTimeout(authTimeout)

        socket.send(JSON.stringify({ type: 'auth.ok', userId: payload.userId }))
      } catch {
        socket.send(JSON.stringify({ type: 'auth.error', message: 'Invalid token' }))
      }
    })

    socket.on('close', () => {
      clearTimeout(authTimeout)
      removeFromAllRooms(socket)
    })
  })

  return wss
}

/** Register a socket for a household room (call after household membership is confirmed). */
export function joinHouseholdRoom(householdId: string, socket: AuthenticatedSocket) {
  socket.householdIds?.add(householdId)
  addToRoom(householdId, socket)
}
