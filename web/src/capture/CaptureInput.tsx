import type { ReactNode } from 'react'

interface CaptureInputProps {
  onSelect: (file: File) => void
  disabled?: boolean
  className?: string
  'aria-label'?: string
  children: ReactNode
}

/**
 * A file input dressed as its trigger element. No `capture` attribute: on iOS
 * and Android this makes the OS offer both "Take Photo" and "Photo Library"
 * in one picker, rather than jumping straight into the camera and hiding the
 * library option. Devices with no camera (or a desktop browser) fall back to
 * a plain file picker for the same input — no device detection needed.
 * Opening the picker involves no network request, and cancelling it fires no
 * onChange, so nothing is created.
 */
export function CaptureInput({ onSelect, disabled, className, children, ...rest }: CaptureInputProps) {
  return (
    <label className={className} aria-label={rest['aria-label']} data-disabled={disabled || undefined}>
      {children}
      <input
        type="file"
        accept="image/*"
        hidden
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) onSelect(file)
        }}
      />
    </label>
  )
}
