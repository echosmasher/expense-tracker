import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { users } from '@expense-tracker/shared'
import type { UserProfile, UserPreferences } from '@expense-tracker/shared'
import { useAuthStore } from '../../stores/authStore'
import { Button } from '../../components/Button'
import { FormField, Input } from '../../components/FormField'

// ─── Avatar Section ─────────────────────────────────────────────────────────

function AvatarSection({
  avatarUrl,
  name,
  onUploaded,
}: {
  avatarUrl: string | null
  name: string
  onUploaded: (url: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const result = await users.uploadAvatar(file)
      onUploaded(result.avatarUrl)
    } catch (err: any) {
      setError(err?.message ?? 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <section className="ps-section">
      <h2 className="ps-section-title">Profile picture</h2>
      <div className="avatar-row">
        <div className="avatar-preview" onClick={() => fileRef.current?.click()}>
          {avatarUrl ? (
            <img src={avatarUrl} alt="Avatar" className="avatar-img" />
          ) : (
            <span className="avatar-initial">{name.charAt(0).toUpperCase()}</span>
          )}
          <div className="avatar-overlay">{uploading ? '...' : 'Edit'}</div>
        </div>
        <div className="avatar-info">
          <p className="avatar-hint">Click to upload. JPEG, PNG, or WebP. Max 5 MB.</p>
          {error && <p className="avatar-error">{error}</p>}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFile}
        style={{ display: 'none' }}
      />
    </section>
  )
}

// ─── Display Name Section ───────────────────────────────────────────────────

function DisplayNameSection({ currentName, onSaved }: { currentName: string; onSaved: (name: string) => void }) {
  const [name, setName] = useState(currentName)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setName(currentName) }, [currentName])

  async function handleSave() {
    if (!name.trim() || name.trim() === currentName) return
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const profile = await users.updateMe({ name: name.trim() })
      onSaved(profile.name)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update name')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="ps-section">
      <h2 className="ps-section-title">Display name</h2>
      <div className="ps-field-row">
        <FormField label="Name" error={error ?? undefined}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
          />
        </FormField>
        <div className="ps-field-action">
          <Button onClick={handleSave} loading={saving} disabled={!name.trim() || name.trim() === currentName}>
            {success ? 'Saved' : 'Save'}
          </Button>
        </div>
      </div>
    </section>
  )
}

// ─── Change Password Section ────────────────────────────────────────────────

function ChangePasswordSection() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string; general?: string }>({})

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs: typeof errors = {}
    if (!current) errs.current = 'Required'
    if (next.length < 8) errs.next = 'Min 8 characters'
    if (next !== confirm) errs.confirm = 'Passwords do not match'
    if (Object.keys(errs).length) { setErrors(errs); return }

    setSaving(true)
    setErrors({})
    setSuccess(false)
    try {
      await users.changePassword({ currentPassword: current, newPassword: next })
      setCurrent('')
      setNext('')
      setConfirm('')
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err: any) {
      if (err?.code === 'WRONG_PASSWORD') {
        setErrors({ current: 'Incorrect password' })
      } else {
        setErrors({ general: err?.message ?? 'Failed to change password' })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="ps-section">
      <h2 className="ps-section-title">Change password</h2>
      <form onSubmit={handleSubmit} className="ps-form">
        <FormField label="Current password" error={errors.current}>
          <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </FormField>
        <FormField label="New password" error={errors.next}>
          <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="Min 8 characters" />
        </FormField>
        <FormField label="Confirm new password" error={errors.confirm}>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </FormField>
        {errors.general && <p className="ps-error">{errors.general}</p>}
        {success && <p className="ps-success">Password updated successfully.</p>}
        <Button type="submit" loading={saving}>Change password</Button>
      </form>
    </section>
  )
}

// ─── Preferences Section (Theme + Notifications with Save) ──────────────────

