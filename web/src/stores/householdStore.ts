import { create } from 'zustand'
import type { Household } from '@expense-tracker/shared'

interface HouseholdState {
  household: Household | null
  setHousehold: (h: Household | null) => void
}

export const useHouseholdStore = create<HouseholdState>((set) => ({
  household: null,
  setHousehold: (household) => set({ household }),
}))
