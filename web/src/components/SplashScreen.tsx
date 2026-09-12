/**
 * Neutral loading state shown while the session is being restored.
 * Deliberately blank of auth UI — never the login page — so nothing flashes.
 */
export function SplashScreen() {
  return (
    <div className="splash-screen" aria-busy="true" aria-live="polite">
      <style>{`
        .splash-screen {
          min-height: 100dvh;
          background: var(--bg-base);
        }
      `}</style>
    </div>
  )
}
