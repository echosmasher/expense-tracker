import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'

// Layout
import { AppShell } from './components/AppShell'

// Auth
import { Register } from './pages/Auth/Register'
import { Login } from './pages/Auth/Login'
import { AcceptInvite } from './pages/Auth/AcceptInvite'

// Onboarding
import { CreateHousehold } from './pages/Onboarding/CreateHousehold'

// Expenses
import { ExpenseList } from './pages/Expenses/ExpenseList'
import { ExpenseDetail } from './pages/Expenses/ExpenseDetail'
import { AddExpense } from './pages/Expenses/AddExpense'

// Settlement
import { CurrentMonth } from './pages/Settlement/CurrentMonth'
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
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />
}

function RequireGuest({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return !isAuthenticated ? <>{children}</> : <Navigate to="/home" replace />
}

// ─── App ─────────────────────────────────────────────────────────────────────

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public auth routes */}
        <Route path="/register" element={<RequireGuest><Register /></RequireGuest>} />
        <Route path="/login" element={<RequireGuest><Login /></RequireGuest>} />
        <Route path="/accept-invite" element={<AcceptInvite />} />

        {/* Main app with sidebar navigation */}
        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route path="/home" element={<ExpenseList />} />
          <Route path="/expenses" element={<ExpenseList />} />
          <Route path="/expenses/new" element={<AddExpense />} />
          <Route path="/expenses/:expenseId" element={<ExpenseDetail />} />

          <Route path="/settlement" element={<CurrentMonth />} />
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
        </Route>

        {/* Default */}
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
