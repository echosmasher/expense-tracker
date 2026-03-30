import { create } from 'zustand'
import { setAccessToken } from '@expense-tracker/shared'

interface AuthState {
  userId: string | null
  email: string | null
  name: string | null
  isAuthenticated: boolean
  setUser: (user: { id: string; email: string; name: string }, token: string) => void
  clearUser: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  userId: null,
  email: null,
  name: null,
  isAuthenticated: false,

  setUser: (user, token) => {
    setAccessToken(token)
    set({ userId: user.id, email: user.email, name: user.name, isAuthenticated: true })
  },

  clearUser: () => {
    setAccessToken('')
    set({ userId: null, email: null, name: null, isAuthenticated: false })
  },
}))
