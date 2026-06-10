import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { auth } from '@expense-tracker/shared'
import { useAuthStore } from '../../stores/authStore'
import { AuthShell } from '../../components/AuthShell'
import { FormField, Input } from '../../components/FormField'
import { Button } from '../../components/Button'

export function Login() {
  const navigate = useNavigate()
  const setUser = useAuthStore((s) => s.setUser)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; password?: string; general?: string }>({})

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs: typeof errors = {}
    if (!email.trim()) errs.email = 'Email is required'
    if (!password) errs.password = 'Password is required'
    if (Object.keys(errs).length) { setErrors(errs); return }

    setLoading(true)
    setErrors({})
    try {
      const res = await auth.login({ email: email.trim(), password })
      setUser(res.user, res.accessToken)
      navigate('/home')
    } catch (err: any) {
      if (err?.status === 401) {
        setErrors({ general: 'Incorrect email or password.' })
      } else {
        setErrors({ general: err?.message ?? 'Something went wrong. Please try again.' })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell>
      <p className="auth-subtitle">Welcome back.</p>
      <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <FormField label="Email" error={errors.email}>
          <Input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoFocus
          />
        </FormField>
        <FormField label="Password" error={errors.password}>
          <Input
            type="password"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </FormField>

        {errors.general && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: 0 }}>{errors.general}</p>}

        <Button type="submit" loading={loading} style={{ marginTop: '0.5rem' }}>
          Sign in
        </Button>
      </form>

      <p style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
        Don't have an account?{' '}
        <Link to="/register" style={{ color: 'var(--accent-light)', textDecoration: 'none', fontWeight: 500 }}>
          Create one
        </Link>
      </p>

      <style>{`
        .auth-subtitle {
          font-size: 0.9rem;
          color: var(--text-muted);
          margin: -1rem 0 1.5rem;
        }
      `}</style>
    </AuthShell>
  )
}
