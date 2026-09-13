import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'

// Layout
import { AppShell } from './components/AppShell'
import { SplashScreen } from './components/SplashScreen'
import { More } from './pages/More'

// Auth
import { Login } from './pages/Auth/Login'
import { AcceptInvite } from './pages/Auth/AcceptInvite'

// Onboarding
import { CreateHousehold } from './pages/Onboarding/CreateHousehold'

// Expenses
import { ExpenseList } from './pages/Expenses/ExpenseList'
import { ExpenseDetail } from './pages/Expenses/ExpenseDetail'
import { AddExpense } from './pages/Expenses/AddExpense'
import { ReviewDraft } from './pages/Expenses/ReviewDraft'

// Settlement
import { ActiveSettlement } from './pages/Settlement/Active'
import { History } from './pages/Settlement/History'

// Projects
import { ProjectList } from './pages/Projects/ProjectList'
import { ProjectDetail } from './pages/Projects/ProjectDetail'
import { CreateProject } from './pages/Projects/CreateProject'

// Statistics
import { MonthlyOverview } from './pages/Statistics/MonthlyOverview'
import { CategoryTrends } from './pages/Statistics/CategoryTrends'

// Settings
import { MembersAndCards } from './pages/Settings/MembersAndCards'
import { ProfileSettings } from './pages/Settings/ProfileSettings'
import { CategorySettings } from './pages/Settings/CategorySettings'

// ─── Guards ───────────────────────────────────────────────────────────────────

function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status)
  const location = useLocation()
  return status === 'authenticated'
    ? <>{children}</>
    : <Navigate to="/login" state={{ from: location }} replace />
}

function RequireGuest({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status)
  return status !== 'authenticated' ? <>{children}</> : <Navigate to="/home" replace />
}

// A session restore is in flight until proven otherwise — the routes below never render
// until the outcome is known, so the login page can't flash in front of a resumed session.
function SessionGate({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status)
  const restoreSession = useAuthStore((s) => s.restoreSession)

  useEffect(() => {
    restoreSession()
  }, [restoreSession])

  if (status === 'loading') return <SplashScreen />
  return <>{children}</>
}

// ─── App ─────────────────────────────────────────────────────────────────────

export function App() {
  return (
    <BrowserRouter>
      <SessionGate>
        <Routes>
          {/* Public auth routes */}
          <Route path="/login" element={<RequireGuest><Login /></RequireGuest>} />
          <Route path="/accept-invite" element={<AcceptInvite />} />

          {/* Main app with sidebar navigation */}
          <Route element={<RequireAuth><AppShell /></RequireAuth>}>
            <Route path="/home" element={<ExpenseList />} />
            <Route path="/expenses" element={<ExpenseList />} />
            <Route path="/expenses/new" element={<AddExpense />} />
            <Route path="/expenses/:expenseId/review" element={<ReviewDraft />} />
            <Route path="/expenses/:expenseId" element={<ExpenseDetail />} />
            <Route path="/projects/:projectId/expenses/:expenseId/review" element={<ReviewDraft />} />

            <Route path="/settlement" element={<ActiveSettlement />} />
            <Route path="/settlement/history" element={<History />} />

            <Route path="/projects" element={<ProjectList />} />
            <Route path="/projects/new" element={<CreateProject />} />
            <Route path="/projects/:projectId" element={<ProjectDetail />} />

            <Route path="/statistics" element={<MonthlyOverview />} />
            <Route path="/statistics/trends" element={<CategoryTrends />} />

            <Route path="/settings/members" element={<MembersAndCards />} />
            <Route path="/settings/categories" element={<CategorySettings />} />
            <Route path="/settings/profile" element={<ProfileSettings />} />
            <Route path="/create-household" element={<CreateHousehold />} />
            <Route path="/more" element={<More />} />
          </Route>

          {/* Default */}
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </SessionGate>
    </BrowserRouter>
  )
}
