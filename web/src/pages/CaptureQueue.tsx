import { useEffect, useState } from 'react'
import { discardCapture, retryCapture, useCaptureQueueStore } from '../capture/queue/captureQueue'
import type { CaptureRecord } from '../capture/queue/reducer'

function targetLabel(target: CaptureRecord['target']) {
  return 'projectId' in target ? 'Project' : 'Household'
}

function ageLabel(capturedAt: number) {
  const minutes = Math.round((Date.now() - capturedAt) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function statusLabel(status: CaptureRecord['status']) {
  return status === 'queued' ? 'Queued' : status === 'uploading' ? 'Uploading…' : 'Failed'
}

function Thumbnail({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])

  return url ? <img src={url} alt="" className="queue-thumb" /> : <div className="queue-thumb queue-thumb--empty" />
}

function QueueItem({ record }: { record: CaptureRecord }) {
  return (
    <li className="queue-item">
      <Thumbnail blob={record.blob} />
      <div className="queue-item-info">
        <span className="queue-item-target">{targetLabel(record.target)}</span>
        <span className="queue-item-meta">
          {ageLabel(record.capturedAt)} · <span className={`queue-item-status queue-item-status--${record.status}`}>{statusLabel(record.status)}</span>
        </span>
        {record.status === 'failed' && record.lastError && (
          <span className="queue-item-error">{record.lastError}</span>
        )}
      </div>
      {record.status === 'failed' && (
        <div className="queue-item-actions">
          <button className="queue-action" onClick={() => retryCapture(record.id)}>Retry</button>
          <button className="queue-action queue-action--danger" onClick={() => discardCapture(record.id)}>Discard</button>
        </div>
      )}
    </li>
  )
}

export function CaptureQueue() {
  const records = useCaptureQueueStore((s) => s.records)
  const sorted = [...records].sort((a, b) => b.capturedAt - a.capturedAt)

  return (
    <div className="queue-page">
      <h1 className="queue-title">Capture queue</h1>

      {sorted.length === 0 ? (
        <p className="queue-empty">No pending captures.</p>
      ) : (
        <ul className="queue-list">
          {sorted.map((record) => (
            <QueueItem key={record.id} record={record} />
          ))}
        </ul>
      )}

      <style>{`
        .queue-page { padding: 1.25rem 1rem 1.5rem; max-width: 480px; margin: 0 auto; }
        .queue-title { font-size: 1.375rem; font-weight: 600; margin: 0 0 1rem; letter-spacing: -0.025em; }
        .queue-empty { color: var(--text-secondary); font-size: 0.9375rem; }
        .queue-list {
          display: flex;
          flex-direction: column;
          gap: 2px;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          overflow: hidden;
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .queue-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem 1rem;
          border-bottom: 1px solid var(--border-subtle);
        }
        .queue-item:last-child { border-bottom: none; }
        .queue-thumb {
          width: 44px;
          height: 44px;
          border-radius: 8px;
          object-fit: cover;
          flex-shrink: 0;
          background: var(--bg-card-hover);
        }
        .queue-thumb--empty { }
        .queue-item-info { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; flex: 1; }
        .queue-item-target { font-size: 0.9375rem; font-weight: 500; }
        .queue-item-meta { font-size: 0.8125rem; color: var(--text-secondary); }
        .queue-item-status--failed { color: var(--danger); }
        .queue-item-error {
          font-size: 0.75rem;
          color: var(--danger);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .queue-item-actions { display: flex; flex-direction: column; gap: 0.35rem; flex-shrink: 0; }
        .queue-action {
          font-size: 0.75rem;
          padding: 0.3rem 0.6rem;
          border-radius: 6px;
          border: 1px solid var(--border-subtle);
          background: none;
          color: var(--text-primary);
          cursor: pointer;
        }
        .queue-action--danger { color: var(--danger); border-color: var(--danger); }
      `}</style>
    </div>
  )
}
