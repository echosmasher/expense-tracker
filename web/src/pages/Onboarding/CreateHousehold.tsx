import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { households } from '@expense-tracker/shared'
import { useAuthStore } from '../../stores/authStore'
import { useHouseholdStore } from '../../stores/householdStore'
import { AuthShell } from '../../components/AuthShell'
import { FormField, Input } from '../../components/FormField'
import { Button } from '../../components/Button'

export function CreateHousehold() {
  const navigate = useNavigate()
  const userId = useAuthStore((s) => s.userId)!
  const setHousehold = useHouseholdStore((s) => s.setHousehold)

  const [householdName, setHouseholdName] = useState('')
  const [address, setAddress] = useState('')
  // Split displayed for reference; the actual key is updated in Settings once both members join.
  const [share1, setShare1] = useState('50')
  const [share2, setShare2] = useState('50')
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<{ householdName?: string; share1?: string; general?: string }>({})

  function handleShare1Change(val: string) {
    setShare1(val)
    const n = parseInt(val, 10)
    if (!isNaN(n) && n >= 0 && n <= 100) setShare2(String(100 - n))
  }

  function handleShare2Change(val: string) {
    setShare2(val)
    const n = parseInt(val, 10)
    if (!isNaN(n) && n >= 0 && n <= 100) setShare1(String(100 - n))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs: typeof errors = {}
    if (!householdName.trim()) errs.householdName = 'Household name is required'
    const n1 = parseInt(share1, 10)
    const n2 = parseInt(share2, 10)
    if (isNaN(n1) || isNaN(n2) || n1 + n2 !== 100 || n1 < 0 || n2 < 0) {
      errs.share1 = 'Shares must sum to 100%'
    }
    if (Object.keys(errs).length) { setErrors(errs); return }

    setLoading(true)
    setErrors({})
    try {
      // At creation time only the admin exists; send 100% to admin.
      // The intended split (n1/n2) is stored here for reference and can be set in
      // Settings → Members once the second member has accepted their invite.
      const household = await households.create({
        name: householdName.trim(),
        address: address.trim() || undefined,
        allocationKey: [{ userId, shareBp: 10_000 }],
      })
      setHousehold(household)
      navigate('/home')
    } catch (err: any) {
      setErrors({ general: err?.message ?? 'Something went wrong. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell>
      <p className="create-subtitle">Set up your shared home.</p>

      <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <FormField label="Household name" error={errors.householdName}>
          <Input
            type="text"
            placeholder="e.g. Heim, Casa Amigos"
            value={householdName}
            onChange={(e) => setHouseholdName(e.target.value)}
            autoFocus
          />
        </FormField>

        <FormField label="Address (optional)">
          <Input
            type="text"
            placeholder="Street address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </FormField>

        <div>
          <p className="alloc-label">Intended cost split</p>
          <p className="alloc-hint">
            How expenses will be divided once your partner joins. You can confirm this in Settings.
          </p>
          <div className="alloc-row">
            <FormField label="You" error={errors.share1}>
              <div className="alloc-input-wrap">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={share1}
                  onChange={(e) => handleShare1Change(e.target.value)}
                />
                <span className="alloc-pct">%</span>
              </div>
            </FormField>
            <span className="alloc-divider">+</span>
            <FormField label="Them">
              <div className="alloc-input-wrap">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={share2}
                  onChange={(e) => handleShare2Change(e.target.value)}
                />
                <span className="alloc-pct">%</span>
              </div>
            </FormField>
          </div>
        </div>

        {errors.general && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: 0 }}>{errors.general}</p>}

        <Button type="submit" loading={loading} style={{ marginTop: '0.5rem' }}>
          Create household
        </Button>
      </form>

      <style>{`
        .create-subtitle {
          font-size: 0.9rem;
          color: var(--text-muted);
          margin: -1rem 0 1.5rem;
        }
        .alloc-label {
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--text-secondary);
          letter-spacing: 0.06em;
          text-transform: uppercase;
          margin: 0 0 4px;
        }
        .alloc-hint {
          font-size: 0.78rem;
          color: var(--text-faint);
          margin: 0 0 10px;
          line-height: 1.4;
        }
        .alloc-row {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
        }
        .alloc-row > * { flex: 1; }
        .alloc-divider {
          color: var(--text-faint);
          font-size: 1.2rem;
          padding-top: 1.85rem;
          flex: 0 0 auto;
        }
        .alloc-input-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }
        .alloc-pct {
          position: absolute;
          right: 0.75rem;
          color: var(--text-muted);
          font-size: 0.875rem;
          pointer-events: none;
        }
      `}</style>
    </AuthShell>
  )
}