function PreferencesSection({
  prefs,
  onSaved,
}: {
  prefs: UserPreferences
  onSaved: (prefs: UserPreferences) => void
}) {
  const [draft, setDraft] = useState<UserPreferences>(prefs)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setDraft(prefs) }, [prefs])

  const hasChanges =
    draft.theme !== prefs.theme ||
    draft.notifyNewExpense !== prefs.notifyNewExpense ||
    draft.notifySettlement !== prefs.notifySettlement ||
    draft.notifyInvite !== prefs.notifyInvite

  function toggleTheme() {
    setDraft((d) => ({ ...d, theme: d.theme === 'dark' ? 'light' : 'dark' }))
    setSuccess(false)
  }

  function toggleNotif(key: 'notifyNewExpense' | 'notifySettlement' | 'notifyInvite') {
    setDraft((d) => ({ ...d, [key]: !d[key] }))
    setSuccess(false)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const updated = await users.updatePreferences(draft)
      onSaved(updated)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save preferences')
    } finally {
      setSaving(false)
    }
  }

  const notifItems: Array<{ key: 'notifyNewExpense' | 'notifySettlement' | 'notifyInvite'; label: string; description: string }> = [
    { key: 'notifyNewExpense', label: 'New expenses', description: 'When a household member adds an expense' },
    { key: 'notifySettlement', label: 'Settlements', description: 'When a settlement is triggered or completed' },
    { key: 'notifyInvite', label: 'Invitations', description: 'When someone accepts your household invite' },
  ]

  return (
    <section className="ps-section">
      <h2 className="ps-section-title">Preferences</h2>

      {/* Theme */}
      <div className="theme-toggle-row">
        <div className="theme-info">
          <span className="theme-label">Theme</span>
          <span className="theme-value">{draft.theme === 'dark' ? 'Dark' : 'Light'}</span>
        </div>
        <button className="theme-btn" onClick={toggleTheme}>
          <span className={`theme-option ${draft.theme === 'light' ? 'theme-option--active' : ''}`}>Light</span>
          <span className={`theme-option ${draft.theme === 'dark' ? 'theme-option--active' : ''}`}>Dark</span>
        </button>
      </div>

      {/* Notifications */}
      <p className="prefs-sub-title">Email notifications</p>
      <div className="notif-list">
        {notifItems.map((item) => (
          <label key={item.key} className="notif-row">
            <div className="notif-info">
              <span className="notif-label">{item.label}</span>
              <span className="notif-desc">{item.description}</span>
            </div>
            <input
              type="checkbox"
              className="notif-cb"
              checked={draft[item.key]}
              onChange={() => toggleNotif(item.key)}
            />
          </label>
        ))}
      </div>

      {/* Save */}
      {error && <p className="ps-error">{error}</p>}
      <div className="prefs-save-row">
        {success && <span className="ps-success">Saved</span>}
        <Button onClick={handleSave} loading={saving} disabled={!hasChanges}>
          Save preferences
        </Button>
      </div>
    </section>
  )
}

// ─── Delete Account Section ─────────────────────────────────────────────────

