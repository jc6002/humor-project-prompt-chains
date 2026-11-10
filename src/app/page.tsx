import { hasSupabaseEnv } from '@/lib/supabase/env';
import { checkSuperadmin, fetchStudioInitialData } from '@/lib/chains/server';
import { HanziMnemonicStudio } from '@/components/hanzi-mnemonic-studio';
import { StudioHeader } from '@/components/studio-header';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    authError?: string;
    chain?: string;
    deck?: string;
  }>;
}

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;

  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return (
      <div className="site-shell">
        <StudioHeader userEmail={null} />
        <main className="workbench-main">
          <section className="gate-card">
            <div className="eyebrow eyebrow-danger">SERVER CONFIGURATION REQUIRED</div>
            <h1 style={{ fontSize: 23, fontWeight: 800, lineHeight: 1.25, margin: '8px 0 10px' }}>
              Connect Supabase credentials to launch Hanzi Parts Studio.
            </h1>
            <p style={{ color: 'var(--fg-secondary)', fontSize: 14, margin: 0, lineHeight: 1.55 }}>
              Configure <code>NEXT_PUBLIC_SUPABASE_URL</code>,{' '}
              <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, and{' '}
              <code>SUPABASE_SERVICE_ROLE_KEY</code> in <code>.env.local</code> or your deployment
              environment variables, then reload this page.
            </p>
          </section>
        </main>
      </div>
    );
  }

  const gate = await checkSuperadmin();

  if (gate.status === 'unauthenticated') {
    return (
      <div className="site-shell">
        <StudioHeader userEmail={null} />
        <main className="workbench-main">
          <section className="gate-card">
            <div className="eyebrow">HANZI PARTS STUDIO · CHINESE MNEMONICS</div>
            <h1 style={{ fontSize: 25, fontWeight: 800, lineHeight: 1.2, margin: '8px 0' }}>
              Sign in with Google
            </h1>
            <p style={{ color: 'var(--fg-secondary)', fontSize: 14, margin: '0 0 18px', lineHeight: 1.55 }}>
              Enter one Simplified Chinese character or compound word and get one stroke-coloured
              visual mnemonic flashcard. Access requires an account with{' '}
              <code>profiles.is_superadmin == TRUE</code>.
            </p>
            {params.authError === 'signin' && (
              <div className="alert-error" style={{ marginBottom: 14 }}>
                Could not initiate Google OAuth sign-in. Verify Supabase Google Auth settings.
              </div>
            )}
            <a
              href="/auth/signin"
              className="app-button-primary"
              style={{ width: 'auto', padding: '10px 20px' }}
            >
              Sign in with Google →
            </a>
          </section>
        </main>
      </div>
    );
  }

  if (gate.status === 'forbidden') {
    return (
      <div className="site-shell">
        <StudioHeader userEmail={gate.user.email} />
        <main className="workbench-main">
          <section className="gate-card">
            <div className="eyebrow eyebrow-danger">403 · SUPERADMIN ACCESS REQUIRED</div>
            <h1 style={{ fontSize: 23, fontWeight: 800, lineHeight: 1.25, margin: '8px 0' }}>
              Superadmin Access Required
            </h1>
            <p style={{ color: 'var(--fg-secondary)', fontSize: 14, margin: 0, lineHeight: 1.55 }}>
              Signed in as <strong>{gate.user.email}</strong>. Ask an administrator to enable{' '}
              <code>profiles.is_superadmin</code> on your account, or sign in with an authorized
              account.
            </p>
          </section>
        </main>
      </div>
    );
  }

  const initialData = await fetchStudioInitialData();
  const initialDeckScope = params.deck === 'all' ? 'all' : 'chain';

  return (
    <HanziMnemonicStudio
      initialData={initialData}
      userEmail={gate.user.email}
      initialChainSlug={params.chain ?? null}
      initialDeckScope={initialDeckScope}
    />
  );
}
