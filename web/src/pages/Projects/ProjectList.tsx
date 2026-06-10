import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { projects } from '@expense-tracker/shared'
import { useHouseholdStore } from '../../stores/householdStore'
import { useProjectStore } from '../../stores/projectStore'

export function ProjectList() {
  const navigate = useNavigate()
  const household = useHouseholdStore((s) => s.household)
  const { projects: stored, setProjects } = useProjectStore()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!household) return
    projects.list(household.id)
      .then((data) => {
        setProjects(data.projects)
        setLoading(false)
      })
      .catch((err) => {
        setError(err?.message ?? 'Failed to load projects.')
        setLoading(false)
      })
  }, [household?.id])

  const active = stored.filter((p) => p.status === 'active')
  const finished = stored.filter((p) => p.status !== 'active')

  function statusColor(status: string) {
    if (status === 'active') return '#4ade80'
    if (status === 'settling') return '#fbbf24'
    return '#71717a'
  }

  return (
    <div className="projects-page">
      <div className="projects-header">
        <h1 className="projects-title">Projects</h1>
        <button className="new-btn" onClick={() => navigate('/projects/new')}>+ New</button>
      </div>

      {loading && <p className="projects-msg">Loading…</p>}
      {error && <p className="projects-msg projects-msg--error">{error}</p>}

      {!loading && stored.length === 0 && (
        <div className="projects-empty">
          <p className="empty-title">No projects yet</p>
          <p className="empty-hint">Create a project to track shared costs for a specific goal.</p>
          <button className="empty-cta" onClick={() => navigate('/projects/new')}>Create first project</button>
        </div>
      )}

      {active.length > 0 && (
        <section className="projects-section">
          <h2 className="section-label">Active</h2>
          {active.map((p) => (
            <div key={p.id} className="project-card" onClick={() => navigate(`/projects/${p.id}`)}>
              <div className="project-card-left">
                <span className="project-name">{p.name}</span>
                <span className="project-members">{p.memberCount} member{p.memberCount !== 1 ? 's' : ''}</span>
              </div>
              <span className="project-status-dot" style={{ background: statusColor(p.status) }} />
            </div>
          ))}
        </section>
      )}

      {finished.length > 0 && (
        <section className="projects-section">
          <h2 className="section-label">Finished</h2>
          {finished.map((p) => (
            <div key={p.id} className="project-card project-card--finished" onClick={() => navigate(`/projects/${p.id}`)}>
              <div className="project-card-left">
                <span className="project-name">{p.name}</span>
                <span className="project-status-text">{p.status}</span>
              </div>
              <span className="project-status-dot" style={{ background: statusColor(p.status) }} />
            </div>
          ))}
        </section>
      )}

      <style>{`
        .projects-page { max-width: 720px; margin: 0 auto; padding: 1.5rem 1rem 2rem; font-family: 'Geist', sans-serif; color: #f4f4f5; }
        .projects-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
        .projects-title { font-size: 1.375rem; font-weight: 600; margin: 0; letter-spacing: -0.025em; }
        .new-btn { background: #6366f1; border: none; border-radius: 10px; color: #fff; font-size: 0.875rem; font-weight: 500; padding: 0.5rem 1rem; cursor: pointer; font-family: inherit; transition: background 0.15s; }
        .new-btn:hover { background: #4f46e5; }
        .projects-msg { color: #71717a; font-size: 0.9rem; text-align: center; padding: 2rem 0; margin: 0; }
        .projects-msg--error { color: #f87171; }
        .projects-empty { text-align: center; padding: 3rem 0; }
        .empty-title { font-size: 1rem; font-weight: 500; color: #a1a1aa; margin: 0 0 0.4rem; }
        .empty-hint { color: #52525b; font-size: 0.875rem; margin: 0 0 1.5rem; line-height: 1.5; }
        .empty-cta { background: #6366f1; border: none; border-radius: 10px; color: #fff; font-size: 0.875rem; font-weight: 500; padding: 0.6rem 1.25rem; cursor: pointer; font-family: inherit; }
        .projects-section { margin-bottom: 1.75rem; }
        .section-label { font-size: 0.75rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: #71717a; margin: 0 0 0.625rem 0.25rem; }
        .project-card { display: flex; align-items: center; justify-content: space-between; background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 1rem 1.125rem; margin-bottom: 0.5rem; cursor: pointer; transition: background 0.1s; }
        .project-card:hover { background: #1f1f22; }
        .project-card--finished { opacity: 0.6; }
        .project-card-left { display: flex; flex-direction: column; gap: 3px; }
        .project-name { font-size: 0.9rem; font-weight: 500; color: #f4f4f5; }
        .project-members, .project-status-text { font-size: 0.78rem; color: #71717a; text-transform: capitalize; }
        .project-status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
      `}</style>
    </div>
  )
}
