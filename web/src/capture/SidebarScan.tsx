import { ScanLine } from 'lucide-react'
import { CaptureInput } from './CaptureInput'
import { useScanCapture } from './useScanCapture'
import { useScanTarget } from './useScanTarget'
import { pendingCount, useCaptureQueueStore } from './queue/captureQueue'

/** The desktop sidebar's equivalent of the phone tab bar's Scan action — same
 * queue-backed capture, just a plain nav-styled row instead of a raised button.
 * CaptureInput has no camera-only hint, so this opens a normal file picker:
 * "choosing an existing image" (spec 004 US3,
 * acceptance scenario 6) on a device with no camera. */
export function SidebarScan() {
  const target = useScanTarget()
  const queueCount = useCaptureQueueStore((s) => pendingCount(s.records))

  const { capture, uploading, error, queuedMessage, dismissError, dismissQueuedMessage } = useScanCapture(target)

  return (
    <div className="sidebar-scan">
      <CaptureInput onSelect={capture} disabled={uploading || !target} className="nav-item sidebar-scan-trigger" aria-label="Scan receipt">
        <ScanLine className="nav-icon" size={18} strokeWidth={1.75} aria-hidden="true" />
        <span className="nav-label">Scan Receipt</span>
        {queueCount > 0 && <span className="sidebar-scan-badge">{queueCount}</span>}
      </CaptureInput>

      {uploading && <p className="sidebar-scan-status">Uploading receipt…</p>}
      {!uploading && error && (
        <p className="sidebar-scan-status sidebar-scan-status--error" onClick={dismissError} role="button" tabIndex={0}>
          {error} · tap to dismiss
        </p>
      )}
      {!uploading && !error && queuedMessage && (
        <p className="sidebar-scan-status" onClick={dismissQueuedMessage} role="button" tabIndex={0}>
          {queuedMessage} · tap to dismiss
        </p>
      )}

      <style>{`
        .sidebar-scan-trigger {
          display: flex;
          align-items: center;
          cursor: pointer;
        }
        .sidebar-scan-trigger[data-disabled] {
          opacity: 0.6;
          pointer-events: none;
        }
        .sidebar-scan-badge {
          margin-left: auto;
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background: var(--danger);
          color: #fff;
          font-size: 0.6875rem;
          font-weight: 600;
          line-height: 1;
        }
        .sidebar-scan-status {
          margin: 0.25rem 1.25rem 0;
          font-size: 0.75rem;
          color: var(--text-secondary);
          cursor: pointer;
        }
        .sidebar-scan-status--error { color: var(--danger); }
      `}</style>
    </div>
  )
}
