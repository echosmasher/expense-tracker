import { useState, useEffect } from 'react'
import { users, households } from '@expense-tracker/shared'
import type { UserProfile } from '@expense-tracker/shared'
import { useHouseholdStore } from '../../stores/householdStore'
import { Button } from '../../components/Button'
import { FormField, Input } from '../../components/FormField'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`role-badge role-badge--${role}`}>
      {role === 'admin' ? 'Admin' : 'Member'}
    </span>
  )
}

// ─── Add Card Modal ───────────────────────────────────────────────────────────

function AddCardModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [lastFour, setLastFour] = useState('')
  const [label, setLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<{ lastFour?: string; label?: string; general?: string }>({})

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs: typeof errors = {}
    if (!/^\d{4}$/.test(lastFour)) errs.lastFour = 'Enter the last 4 digits'
    if (!label.trim()) errs.label = 'Label is required'
    if (Object.keys(errs).length) { setErrors(errs); return }

    setLoading(true)
    try {
      await users.addCard({ lastFour, label: label.trim() })
      onAdded()
      onClose()
    } catch (err: any) {
      setErrors({ general: err?.message ?? 'Failed to add card.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Add payment card</h3>
        <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <FormField label="Last 4 digits" error={errors.lastFour}>
            <Input
              type="text"
              inputMode="numeric"
              maxLength={4}
              placeholder="1234"
              value={lastFour}
              onChange={(e) => setLastFour(e.target.value.replace(/\D/g, '').slice(0, 4))}
              autoFocus
            />
          </FormField>
          <FormField label="Label" error={errors.label}>
            <Input
              type="text"
              placeholder="e.g. Visa, DNB, Shared"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </FormField>
          {errors.general && <p style={{ color: '#f87171', fontSize: '0.85rem', margin: 0 }}>{errors.general}</p>}
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
            <Button type="button" variant="ghost" onClick={onClose} style={{ flex: 1 }}>
              Cancel
            </Button>
            <Button type="submit" loading={loading} style={{ flex: 1 }}>
              Add card
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Invite Modal ─────────────────────────────────────────────────────────────

function InviteModal({ householdId, onClose }: { householdId: string; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; general?: string }>({})

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim().includes('@')) { setErrors({ email: 'Enter a valid email' }); return }

    setLoading(true)
    setErrors({})
    try {
      await households.invite(householdId, { email: email.trim() })
      setSent(true)
    } catch (err: any) {
      if (err?.status === 409) {
        setErrors({ email: 'This person is already a member.' })
      } else {
        setErrors({ general: err?.message ?? 'Failed to send invite.' })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {sent ? (
          <>
            <p className="invite-sent-icon">✓</p>
            <h3 className="modal-title">Invite sent!</h3>
            <p style={{ color: '#71717a', fontSize: '0.875rem', textAlign: 'center', margin: '0 0 1.5rem' }}>
              We've sent an invite to <strong style={{ color: '#f4f4f5' }}>{email}</strong>.
            </p>
            <Button onClick={onClose}>Done</Button>
          </>
        ) : (
          <>
            <h3 className="modal-title">Invite a member</h3>
            <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <FormField label="Email" error={errors.email}>
                <Input
                  type="email"
                  placeholder="partner@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
              </FormField>
              {errors.general && <p style={{ color: '#f87171', fontSize: '0.85rem', margin: 0 }}>{errors.general}</p>}
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <Button type="button" variant="ghost" onClick={onClose} style={{ flex: 1 }}>
                  Cancel
                </Button>
                <Button type="submit" loading={loading} style={{ flex: 1 }}>
                  Send invite
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function MembersAndCards() {
  const household = useHouseholdStore((s) => s.household)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [showAddCard, setShowAddCard] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null)

  useEffect(() => {
    users.me().then(setProfile).catch(console.error)
  }, [])

  async function handleDeleteCard(cardId: string) {
    setDeletingCardId(cardId)
    try {
      await users.deleteCard(cardId)
      setProfile((prev) =>
        prev ? { ...prev, cards: prev.cards.filter((c) => c.id !== cardId) } : prev
      )
    } catch (err) {
      console.error('Failed to delete card', err)
    } finally {
      setDeletingCardId(null)
    }
  }

  function refreshProfile() {
    users.me().then(setProfile).catch(console.error)
  }

  return (
    <div className="settings-page">
      {/* ── Members ──────────────────────────────────────────────── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="settings-section-title">Members</h2>
          {household && (
            <button className="icon-btn" onClick={() => setShowInvite(true)} title="Invite member">
              + Invite
            </button>
          )}
        </div>

        {!household ? (
          <p className="settings-empty">No household found.</p>
        ) : household.members.length === 0 ? (
          <p className="settings-empty">No members yet.</p>
        ) : (
          <ul className="settings-list">
            {household.members.map((m) => (
              <li key={m.userId} className="settings-list-item">
                <div className="member-avatar">{m.name.charAt(0).toUpperCase()}</div>
                <span className="member-name">{m.name}</span>
                <RoleBadge role={m.role} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Payment Cards ─────────────────────────────────────────── */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="settings-section-title">My cards</h2>
          <button className="icon-btn" onClick={() => setShowAddCard(true)}>
            + Add card
          </button>
        </div>

        {!profile ? (
          <p className="settings-empty" style={{ color: '#52525b' }}>Loading…</p>
        ) : profile.cards.length === 0 ? (
          <p className="settings-empty">No cards added yet.</p>
        ) : (
          <ul className="settings-list">
            {profile.cards.map((card) => (
              <li key={card.id} className="settings-list-item">
                <div className="card-icon">
                  <svg width="20" height="14" viewBox="0 0 20 14" fill="none">
                    <rect width="20" height="14" rx="2" fill="#27272a"/>
                    <rect x="1" y="5" width="18" height="3" fill="#3f3f46"/>
                    <rect x="1" y="10" width="6" height="2" rx="1" fill="#52525b"/>
                  </svg>
                </div>
                <div className="card-info">
                  <span className="card-label">{card.label}</span>
                  <span className="card-digits">•••• {card.lastFour}</span>
                </div>
                <button
                  className="delete-btn"
                  disabled={deletingCardId === card.id}
                  onClick={() => handleDeleteCard(card.id)}
                  title="Remove card"
                >
                  {deletingCardId === card.id ? '…' : '×'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Modals ───────────────────────────────────────────────── */}
      {showAddCard && (
        <AddCardModal onClose={() => setShowAddCard(false)} onAdded={refreshProfile} />
      )}
      {showInvite && household && (
        <InviteModal householdId={household.id} onClose={() => setShowInvite(false)} />
      )}

      <style>{`
        .settings-page {
          max-width: 480px;
          margin: 0 auto;
          padding: 1.5rem 1rem;
          display: flex;
          flex-direction: column;
          gap: 2rem;
          font-family: 'Geist', 'DM Sans', sans-serif;
        }
        .settings-section {
          background: #18181b;
          border: 1px solid #27272a;
          border-radius: 16px;
          overflow: hidden;
        }
        .settings-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1rem 1.25rem 0.75rem;
          border-bottom: 1px solid #27272a;
        }
        .settings-section-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: #f4f4f5;
          margin: 0;
          letter-spacing: -0.01em;
        }
        .icon-btn {
          background: none;
          border: 1px solid #3f3f46;
          border-radius: 8px;
          color: #818cf8;
          font-size: 0.8rem;
          font-weight: 500;
          padding: 0.3rem 0.7rem;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
          font-family: inherit;
        }
        .icon-btn:hover { background: #27272a; border-color: #52525b; }
        .settings-list {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .settings-list-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.875rem 1.25rem;
          border-bottom: 1px solid #1f1f22;
        }
        .settings-list-item:last-child { border-bottom: none; }
        .settings-empty {
          color: #52525b;
          font-size: 0.875rem;
          padding: 1.25rem;
          margin: 0;
        }

        /* Member row */
        .member-avatar {
          width: 32px; height: 32px;
          background: #27272a;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 0.875rem; font-weight: 600; color: #a1a1aa;
          flex-shrink: 0;
        }
        .member-name {
          flex: 1;
          color: #f4f4f5;
          font-size: 0.9rem;
        }
        .role-badge {
          font-size: 0.7rem;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          padding: 0.2rem 0.5rem;
          border-radius: 6px;
        }
        .role-badge--admin {
          background: rgba(99,102,241,0.15);
          color: #818cf8;
          border: 1px solid rgba(99,102,241,0.25);
        }
        .role-badge--member {
          background: #27272a;
          color: #71717a;
          border: 1px solid #3f3f46;
        }

        /* Card row */
        .card-icon { flex-shrink: 0; }
        .card-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .card-label {
          color: #f4f4f5;
          font-size: 0.9rem;
          font-weight: 500;
        }
        .card-digits {
          color: #71717a;
          font-size: 0.8rem;
          font-family: 'DM Mono', monospace;
        }
        .delete-btn {
          background: none;
          border: none;
          color: #52525b;
          font-size: 1.1rem;
          line-height: 1;
          cursor: pointer;
          padding: 0.25rem 0.4rem;
          border-radius: 6px;
          transition: color 0.15s, background 0.15s;
        }
        .delete-btn:hover:not(:disabled) { color: #f87171; background: rgba(248,113,113,0.1); }
        .delete-btn:disabled { opacity: 0.45; cursor: not-allowed; }

        /* Modal */
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.65);
          display: flex;
          align-items: flex-end;
          justify-content: center;
          z-index: 100;
          padding: 0 0 env(safe-area-inset-bottom, 0);
          animation: fade-in 0.15s ease;
        }
        @media (min-width: 520px) {
          .modal-backdrop { align-items: center; }
        }
        .modal-card {
          background: #18181b;
          border: 1px solid #27272a;
          border-radius: 20px 20px 0 0;
          padding: 1.75rem 1.5rem 2rem;
          width: 100%;
          max-width: 420px;
          animation: slide-up 0.25s cubic-bezier(0.22,1,0.36,1);
        }
        @media (min-width: 520px) {
          .modal-card { border-radius: 20px; }
        }
        .modal-title {
          font-size: 1rem;
          font-weight: 600;
          color: #f4f4f5;
          margin: 0 0 1.25rem;
        }
        .invite-sent-icon {
          font-size: 2rem;
          text-align: center;
          color: #4ade80;
          margin: 0 0 0.5rem;
        }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slide-up { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>
    </div>
  )
}
