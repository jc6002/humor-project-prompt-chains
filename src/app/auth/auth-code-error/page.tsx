import Link from 'next/link';
import { resolveOptionalHttpUrl } from '@/lib/supabase/origin';
import { StudioHeader } from '@/components/studio-header';

export default function AuthCodeErrorPage() {
  const arenaUrl = resolveOptionalHttpUrl(process.env.NEXT_PUBLIC_ARENA_URL);
  const adminUrl = resolveOptionalHttpUrl(process.env.NEXT_PUBLIC_ADMIN_URL);

  return (
    <div className="site-shell">
      <StudioHeader userEmail={null} arenaUrl={arenaUrl} adminUrl={adminUrl} />
      <main>
        <section className="gate-card gate-card-solid">
          <div className="eyebrow eyebrow-danger">OAUTH CALLBACK ERROR</div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, margin: '8px 0 10px' }}>
            Google sign-in could not be completed.
          </h1>
          <p style={{ color: 'var(--fg-secondary)', fontSize: '14.5px', margin: '0 0 18px' }}>
            The OAuth authorization code expired or did not match an active browser session. Start a
            fresh Google sign-in flow below.
          </p>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <a href="/auth/signin" className="button">
              Try Google sign-in again ↗
            </a>
            <Link href="/" className="button button-outline">
              Back to Studio →
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
