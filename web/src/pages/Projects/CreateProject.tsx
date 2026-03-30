import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { projects } from '@expense-tracker/shared'
import { useAuthStore } from '../../stores/authStore'
import { useHouseholdStore } from '../../stores/householdStore'
import { useProjectStore } from '../../stores/projectStore'
import { Button } from '../../components/Button'
import { FormField, Input } from '../../components/FormField'

export function CreateProject() {
  const navigate = useNavigate()
  const userId = useAuthStore((s) => s.userId)!
  const household = useHouseholdStore((s) => s.household)
  const addProject = useProjectStore((s) => s.addProject)

  const members = household?.members ?? []

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  // Member selection: creator is always included
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set([userId]))
  // Allocation shares: equal split by default
  const [shares, setShares] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    members.forEach((m) => { initial[m.userId] = '50' })
    return initial
  })
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; members?: string; shares?: string; general?: string }>({})

  const selected = members.filter((m) => selectedMembers.has(m.userId))

  function toggleMember(memberId: string) {
    if (memberId === userId) return // can't deselect self
    setSelectedMembers((prev) => {
      const next = new Set(prev)
      if (next.has(memberId)) next.delete(memberId)
      else next.add(memberId)
      return next
    })
  }

  function updateShare(memberId: string, val: string) {
    setShares((prev) => ({ ...prev, [memberId]: val }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs: typeof errors = {}
    if (!name.trim()) errs.name = 'Project name is required'
    if (selected.length < 1) errs.members = 'Select at least one member'

    const parsedShares = selected.map((m) => ({
      userId: m.userId,
      shareBp: Math.round((parseFloat(shares[m.userId] ?? '0') / 100) * 10_000),
    }))
    const totalBp = parsedShares.reduce((sum, s) => sum + s.shareBp, 0)
    if (Math.abs(totalBp - 10_000) > selected.length) {
      errs.shares = 'Shares must sum to 100%'
    }
    if (Object.keys(errs).length) { setErrors(errs); return }

    setLoading(true)
    setErrors({})
    try {
      const project = await projects.create(household!.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        memberIds: selected.map((m) => m.userId),
        allocationKey: parsedShares,
      })
      addProject(project)
      navigate(`/projects/${project.id}`)
    } catch (err: any) {
      setErrors({ general: err?.message ?? 'Failed to create project.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="create-project-page">
      <div className="cp-topbar">
        <button className="back-btn" onClick={() => navigate('/projects')}>← Back</button>
        <h1 className="cp-title">New project</h1>
      </div>

      <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <FormField label="Project name" error={errors.name}>
          <Input
            type="text"
            placeholder="e.g. Kitchen renovation"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </FormField>

        <FormField label="Description (optional)">
          <Input
            type="text"
            placeholder="What's this project for?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>

        <div>
          <p className="field-group-label">Members</p>
          {errors.members && <p className="field-error">{errors.members}</p>}
          <div className="member-select-list">
            {members.map((m) => (
              <label key={m.userId} className={`member-option ${selectedMembers.has(m.userId) ? 'member-option--selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={selectedMembers.has(m.userId)}
                  onChange={() => toggleMember(m.userId)}
                  disabled={m.userId === userId}
                  className="member-option-cb"
                />
                <div className="member-avatar">{m.name.charAt(0).toUpperCase()}</div>
                <span className="member-option-name">{m.name}{m.userId === userId ? ' (you)' : ''}</span>
              </label>
            ))}
          </div>
        </div>

        {selected.length > 0 && (
          <div>
            <p className="field-group-label">Cost split</p>
            {errors.shares && <p className="field-error">{errors.shares}</p>}
            <div className="shares-list">
              {selected.map((m, idx) => (
                <div key={m.userId} className="share-row">
                  <span className="share-name">{m.name}</span>
                  <div className="share-input-wrap">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      value={shares[m.userId] ?? '0'}
                      onChange={(e) => updateShare(m.userId, e.target.value)}
                      style={{ width: '72px', textAlign: 'right', paddingRight: '1.5rem' }}
                    />
                    <span className="share-pct">%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {errors.general && <p style={{ color: '#f87171', fontSize: '0.85rem', margin: 0 }}>{errors.general}</p>}

        <Button type="submit" loading={loading}>Create project</Button>
      </form>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&display=swap');
        .create-project-page {
          max-width: 480px; margin: 0 auto;
          padding: 1.25rem 1rem 5rem;
          font-family: 'Geist', sans-serif; color: #f4f4f5;
          background: #09090b; min-height: 100dvh;
        }
        .cp-topbar { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; }
        .back-btn { background: none; border: none; color: #818cf8; font-size: 0.9rem; cursor: pointer; padding: 0; font-family: inherit; white-space: nowrap; }
        .cp-title { font-size: 1.25rem; font-weight: 600; margin: 0; letter-spacing: -0.02em; }
        .field-group-label { font-size: 0.75rem; font-weight: 500; color: #a1a1aa; letter-spacing: 0.06em; text-transform: uppercase; margin: 0 0 8px; }
        .field-error { font-size: 0.78rem; color: #f87171; margin: 0 0 6px; }
        .member-select-list { display: flex; flex-direction: column; gap: 0.5rem; }
        .member-option {
          display: flex; align-items: center; gap: 0.75rem;
          background: #18181b; border: 1px solid #27272a; border-radius: 10px;
          padding: 0.75rem; cursor: pointer; transition: border-color 0.15s;
        }
        .member-option--selected { border-color: #6366f1; background: rgba(99,102,241,0.06); }
        .member-option-cb { accent-color: #6366f1; }
        .member-avatar { width: 28px; height: 28px; background: #27272a; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; font-weight: 600; color: #a1a1aa; flex-shrink: 0; }
        .member-option-name { font-size: 0.875rem; color: #f4f4f5; }
        .shares-list { display: flex; flex-direction: column; gap: 0.5rem; }
        .share-row { display: flex; align-items: center; justify-content: space-between; background: #18181b; border: 1px solid #27272a; border-radius: 10px; padding: 0.75rem 1rem; }
        .share-name { font-size: 0.875rem; color: #f4f4f5; }
        .share-input-wrap { position: relative; display: flex; align-items: center; }
        .share-pct { position: absolute; right: 0.6rem; color: #71717a; font-size: 0.875rem; pointer-events: none; }
      `}</style>
    </div>
  )
}
