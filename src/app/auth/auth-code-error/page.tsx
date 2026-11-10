import Link from 'next/link';

export default function AuthCodeErrorPage() {
  return (
    <div className="site-shell">
      <main>
        <section className="gate-card">
          <div className="eyebrow eyebrow-danger">AUTHENTICATION ERROR</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: '8px 0' }}>
            Google sign-in could not be completed.
          </h1>
          <p style={{ color: 'var(--fg-secondary)', fontSize: 14, margin: '0 0 16px' }}>
            Verify that your deployment callback URL is registered in Supabase Auth Redirect URLs,
            then sign in again.
          </p>
          <Link href="/" className="app-button-primary" style={{ display: 'inline-flex', width: 'auto' }}>
            Return to Hanzi Parts Studio
          </Link>
        </section>
      </main>
    </div>
  );
}
