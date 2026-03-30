import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { auth } from '@expense-tracker/shared'
import { useAuthStore } from '../../stores/authStore'
import { AuthShell } from '../../components/AuthShell'
import { FormField, Input } from '../../components/FormField'
import { Button } from '../../components/Button'

type InviteState =
  | { status: 'loading' }
  | { status: 'invalid'; message: string }
  | { status: 'new-user'; householdName: string; email: string }
  | { status: 'existing-user'; householdName: string; email: string }

export function AcceptInvite() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const setUser = useAuthStore((s) => s.setUser)

  const [invite, setInvite] = useState<InviteState>({ status: 'loading' })
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; password?: string; general?: string }>({})

  useEffect(() => {
    if (!token) {
      setInvite({ status: 'invalid', message: 'No invite token found in the URL.' })
      return
    }
    auth.getInvite(token)
      .then((data) => {
        setInvite({
          status: data.isNewUser ? 'new-user' : 'existing-user',
          householdName: data.householdName,
          email: data.email,
        })
      })
      .catch(() => {
        setInvite({ status: 'invalid', message: 'This invite link is invalid or has expired.' })
      })
  }, [token])

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault()
    if (invite.status !== 'new-user' && invite.status !== 'existing-user') return

    const errs: typeof errors = {}
    if (invite.status === 'new-user' && !name.trim()) errs.name = 'Name is required'
    if (!password) errs.password = 'Password is required'
    if (invite.status === 'new-user' && password.length < 8) errs.password = 'Password must be at least 8 characters'
    if (Object.keys(errs).length) { setErrors(errs); return }

    setLoading(true)
    setErrors({})
    try {
      const res = await auth.acceptInvite({
        token,
        password,
        ...(invite.status === 'new-user' ? { name: name.trim() } : {}),
      })
      setUser(res.user, res.accessToken)
      navigate('/home')
    } catch (err: any) {
      if (err?.status === 401) {
        setErrors({ password: 'Incorrect password.' })
      } else if (err?.status === 410) {
        setInvite({ status: 'invalid', message: 'This invite link has expired.' })
      } else {
        setErrors({ general: err?.message ?? 'Something went wrong. Please try again.' })
      }
    } finally {
      setLoading(false)
    }
  }

  if (invite.status === 'loading') {
    return (
      <AuthShell>
        <div style={{ textAlign: 'center', color: '#71717a', padding: '2rem 0' }}>
          Checking your invite…
        </div>
      </AuthShell>
    )
  }

  if (invite.status === 'invalid') {
    return (
      <AuthShell>
        <div className="invite-error-box">
          <p className="invite-error-icon">⚠</p>
          <p className="invite-error-msg">{invite.message}</p>
          <p className="invite-error-hint">Ask your household admin to send a new invite.</p>
        </div>
        <style>{`
          .invite-error-box { text-align: center; padding: 1rem 0; }
          .invite-error-icon { font-size: 2rem; margin: 0 0 0.75rem; }
          .invite-error-msg { color: #f4f4f5; font-weight: 500; margin: 0 0 0.5rem; }
          .invite-error-hint { color: #71717a; font-size: 0.875rem; margin: 0; }
        `}</style>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <p className="invite-headline">
        You've been invited to join{' '}
        <strong style={{ color: '#f4f4f5' }}>{invite.householdName}</strong>.
      </p>

      <form onSubmit={handleAccept} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <FormField label="Email">
          <Input type="email" value={invite.email} disabled />
        </FormField>

        {invite.status === 'new-user' && (
          <FormField label="Your name" error={errors.name}>
            <Input
              type="text"
              placeholder="How you'll appear to housemates"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              autoFocus
            />
          </FormField>
        )}

        <FormField
          label={invite.status === 'new-user' ? 'Create a password' : 'Your password'}
          error={errors.password}
        >
          <Input
            type="password"
            placeholder={invite.status === 'new-user' ? 'Min. 8 characters' : 'Enter your password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={invite.status === 'new-user' ? 'new-password' : 'current-password'}
            autoFocus={invite.status === 'existing-user'}
          />
        </FormField>

        {errors.general && <p style={{ color: '#f87171', fontSize: '0.85rem', margin: 0 }}>{errors.general}</p>}

        <Button type="submit" loading={loading} style={{ marginTop: '0.5rem' }}>
          {invite.status === 'new-user' ? 'Join household' : 'Sign in & join'}
        </Button>
      </form>

      <style>{`
        .invite-headline {
          font-size: 0.9rem;
          color: #71717a;
          margin: -1rem 0 1.5rem;
          line-height: 1.5;
        }
      `}</style>
    </AuthShell>
  )
}
