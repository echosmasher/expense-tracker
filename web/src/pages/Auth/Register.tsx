import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { auth } from '@expense-tracker/shared'
import { useAuthStore } from '../../stores/authStore'
import { AuthShell } from '../../components/AuthShell'
import { FormField, Input } from '../../components/FormField'
import { Button } from '../../components/Button'

export function Register() {
  const navigate = useNavigate()
  const setUser = useAuthStore((s) => s.setUser)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string; general?: string }>({})

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs: typeof errors = {}
    if (!name.trim()) errs.name = 'Name is required'
    if (!email.trim()) errs.email = 'Email is required'
    if (password.length < 8) errs.password = 'Password must be at least 8 characters'
    if (Object.keys(errs).length) { setErrors(errs); return }

    setLoading(true)
    setErrors({})
    try {
      const res = await auth.register({ name: name.trim(), email: email.trim(), password })
      setUser(res.user, res.accessToken)
      navigate('/create-household')
    } catch (err: any) {
      if (err?.status === 409) {
        setErrors({ email: 'An account with this email already exists' })
      } else {
        setErrors({ general: err?.message ?? 'Something went wrong. Please try again.' })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell>
      <p className="auth-subtitle">Track shared expenses together.</p>
      <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <FormField label="Name" error={errors.name}>
          <Input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            autoFocus
          />
        </FormField>
        <FormField label="Email" error={errors.email}>
          <Input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </FormField>
        <FormField label="Password" error={errors.password}>
          <Input
            type="password"
            placeholder="Min. 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </FormField>

        {errors.general && <p style={{ color: '#f87171', fontSize: '0.85rem', margin: 0 }}>{errors.general}</p>}

        <Button type="submit" loading={loading} style={{ marginTop: '0.5rem' }}>
          Create account
        </Button>
      </form>

      <p style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.875rem', color: '#71717a' }}>
        Already have an account?{' '}
        <Link to="/login" style={{ color: '#818cf8', textDecoration: 'none', fontWeight: 500 }}>
          Sign in
        </Link>
      </p>

      <style>{`
        .auth-subtitle {
          font-size: 0.9rem;
          color: #71717a;
          margin: -1rem 0 1.5rem;
        }
      `}</style>
    </AuthShell>
  )
}
