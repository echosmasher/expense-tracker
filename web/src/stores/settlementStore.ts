import { create } from 'zustand'
import type { Settlement } from '@expense-tracker/shared'

interface SettlementState {
  currentSettlement: Settlement | null
  history: Settlement[]
  setCurrentSettlement: (s: Settlement | null) => void
  setHistory: (history: Settlement[]) => void
  updateTransaction: (settlementId: string, transactionId: string, paidAt: string) => void
}

export const useSettlementStore = create<SettlementState>((set) => ({
  currentSettlement: null,
  history: [],
  setCurrentSettlement: (currentSettlement) => set({ currentSettlement }),
  setHistory: (history) => set({ history }),
  updateTransaction: (settlementId, transactionId, paidAt) =>
    set((state) => {
      if (state.currentSettlement?.id !== settlementId) return {}
      const transactions = state.currentSettlement.transactions.map((t) =>
        t.id === transactionId ? { ...t, paidAt } : t
      )
      return { currentSettlement: { ...state.currentSettlement, transactions } }
    }),
}))
