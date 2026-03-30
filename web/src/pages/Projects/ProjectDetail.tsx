import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { projects } from '@expense-tracker/shared'
import type { Project, Expense } from '@expense-tracker/shared'
import { useAuthStore } from '../../stores/authStore'
import { useProjectStore } from '../../stores/projectStore'

function formatNok(ore: number) {
  return `kr ${(ore / 100).toFixed(2).replace('.', ',')}`
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })
}

export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const userId = useAuthStore((s) => s.userId)!
  const { activeProject, setActiveProject } = useProjectStore()

  const [project, setProject] = useState<Project | null>(
    activeProject?.id === projectId ? activeProject : null
  )
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(!project)
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isAdmin = project?.members.find((m) => m.userId === userId)?.role === 'admin'

  useEffect(() => {
    if (!projectId) return
    const fetchAll = async () => {
      try {
        const [proj, expData] = await Promise.all([
          project ? Promise.resolve(project) : projects.get(projectId),
          projects.listExpenses(projectId),
        ])
        setProject(proj)
        setActiveProject(proj)
        setExpenses(expData.expenses)
      } catch (err: any) {
        setError(err?.message ?? 'Failed to load project.')
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [projectId])

  async function handleFinish() {
    if (!projectId) return
    setFinishing(true)
    setError(null)
    try {
      await projects.finish(projectId)
      setProject((prev) => prev ? { ...prev, status: 'settling' } : prev)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to finish project.')
    } finally {
      setFinishing(false)
    }
  }

  const totalOre = expenses.reduce((sum, e) => sum + e.totalAmountOre, 0)

  return (
    <div className="project-detail-page">
      <div className="pd-topbar">
        <button className="back-btn" onClick={() => navigate('/projects')}>← Back</button>
      </div>

      {loading && <p className="pd-msg">Loading…</p>}
      {error && <p className="pd-msg pd-msg--error">{error}</p>}

      {project && (
        <>
          <div className="pd-head">
            <div className="pd-head-row">
              <h1 className="pd-name">{project.name}</h1>
              <span className={`pd-status pd-status--${project.status}`}>{project.status}</span>
            </div>
            {project.description && <p className="pd-description">{project.description}</p>}
            <div className="pd-total">{formatNok(totalOre)}</div>
          </div>

          {/* Members & split */}
          <section className="pd-section">
            <h2 className="pd-section-title">Members & split</h2>
            <div className="pd-members">
              {project.members.map((m) => {
                const share = project.allocationKey.find((k) => k.userId === m.userId)
                return (
                  <div key={m.userId} className="pd-member-row">
                    <div className="pd-avatar">{m.name.charAt(0).toUpperCase()}</div>
                    <span className="pd-member-name">{m.name}</span>
                    {share && (
                      <span className="pd-share">{(share.shareBp / 100).toFixed(0)}%</span>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          {/* Expenses */}
          <section className="pd-section">
            <div className="pd-section-header">
              <h2 className="pd-section-title">Expenses</h2>
              {project.status === 'active' && (
                <button className="add-expense-btn" onClick={() => navigate('/expenses/new')}>
                  + Add
                </button>
              )}
            </div>

            {expenses.length === 0 ? (
              <p className="pd-empty">No expenses yet.</p>
            ) : (
              <ul className="pd-expense-list">
                {expenses.map((exp) => (
                  <li key={exp.id} className="pd-expense-item">
                    <div>
                      <div className="pd-exp-store">{exp.store ?? 'Unknown'}</div>
                      <div className="pd-exp-meta">{formatDate(exp.date)} · {exp.purchaserName}</div>
                    </div>
                    <span className="pd-exp-amount">{formatNok(exp.totalAmountOre)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Finish action */}
          {isAdmin && project.status === 'active' && expenses.length > 0 && (
            <div className="pd-finish-area">
              <p className="pd-finish-hint">
                Finished adding expenses? Trigger settlement to split costs.
              </p>
              <button className="pd-finish-btn" disabled={finishing} onClick={handleFinish}>
                {finishing ? 'Calculating…' : 'Finish project & settle'}
              </button>
            </div>
          )}

          {project.status === 'settling' && (
            <div className="pd-settling-banner">
              Settlement triggered — check the Settlement tab to mark payments.
            </div>
          )}
          {project.status === 'settled' && (
            <div className="pd-settled-banner">✓ Fully settled</div>
          )}
        </>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Geist:wght@300;400;500;600&display=swap');
        .project-detail-page { max-width: 480px; margin: 0 auto; padding: 1.25rem 1rem 5rem; font-family: 'Geist', sans-serif; color: #f4f4f5; background: #09090b; min-height: 100dvh; }
        .pd-topbar { margin-bottom: 1.25rem; }
        .back-btn { background: none; border: none; color: #818cf8; font-size: 0.9rem; cursor: pointer; padding: 0; font-family: inherit; }
        .pd-msg { color: #71717a; font-size: 0.9rem; text-align: center; padding: 2rem 0; margin: 0; }
        .pd-msg--error { color: #f87171; }
        .pd-head { margin-bottom: 1.5rem; }
        .pd-head-row { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.3rem; }
        .pd-name { font-size: 1.375rem; font-weight: 600; margin: 0; letter-spacing: -0.025em; }
        .pd-status { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; padding: 0.2rem 0.5rem; border-radius: 5px; }
        .pd-status--active { background: rgba(34,197,94,0.1); color: #4ade80; border: 1px solid rgba(34,197,94,0.2); }
        .pd-status--settling { background: rgba(251,191,36,0.12); color: #fbbf24; border: 1px solid rgba(251,191,36,0.2); }
        .pd-status--settled { background: #27272a; color: #71717a; border: 1px solid #3f3f46; }
        .pd-description { color: #71717a; font-size: 0.875rem; margin: 0 0 0.75rem; }
        .pd-total { font-family: 'DM Mono', monospace; font-size: 1.75rem; font-weight: 500; letter-spacing: -0.02em; }
        .pd-section { margin-bottom: 1.5rem; }
        .pd-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.625rem; }
        .pd-section-title { font-size: 0.75rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: #71717a; margin: 0 0 0.625rem 0.25rem; }
        .pd-members { background: #18181b; border: 1px solid #27272a; border-radius: 12px; overflow: hidden; }
        .pd-member-row { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; border-bottom: 1px solid #1f1f22; }
        .pd-member-row:last-child { border-bottom: none; }
        .pd-avatar { width: 28px; height: 28px; background: #27272a; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.78rem; font-weight: 600; color: #a1a1aa; flex-shrink: 0; }
        .pd-member-name { flex: 1; font-size: 0.875rem; }
        .pd-share { font-family: 'DM Mono', monospace; font-size: 0.85rem; color: #71717a; }
        .add-expense-btn { background: none; border: 1px solid #3f3f46; border-radius: 8px; color: #818cf8; font-size: 0.8rem; font-weight: 500; padding: 0.3rem 0.7rem; cursor: pointer; font-family: inherit; }
        .pd-empty { color: #52525b; font-size: 0.875rem; margin: 0; padding: 1rem; text-align: center; }
        .pd-expense-list { list-style: none; margin: 0; padding: 0; background: #18181b; border: 1px solid #27272a; border-radius: 12px; overflow: hidden; }
        .pd-expense-item { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; border-bottom: 1px solid #1f1f22; }
        .pd-expense-item:last-child { border-bottom: none; }
        .pd-exp-store { font-size: 0.875rem; font-weight: 500; color: #f4f4f5; }
        .pd-exp-meta { font-size: 0.75rem; color: #71717a; margin-top: 2px; }
        .pd-exp-amount { font-family: 'DM Mono', monospace; font-size: 0.875rem; color: #f4f4f5; flex-shrink: 0; }
        .pd-finish-area { background: #18181b; border: 1px solid #27272a; border-radius: 14px; padding: 1.25rem; }
        .pd-finish-hint { font-size: 0.85rem; color: #71717a; margin: 0 0 1rem; line-height: 1.5; }
        .pd-finish-btn { width: 100%; background: #6366f1; border: none; border-radius: 10px; color: #fff; font-size: 0.9375rem; font-weight: 500; padding: 0.7rem; cursor: pointer; font-family: inherit; transition: background 0.15s, opacity 0.15s; }
        .pd-finish-btn:hover { background: #4f46e5; }
        .pd-finish-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .pd-settling-banner { background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.2); border-radius: 10px; color: #fbbf24; font-size: 0.875rem; padding: 0.75rem 1rem; text-align: center; }
        .pd-settled-banner { background: #18181b; border: 1px solid #27272a; border-radius: 10px; color: #71717a; font-size: 0.875rem; padding: 0.75rem 1rem; text-align: center; }
      `}</style>
    </div>
  )
}
