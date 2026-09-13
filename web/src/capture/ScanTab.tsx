import { useLocation } from 'react-router-dom'
import { ScanLine } from 'lucide-react'
import { useHouseholdStore } from '../stores/householdStore'
import { CaptureInput } from './CaptureInput'
import { useScanCapture, type ScanTarget } from './useScanCapture'

const PROJECT_DETAIL_PATH = /^\/projects\/(?!new$)([^/]+)$/

/** The bottom tab bar's central action: opens the camera, uploads the scan, and
 * lands on its draft review. Scoped to whatever project page it's tapped from,
 * so a scan started inside a project lands there (spec 004 ticket 9). */
export function ScanTab() {
  const location = useLocation()
  const household = useHouseholdStore((s) => s.household)

  const projectMatch = location.pathname.match(PROJECT_DETAIL_PATH)
  const target: ScanTarget | null = projectMatch
    ? { projectId: projectMatch[1]! }
    : household
      ? { householdId: household.id }
      : null

  const { capture, uploading, error, dismissError } = useScanCapture(target)

  return (
    <>
      <CaptureInput onSelect={capture} disabled={uploading || !target} className="tab-scan" aria-label="Scan receipt">
        <ScanLine size={22} strokeWidth={2} aria-hidden="true" />
      </CaptureInput>

      {(uploading || error) && (
        <div className="scan-status" role="status">
          {uploading
            ? <span className="scan-status-msg">Uploading receipt…</span>
            : (
              <span className="scan-status-msg scan-status-msg--error" onClick={dismissError} role="button" tabIndex={0}>
                {error} · tap to dismiss
              </span>
            )}
        </div>
      )}

      <style>{`
        .tab-scan {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          flex-shrink: 0;
          margin-top: -22px;
          border-radius: 50%;
          background: var(--accent);
          color: #fff;
          box-shadow: 0 4px 12px rgba(99,102,241,0.45);
          cursor: pointer;
        }

        .tab-scan[data-disabled] {
          opacity: 0.6;
          pointer-events: none;
        }

        .scan-status {
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          margin-bottom: 0.5rem;
          white-space: nowrap;
        }

        .scan-status-msg {
          display: inline-block;
          background: var(--bg-sidebar);
          border: 1px solid var(--border-subtle);
          border-radius: 999px;
          padding: 0.35rem 0.85rem;
          font-size: 0.75rem;
          color: var(--text-secondary);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }

        .scan-status-msg--error {
          color: var(--danger);
          cursor: pointer;
        }
      `}</style>
    </>
  )
}
