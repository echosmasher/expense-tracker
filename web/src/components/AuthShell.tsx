/**
 * AuthShell — shared layout for all auth/onboarding pages.
 * Dot-grid background, centered card, Instrument Serif wordmark.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell">
      {/* Dot-grid background */}
      <div className="auth-dots" aria-hidden />

      <div className="auth-card">
        <div className="auth-wordmark">
          <span className="auth-wordmark-serif">Household Wizard</span>
          <span className="auth-wordmark-dot">.</span>
        </div>
        {children}
      </div>

      <style>{`

        .auth-shell {
          min-height: 100dvh;
          background: var(--bg-base);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1.5rem;
          font-family: 'Geist', 'DM Sans', sans-serif;
          position: relative;
          overflow: hidden;
        }

        .auth-dots {
          position: fixed;
          inset: 0;
          background-image: radial-gradient(circle, var(--border) 1px, transparent 1px);
          background-size: 28px 28px;
          opacity: 0.45;
          pointer-events: none;
        }

        .auth-card {
          position: relative;
          width: 100%;
          max-width: 420px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 20px;
          padding: 2.5rem 2rem;
          box-shadow: 0 0 0 1px rgba(255,255,255,0.03), 0 24px 48px rgba(0,0,0,0.5);
          animation: card-in 0.35s cubic-bezier(0.22,1,0.36,1) both;
        }

        @keyframes card-in {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .auth-wordmark {
          margin-bottom: 2rem;
          font-family: 'Instrument Serif', Georgia, serif;
          font-style: italic;
          font-size: 1.6rem;
          color: var(--text-primary);
          letter-spacing: -0.01em;
        }

        .auth-wordmark-dot {
          color: var(--accent);
        }
      `}</style>
    </div>
  )
}
