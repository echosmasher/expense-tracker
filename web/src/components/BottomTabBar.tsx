import { NavLink } from 'react-router-dom'
import { Receipt, Scale, FolderKanban, Menu, ScanLine } from 'lucide-react'

export function BottomTabBar() {
  return (
    <nav className="tab-bar" aria-label="Primary">
      <NavLink to="/expenses" end className={({ isActive }) => `tab-item ${isActive ? 'tab-item--active' : ''}`}>
        <Receipt className="tab-icon" size={20} strokeWidth={1.75} aria-hidden="true" />
        <span className="tab-label">Expenses</span>
      </NavLink>
      <NavLink to="/settlement" className={({ isActive }) => `tab-item ${isActive ? 'tab-item--active' : ''}`}>
        <Scale className="tab-icon" size={20} strokeWidth={1.75} aria-hidden="true" />
        <span className="tab-label">Settlement</span>
      </NavLink>

      <NavLink to="/expenses/new" className="tab-scan" aria-label="Scan receipt">
        <ScanLine size={22} strokeWidth={2} aria-hidden="true" />
      </NavLink>

      <NavLink to="/projects" className={({ isActive }) => `tab-item ${isActive ? 'tab-item--active' : ''}`}>
        <FolderKanban className="tab-icon" size={20} strokeWidth={1.75} aria-hidden="true" />
        <span className="tab-label">Projects</span>
      </NavLink>
      <NavLink to="/more" className={({ isActive }) => `tab-item ${isActive ? 'tab-item--active' : ''}`}>
        <Menu className="tab-icon" size={20} strokeWidth={1.75} aria-hidden="true" />
        <span className="tab-label">More</span>
      </NavLink>

      <style>{`
        .tab-bar {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 40;
          display: flex;
          align-items: flex-end;
          justify-content: space-around;
          background: var(--bg-sidebar);
          border-top: 1px solid var(--border-subtle);
          padding: 0.4rem 0.25rem calc(0.4rem + env(safe-area-inset-bottom));
        }

        .tab-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.15rem;
          flex: 1;
          min-width: 0;
          padding: 0.25rem 0.1rem;
          text-decoration: none;
          color: var(--text-muted);
        }

        .tab-item--active { color: var(--text-primary); }
        .tab-item--active .tab-icon { opacity: 1; }

        .tab-icon { opacity: 0.7; flex-shrink: 0; }

        .tab-label {
          font-size: 0.65rem;
          white-space: nowrap;
        }

        .tab-scan {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          flex-shrink: 0;
          margin-top: -22px;
          border-radius: 50%;
          background: var(--accent);
          color: #fff;
          box-shadow: 0 4px 12px rgba(99,102,241,0.45);
          text-decoration: none;
        }
      `}</style>
    </nav>
  )
}
