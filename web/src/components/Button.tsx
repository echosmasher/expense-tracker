interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost'
  loading?: boolean
}

export function Button({ variant = 'primary', loading, children, disabled, ...props }: ButtonProps) {
  return (
    <>
      <button
        className={`btn btn-${variant}`}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? <LoadingDots /> : children}
      </button>
      <style>{`
        .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          border: none;
          border-radius: 10px;
          font-family: inherit;
          font-size: 0.9375rem;
          font-weight: 500;
          padding: 0.7rem 1.25rem;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.1s, background 0.15s;
          width: 100%;
        }
        .btn:active { transform: scale(0.98); }
        .btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
        .btn-primary {
          background: var(--accent);
          color: #fff;
        }
        .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
        .btn-ghost {
          background: var(--badge-bg);
          color: var(--text-secondary);
        }
        .btn-ghost:hover:not(:disabled) { background: var(--border-input); color: var(--text-primary); }
      `}</style>
    </>
  )
}

function LoadingDots() {
  return (
    <>
      <span className="dots">
        <span /><span /><span />
      </span>
      <style>{`
        .dots { display: inline-flex; gap: 4px; align-items: center; }
        .dots span {
          width: 5px; height: 5px;
          background: currentColor; border-radius: 50%;
          animation: dot-pulse 1.2s ease-in-out infinite;
        }
        .dots span:nth-child(2) { animation-delay: 0.2s; }
        .dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes dot-pulse {
          0%, 80%, 100% { opacity: 0.25; transform: scale(0.85); }
          40%            { opacity: 1;    transform: scale(1); }
        }
      `}</style>
    </>
  )
}
