import { useLocation } from 'react-router-dom'
import { ScanLine } from 'lucide-react'
import { useHouseholdStore } from '../stores/householdStore'
import { CaptureInput } from './CaptureInput'
import { useScanCapture, type ScanTarget } from './useScanCapture'
import { pendingCount, useCaptureQueueStore } from './queue/captureQueue'

const PROJECT_DETAIL_PATH = /^\/projects\/(?!new$)([^/]+)$/

/** The bottom tab bar's central action: opens the camera, queues the scan, and
 * lands on its draft review once flushed. Scoped to whatever project page it's
 * tapped from, so a scan started inside a project lands there (spec 004 ticket 9).
 * The badge reflects the on-device queue, not just this capture (ticket 10). */
export function ScanTab() {
  const location = useLocation()
  const household = useHouseholdStore((s) => s.household)
  const queueCount = useCaptureQueueStore((s) => pendingCount(s.records))

  const projectMatch = location.pathname.match(PROJECT_DETAIL_PATH)
  const target: ScanTarget | null = projectMatch
    ? { projectId: projectMatch[1]! }
    : household
      ? { householdId: household.id }
      : null

  const { capture, uploading, error, queuedMessage, dismissError, dismissQueuedMessage } = useScanCapture(target)

  return (
    <>
      <CaptureInput onSelect={capture} disabled={uploading || !target} className="tab-scan" aria-label="Scan receipt">
        <ScanLine size={22} strokeWidth={2} aria-hidden="true" />
        {queueCount > 0 && (
          <span className="tab-scan-badge" aria-label={`${queueCount} receipt${queueCount === 1 ? '' : 's'} pending`}>
            {queueCount}
          </span>
        )}
      </CaptureInput>

      {(uploading || error || queuedMessage) && (
        <div className="scan-status" role="status">
          {uploading && <span className="scan-status-msg">Uploading receipt…</span>}
          {!uploading && error && (
            <span className="scan-status-msg scan-status-msg--error" onClick={dismissError} role="button" tabIndex={0}>
              {error} · tap to dismiss
            </span>
          )}
          {!uploading && !error && queuedMessage && (
            <span className="scan-status-msg" onClick={dismissQueuedMessage} role="button" tabIndex={0}>
              {queuedMessage} · tap to dismiss
            </span>
          )}
        </div>
      )}

      <style>{`
        .tab-scan {
          position: relative;
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

        .tab-scan-badge {
          position: absolute;
          top: -2px;
          right: -2px;
          min-width: 18px;
          height: 18px;
          padding: 0 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background: var(--danger);
          color: #fff;
          font-size: 0.6875rem;
          font-weight: 600;
          line-height: 1;
          box-shadow: 0 0 0 2px var(--bg-sidebar);
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
