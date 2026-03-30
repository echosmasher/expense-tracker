import { create } from 'zustand'
import type { Expense } from '@expense-tracker/shared'

interface ExpenseState {
  expenses: Expense[]
  setExpenses: (expenses: Expense[]) => void
  addOrUpdateExpense: (expense: Expense) => void
}

export const useExpenseStore = create<ExpenseState>((set) => ({
  expenses: [],
  setExpenses: (expenses) => set({ expenses }),
  addOrUpdateExpense: (expense) =>
    set((state) => {
      const idx = state.expenses.findIndex((e) => e.id === expense.id)
      if (idx >= 0) {
        const updated = [...state.expenses]
        updated[idx] = expense
        return { expenses: updated }
      }
      return { expenses: [expense, ...state.expenses] }
    }),
}))
