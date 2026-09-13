import { NavLink, useNavigate } from 'react-router-dom'
import { BarChart3, Users, Tag, User, HousePlus, LogOut, ScanLine, type LucideIcon } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { useHouseholdStore } from '../stores/householdStore'
import { pendingCount, useCaptureQueueStore } from '../capture/queue/captureQueue'

const MORE_ITEMS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/statistics', label: 'Statistics', icon: BarChart3 },
  { to: '/settings/members', label: 'Household', icon: Users },
  { to: '/settings/categories', label: 'Categories', icon: Tag },
  { to: '/settings/profile', label: 'Profile', icon: User },
  { to: '/create-household', label: 'Register Household', icon: HousePlus },
]

export function More() {
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const setHousehold = useHouseholdStore((s) => s.setHousehold)
  const queueCount = useCaptureQueueStore((s) => pendingCount(s.records))

  async function handleLogout() {
    await logout()
    setHousehold(null)
    navigate('/login')
  }

  return (
    <div className="more-page">
      <h1 className="more-title">More</h1>

      <nav className="more-list">
        <NavLink to="/capture-queue" className="more-item">
          <ScanLine className="more-icon" size={19} strokeWidth={1.75} aria-hidden="true" />
          <span className="more-label">Capture queue</span>
          {queueCount > 0 && <span className="more-badge">{queueCount}</span>}
        </NavLink>

        {MORE_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} className="more-item">
            <item.icon className="more-icon" size={19} strokeWidth={1.75} aria-hidden="true" />
            <span className="more-label">{item.label}</span>
          </NavLink>
        ))}

        <button className="more-item more-item--danger" onClick={handleLogout}>
          <LogOut className="more-icon" size={19} strokeWidth={1.75} aria-hidden="true" />
          <span className="more-label">Log out</span>
        </button>
      </nav>

      <style>{`
        .more-page { padding: 1.25rem 1rem 1.5rem; max-width: 480px; margin: 0 auto; }
        .more-title {
          font-size: 1.375rem;
          font-weight: 600;
          margin: 0 0 1rem;
          letter-spacing: -0.025em;
        }
        .more-list {
          display: flex;
          flex-direction: column;
          gap: 2px;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          overflow: hidden;
        }
        .more-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.85rem 1rem;
          text-decoration: none;
          color: var(--text-secondary);
          font-size: 0.9375rem;
          font-family: inherit;
          background: none;
          border: none;
          border-bottom: 1px solid var(--border-subtle);
          text-align: left;
          width: 100%;
          cursor: pointer;
        }
        .more-item:last-child { border-bottom: none; }
        .more-item:hover { background: var(--bg-card-hover); color: var(--text-primary); }
        .more-icon { opacity: 0.7; flex-shrink: 0; }
        .more-item--danger { color: var(--danger); }
        .more-badge {
          margin-left: auto;
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background: var(--danger);
          color: #fff;
          font-size: 0.6875rem;
          font-weight: 600;
          line-height: 1;
        }
      `}</style>
    </div>
  )
}
