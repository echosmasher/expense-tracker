import { useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Receipt,
  Plus,
  Scale,
  FolderKanban,
  BarChart3,
  Users,
  Tag,
  HousePlus,
  type LucideIcon,
} from 'lucide-react'
import { households } from '@expense-tracker/shared'
import { useAuthStore } from '../stores/authStore'
import { useHouseholdStore } from '../stores/householdStore'

const NAV_ITEMS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/expenses', label: 'Expenses', icon: Receipt },
  { to: '/expenses/new', label: 'Add Expense', icon: Plus },
  { to: '/settlement', label: 'Settlement', icon: Scale },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/statistics', label: 'Statistics', icon: BarChart3 },
  { to: '/settings/members', label: 'Household', icon: Users },
  { to: '/settings/categories', label: 'Categories', icon: Tag },
  { to: '/create-household', label: 'Register Household', icon: HousePlus },
]

export function AppShell() {
  const navigate = useNavigate()
  const name = useAuthStore((s) => s.name)
  const clearUser = useAuthStore((s) => s.clearUser)
  const household = useHouseholdStore((s) => s.household)
  const setHousehold = useHouseholdStore((s) => s.setHousehold)

  useEffect(() => {
    if (household) return
    let cancelled = false
    households.listMine()
      .then((list) => {
        if (cancelled) return
        if (list.length > 0) {
          setHousehold(list[0]!)
        } else {
          navigate('/create-household', { replace: true })
        }
      })
      .catch(() => { /* 401 handled by client refresh; other errors stay on page */ })
    return () => { cancelled = true }
  }, [household, setHousehold, navigate])

  function handleLogout() {
    clearUser()
    setHousehold(null)
    navigate('/login')
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <span className="brand-serif">Household Wizard</span>
          <span className="brand-dot">.</span>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/expenses'}
              className={({ isActive }) =>
                `nav-item ${isActive ? 'nav-item--active' : ''}`
              }
            >
              <item.icon className="nav-icon" size={18} strokeWidth={1.75} aria-hidden="true" />
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user" onClick={() => navigate('/settings/profile')} role="button" tabIndex={0}>
            <div className="user-avatar">{name?.charAt(0).toUpperCase() ?? '?'}</div>
            <span className="user-name">{name ?? 'User'}</span>
            <span className="user-settings-hint">Settings</span>
          </div>
          <button className="logout-btn" onClick={handleLogout}>Log out</button>
        </div>
      </aside>

      <main className="app-main">
        <Outlet />
      </main>

      <style>{`

        .app-shell {
          display: flex;
          min-height: 100dvh;
          background: var(--bg-base);
          font-family: 'Geist', sans-serif;
          color: var(--text-primary);
        }

        /* ── Sidebar ─────────────────────────────────── */
        .app-sidebar {
          width: 240px;
          flex-shrink: 0;
          background: var(--bg-sidebar);
          border-right: 1px solid var(--border-subtle);
          display: flex;
          flex-direction: column;
          padding: 1.5rem 0;
          position: sticky;
          top: 0;
          height: 100dvh;
          overflow-y: auto;
        }

        .sidebar-brand {
          padding: 0 1.25rem;
          margin-bottom: 2rem;
          font-family: 'Instrument Serif', Georgia, serif;
          font-style: italic;
          font-size: 1.5rem;
          color: var(--text-primary);
          letter-spacing: -0.01em;
        }

        .brand-dot { color: var(--accent); }

        .sidebar-nav {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 0 0.75rem;
        }

        .nav-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.6rem 0.75rem;
          border-radius: 8px;
          text-decoration: none;
          color: var(--text-muted);
          font-size: 0.875rem;
          font-weight: 450;
          transition: background 0.12s, color 0.12s;
        }

        .nav-item:hover {
          background: var(--bg-card);
          color: var(--text-secondary);
        }

        .nav-item--active {
          background: var(--bg-card);
          color: var(--text-primary);
        }

        .nav-item--active .nav-icon {
          opacity: 1;
        }

        .nav-icon {
          width: 18px;
          height: 18px;
          opacity: 0.65;
          flex-shrink: 0;
          transition: opacity 0.12s;
          /* lucide SVGs inherit currentColor, so they track the nav-item color
             on hover/active for free. */
        }

        .nav-item:hover .nav-icon { opacity: 0.85; }

        .nav-label {
          white-space: nowrap;
        }

        /* ── Footer ──────────────────────────────────── */
        .sidebar-footer {
          padding: 1rem 1rem 0;
          border-top: 1px solid var(--border-subtle);
          margin-top: 0.5rem;
        }

        .sidebar-user {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          margin-bottom: 0.75rem;
          padding: 0.4rem 0.5rem;
          margin-left: -0.5rem;
          margin-right: -0.5rem;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.12s;
        }

        .sidebar-user:hover {
          background: var(--bg-card);
        }

        .user-settings-hint {
          margin-left: auto;
          font-size: 0.7rem;
          color: var(--text-faint);
          transition: color 0.12s;
        }

        .sidebar-user:hover .user-settings-hint {
          color: var(--text-muted);
        }

        .user-avatar {
          width: 28px;
          height: 28px;
          background: var(--badge-bg);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--text-secondary);
          flex-shrink: 0;
        }

        .user-name {
          font-size: 0.8rem;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .logout-btn {
          width: 100%;
          background: none;
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text-faint);
          font-size: 0.78rem;
          font-weight: 500;
          padding: 0.4rem;
          cursor: pointer;
          font-family: inherit;
          transition: color 0.15s, border-color 0.15s;
        }

        .logout-btn:hover {
          color: var(--danger);
          border-color: rgba(248,113,113,0.3);
        }

        /* ── Main content ────────────────────────────── */
        .app-main {
          flex: 1;
          min-width: 0;
          overflow-y: auto;
        }
      `}</style>
    </div>
  )
}
