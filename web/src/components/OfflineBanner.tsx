import { WifiOff } from 'lucide-react'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

// Shown instead of a browser network error when the device has no connection.
// Previously loaded data stays on screen; only fresh loads are affected.
export function OfflineBanner() {
  const isOnline = useOnlineStatus()
  if (isOnline) return null

  return (
    <div className="offline-banner" role="status">
      <WifiOff size={14} strokeWidth={2} aria-hidden="true" />
      <span>You're offline. Showing what was last loaded.</span>

      <style>{`
        .offline-banner {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          background: var(--warning-bg);
          border-bottom: 1px solid var(--warning-border);
          color: var(--warning);
          font-family: 'Geist', sans-serif;
          font-size: 0.8rem;
          font-weight: 500;
          text-align: center;
        }
      `}</style>
    </div>
  )
}
