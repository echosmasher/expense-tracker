import { create } from 'zustand'
import { auth, users, setAccessToken } from '@expense-tracker/shared'

type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated'

interface AuthState {
  userId: string | null
  email: string | null
  name: string | null
  status: SessionStatus
  setUser: (user: { id: string; email: string; name: string }, token: string) => void
  clearUser: () => void
  restoreSession: () => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  userId: null,
  email: null,
  name: null,
  status: 'loading',

  setUser: (user, token) => {
    setAccessToken(token)
    set({ userId: user.id, email: user.email, name: user.name, status: 'authenticated' })
  },

  clearUser: () => {
    setAccessToken('')
    set({ userId: null, email: null, name: null, status: 'unauthenticated' })
  },

  restoreSession: async () => {
    try {
      const { accessToken } = await auth.refresh()
      setAccessToken(accessToken)
      const profile = await users.me()
      set({ userId: profile.id, email: profile.email, name: profile.name, status: 'authenticated' })
    } catch {
      setAccessToken('')
      set({ userId: null, email: null, name: null, status: 'unauthenticated' })
    }
  },

  logout: async () => {
    try {
      await auth.logout()
    } catch {
      // best-effort — the cookie may already be gone; local state is cleared regardless
    }
    setAccessToken('')
    set({ userId: null, email: null, name: null, status: 'unauthenticated' })
  },
}))
