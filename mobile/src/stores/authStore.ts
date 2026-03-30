import { create } from 'zustand'
import * as SecureStore from 'expo-secure-store'
import { setAccessToken } from '@expense-tracker/shared'

const TOKEN_KEY = 'access_token'

interface AuthState {
  userId: string | null
  email: string | null
  name: string | null
  isAuthenticated: boolean
  setUser: (user: { id: string; email: string; name: string }, token: string) => void
  clearUser: () => void
  restoreToken: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  userId: null,
  email: null,
  name: null,
  isAuthenticated: false,

  setUser: (user, token) => {
    setAccessToken(token)
    SecureStore.setItemAsync(TOKEN_KEY, token).catch(() => {})
    set({ userId: user.id, email: user.email, name: user.name, isAuthenticated: true })
  },

  clearUser: () => {
    setAccessToken('')
    SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {})
    set({ userId: null, email: null, name: null, isAuthenticated: false })
  },

  restoreToken: async () => {
    try {
      const token = await SecureStore.getItemAsync(TOKEN_KEY)
      if (token) {
        setAccessToken(token)
        set({ isAuthenticated: true })
      }
    } catch {
      // SecureStore unavailable — stay logged out
    }
  },
}))
