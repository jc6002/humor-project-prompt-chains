'use client';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="site-shell">
      <main>
        <section className="gate-card">
          <div className="eyebrow eyebrow-danger">RUNTIME ERROR</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: '8px 0' }}>
            Something interrupted Hanzi Parts Studio.
          </h1>
          <p style={{ color: 'var(--fg-secondary)', fontSize: 14, margin: '0 0 16px' }}>
            {error.message || 'An unexpected application error occurred.'}
          </p>
          <button type="button" className="app-button-primary" onClick={reset}>
            Try again
          </button>
        </section>
      </main>
    </div>
  );
}
