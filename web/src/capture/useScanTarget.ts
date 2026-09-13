import { useLocation } from 'react-router-dom'
import { useHouseholdStore } from '../stores/householdStore'
import type { ScanTarget } from './queue/reducer'

const PROJECT_DETAIL_PATH = /^\/projects\/(?!new$)([^/]+)$/

/** Scopes a scan to whatever project page it's tapped from, falling back to the
 * current household — shared by the phone tab bar's Scan action and the desktop
 * sidebar's (spec 004 ticket 9's "scoped to whatever project page" rule). */
export function useScanTarget(): ScanTarget | null {
  const location = useLocation()
  const household = useHouseholdStore((s) => s.household)

  const projectMatch = location.pathname.match(PROJECT_DETAIL_PATH)
  return projectMatch
    ? { projectId: projectMatch[1]! }
    : household
      ? { householdId: household.id }
      : null
}
