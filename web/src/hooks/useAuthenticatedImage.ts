import { useEffect, useState } from 'react'
import { fetchImage } from '@expense-tracker/shared'

/**
 * Resolves an API image path (e.g. `expense.receiptImageUrl`) to a local
 * object URL via an authenticated fetch. Receipts and avatars no longer come
 * from a signed URL, so `<img src>` can't point at the path directly.
 */
export function useAuthenticatedImage(path: string | null | undefined): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!path) {
      setObjectUrl(null)
      return
    }

    let cancelled = false
    let url: string | null = null

    fetchImage(path)
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setObjectUrl(url)
      })
      .catch(() => {
        if (!cancelled) setObjectUrl(null)
      })

    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [path])

  return objectUrl
}
