import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'

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

        {/* Onboarding */}
        <Route path="/create-household" element={<RequireAuth><CreateHousehold /></RequireAuth>} />

        {/* Main app */}
        <Route path="/home" element={<RequireAuth><ExpenseList /></RequireAuth>} />
        <Route path="/expenses" element={<RequireAuth><ExpenseList /></RequireAuth>} />
        <Route path="/expenses/new" element={<RequireAuth><AddExpense /></RequireAuth>} />
        <Route path="/expenses/:expenseId" element={<RequireAuth><ExpenseDetail /></RequireAuth>} />

        <Route path="/settlement" element={<RequireAuth><CurrentMonth /></RequireAuth>} />
        <Route path="/settlement/history" element={<RequireAuth><History /></RequireAuth>} />

        <Route path="/projects" element={<RequireAuth><ProjectList /></RequireAuth>} />
        <Route path="/projects/new" element={<RequireAuth><CreateProject /></RequireAuth>} />
        <Route path="/projects/:projectId" element={<RequireAuth><ProjectDetail /></RequireAuth>} />

        <Route path="/statistics" element={<RequireAuth><MonthlyOverview /></RequireAuth>} />
        <Route path="/statistics/trends" element={<RequireAuth><CategoryTrends /></RequireAuth>} />

        <Route path="/settings/members" element={<RequireAuth><MembersAndCards /></RequireAuth>} />

        {/* Default */}
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