function DeleteAccountSection() {
  const navigate = useNavigate()
  const clearUser = useAuthStore((s) => s.clearUser)
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault()
    if (!password) { setError('Password required'); return }
    setDeleting(true)
    setError(null)
    try {
      await users.deleteAccount({ password })
      clearUser()
      navigate('/login')
    } catch (err: any) {
      if (err?.code === 'WRONG_PASSWORD') {
        setError('Incorrect password')
      } else {
        setError(err?.message ?? 'Failed to delete account')
      }
    } finally {
      setDeleting(false)
    }
  }

  if (!open) {
    return (
      <section className="ps-section ps-section--danger">
        <h2 className="ps-section-title">Danger zone</h2>
        <div className="danger-row">
          <div className="danger-info">
            <span className="danger-label">Delete account</span>
            <span className="danger-desc">Permanently remove your account and all associated data. This cannot be undone.</span>
          </div>
          <button className="danger-btn" onClick={() => setOpen(true)}>Delete account</button>
        </div>
      </section>
    )
  }

  return (
    <section className="ps-section ps-section--danger">
      <h2 className="ps-section-title">Confirm account deletion</h2>
      <p className="danger-warning">
        This will permanently delete your account, remove you from all households, and erase your expense history. This action cannot be undone.
      </p>
      <form onSubmit={handleDelete} className="ps-form">
        <FormField label="Enter your password to confirm" error={error ?? undefined}>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </FormField>
        <div className="danger-actions">
          <Button variant="ghost" type="button" onClick={() => { setOpen(false); setPassword(''); setError(null) }}>
            Cancel
          </Button>
          <button className="danger-confirm-btn" type="submit" disabled={deleting || !password}>
            {deleting ? 'Deleting...' : 'Permanently delete my account'}
          </button>
        </div>
      </form>
    </section>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export function ProfileSettings() {
  const authName = useAuthStore((s) => s.name)
  const setUser = useAuthStore((s) => s.setUser)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    users.me()
      .then((p) => { setProfile(p); setLoading(false) })
      .catch((err) => { setError(err?.message ?? 'Failed to load profile'); setLoading(false) })
  }, [])

  function handleNameSaved(name: string) {
    setProfile((p) => p ? { ...p, name } : p)
    // Also update the auth store so the sidebar reflects the new name
    const store = useAuthStore.getState()
    if (store.userId && store.email) {
      setUser({ id: store.userId, email: store.email, name }, '')
    }
  }

  function handleAvatarUploaded(avatarUrl: string) {
    setProfile((p) => p ? { ...p, avatarUrl } : p)
  }

  function handlePrefsSaved(prefs: UserPreferences) {
    setProfile((p) => p ? { ...p, preferences: prefs } : p)
    document.documentElement.setAttribute('data-theme', prefs.theme)
  }

  return (
    <div className="profile-settings-page">
      <h1 className="ps-page-title">Settings</h1>

      {loading && <p className="ps-loading">Loading...</p>}
      {error && <p className="ps-error">{error}</p>}

      {profile && (
        <>
          <AvatarSection
            avatarUrl={profile.avatarUrl}
            name={profile.name}
            onUploaded={handleAvatarUploaded}
          />
          <DisplayNameSection
            currentName={profile.name}
            onSaved={handleNameSaved}
          />
          <ChangePasswordSection />
          <PreferencesSection
            prefs={profile.preferences}
            onSaved={handlePrefsSaved}
          />
          <DeleteAccountSection />
        </>
      )}

      <style>{`

        .profile-settings-page {
          max-width: 720px;
          margin: 0 auto;
          padding: 1.5rem 1rem 2rem;
          font-family: 'Geist', sans-serif;
          color: #f4f4f5;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .ps-page-title {
          font-size: 1.375rem;
          font-weight: 600;
          margin: 0;
          letter-spacing: -0.025em;
        }

        .ps-loading { color: #71717a; font-size: 0.9rem; text-align: center; padding: 2rem 0; margin: 0; }
        .ps-error { color: #f87171; font-size: 0.85rem; margin: 0; }
        .ps-success { color: #4ade80; font-size: 0.85rem; margin: 0; }

        /* ── Section card ────────────────────────── */
        .ps-section {
          background: #18181b;
          border: 1px solid #27272a;
          border-radius: 16px;
          padding: 1.25rem 1.5rem;
        }

        .ps-section--danger {
          border-color: rgba(248,113,113,0.2);
        }

        .ps-section-title {
          font-size: 0.75rem;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #71717a;
          margin: 0 0 1rem;
        }

        .ps-form {
          display: flex;
          flex-direction: column;
          gap: 0.875rem;
        }

        /* ── Avatar ──────────────────────────────── */
        .avatar-row {
          display: flex;
          align-items: center;
          gap: 1.25rem;
        }

        .avatar-preview {
          width: 72px;
          height: 72px;
          border-radius: 50%;
          background: #27272a;
          overflow: hidden;
          cursor: pointer;
          position: relative;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .avatar-initial {
          font-size: 1.5rem;
          font-weight: 600;
          color: #a1a1aa;
        }

        .avatar-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0,0,0,0.55);
          color: #f4f4f5;
          font-size: 0.72rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: opacity 0.15s;
        }

        .avatar-preview:hover .avatar-overlay { opacity: 1; }

        .avatar-hint { color: #52525b; font-size: 0.8rem; margin: 0; line-height: 1.4; }
        .avatar-error { color: #f87171; font-size: 0.8rem; margin: 0.25rem 0 0; }

        /* ── Display name ────────────────────────── */
        .ps-field-row {
          display: flex;
          align-items: flex-end;
          gap: 0.75rem;
        }
        .ps-field-row > :first-child { flex: 1; }
        .ps-field-action { flex-shrink: 0; width: 100px; }

        /* ── Theme toggle ────────────────────────── */
        .theme-toggle-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .theme-info { display: flex; flex-direction: column; gap: 2px; }
        .theme-label { font-size: 0.9rem; color: #f4f4f5; font-weight: 500; }
        .theme-value { font-size: 0.78rem; color: #71717a; }

        .theme-btn {
          display: flex;
          background: #09090b;
          border: 1px solid #3f3f46;
          border-radius: 10px;
          padding: 3px;
          cursor: pointer;
          gap: 2px;
        }

        .theme-option {
          padding: 0.4rem 0.875rem;
          border-radius: 8px;
          font-size: 0.8rem;
          font-weight: 500;
          color: #71717a;
          font-family: inherit;
          transition: background 0.15s, color 0.15s;
        }

        .theme-option--active {
          background: #27272a;
          color: #f4f4f5;
        }

        .prefs-sub-title {
          font-size: 0.8rem;
          font-weight: 500;
          color: #a1a1aa;
          margin: 1.25rem 0 0.25rem;
        }

        .prefs-save-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-top: 1rem;
        }

        .prefs-save-row .ps-success {
          font-size: 0.8rem;
          white-space: nowrap;
        }

        /* ── Notifications ───────────────────────── */
        .notif-list {
          display: flex;
          flex-direction: column;
        }

        .notif-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.75rem 0;
          border-bottom: 1px solid #1f1f22;
          cursor: pointer;
        }
        .notif-row:last-child { border-bottom: none; }

        .notif-info { display: flex; flex-direction: column; gap: 2px; }
        .notif-label { font-size: 0.875rem; color: #f4f4f5; font-weight: 500; }
        .notif-desc { font-size: 0.78rem; color: #52525b; }

        .notif-cb {
          width: 18px;
          height: 18px;
          accent-color: #6366f1;
          cursor: pointer;
          flex-shrink: 0;
        }

        /* ── Danger zone ─────────────────────────── */
        .danger-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
        }

        .danger-info { display: flex; flex-direction: column; gap: 2px; flex: 1; }
        .danger-label { font-size: 0.875rem; color: #f4f4f5; font-weight: 500; }
        .danger-desc { font-size: 0.78rem; color: #52525b; line-height: 1.4; }

        .danger-btn {
          background: rgba(248,113,113,0.1);
          border: 1px solid rgba(248,113,113,0.25);
          border-radius: 10px;
          color: #f87171;
          font-size: 0.85rem;
          font-weight: 500;
          padding: 0.5rem 1rem;
          cursor: pointer;
          font-family: inherit;
          white-space: nowrap;
          transition: background 0.15s;
          flex-shrink: 0;
        }
        .danger-btn:hover { background: rgba(248,113,113,0.18); }

        .danger-warning {
          color: #f87171;
          font-size: 0.85rem;
          line-height: 1.5;
          margin: 0 0 1rem;
        }

        .danger-actions {
          display: flex;
          gap: 0.625rem;
        }
        .danger-actions > :first-child { flex: 1; }

        .danger-confirm-btn {
          background: #dc2626;
          border: none;
          border-radius: 10px;
          color: #fff;
          font-size: 0.85rem;
          font-weight: 500;
          padding: 0.65rem 1.25rem;
          cursor: pointer;
          font-family: inherit;
          transition: background 0.15s, opacity 0.15s;
          flex: 2;
        }
        .danger-confirm-btn:hover { background: #b91c1c; }
        .danger-confirm-btn:disabled { opacity: 0.45; cursor: not-allowed; }
      `}</style>
    </div>
  )
}
