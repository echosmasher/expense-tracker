import { create } from 'zustand'
import type { Statistics } from '@expense-tracker/shared'

interface StatsState {
  stats: Statistics | null
  includePersonal: boolean
  setStats: (stats: Statistics | null) => void
  setIncludePersonal: (v: boolean) => void
}

export const useStatsStore = create<StatsState>((set) => ({
  stats: null,
  includePersonal: false,
  setStats: (stats) => set({ stats }),
  setIncludePersonal: (includePersonal) => set({ includePersonal }),
}))
