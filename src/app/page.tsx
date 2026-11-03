import { hasSupabaseEnv } from '@/lib/supabase/env';
import { resolveOptionalHttpUrl } from '@/lib/supabase/origin';
import { checkSuperadmin, fetchStudioInitialData } from '@/lib/chains/server';
import { StudioHeader } from '@/components/studio-header';
import { ForbiddenSqlCopy } from '@/components/forbidden-sql-copy';
import { PromptChainStudio } from '@/components/prompt-chain-studio';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{ authError?: string; chain?: string }>;
};

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const arenaUrl = resolveOptionalHttpUrl(process.env.NEXT_PUBLIC_ARENA_URL);
  const adminUrl = resolveOptionalHttpUrl(process.env.NEXT_PUBLIC_ADMIN_URL);

  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return (
      <div className="site-shell">
        <StudioHeader userEmail={null} arenaUrl={arenaUrl} adminUrl={adminUrl} />
        <main>
          <section className="gate-card gate-card-solid">
            <div className="eyebrow eyebrow-danger">SERVER CONFIGURATION REQUIRED</div>
            <h1 style={{ fontSize: '26px', fontWeight: 800, margin: '8px 0 10px' }}>
              Connect Supabase credentials to launch Prompt Chain Studio.
            </h1>
            <p style={{ color: 'var(--fg-secondary)', fontSize: '14.5px', margin: 0 }}>
              Set <code>SUPABASE_URL</code>, <code>SUPABASE_ANON_KEY</code>, and{' '}
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
        <StudioHeader userEmail={null} arenaUrl={arenaUrl} adminUrl={adminUrl} />
        <main>
          <section className="gate-card" style={{ maxWidth: '560px' }}>
            <div className="eyebrow">SUPERADMIN STUDIO · GOOGLE OAUTH</div>
            <h1
              style={{
                fontSize: '28px',
                fontWeight: 800,
                lineHeight: 1.2,
                letterSpacing: '-0.02em',
                margin: '10px 0 12px',
              }}
            >
              Sign in to open Prompt Chain Studio.
            </h1>
            <p style={{ color: 'var(--fg-secondary)', fontSize: '14.5px', margin: '0 0 18px' }}>
              Author multi-step vision + humor pipelines, test live image caption chains, and inspect
              intermediate step traces. Requires <code>profiles.is_superadmin = TRUE</code>.
            </p>
            {params.authError === 'domain_restricted' && (
              <div className="alert-error" style={{ marginBottom: '14px' }}>
                Your Google email domain is not on the active signup allowlist for this workspace.
              </div>
            )}
            {params.authError === 'signin' && (
              <div className="alert-error" style={{ marginBottom: '14px' }}>
                Could not initiate Google OAuth sign-in. Verify Supabase Google Auth settings.
              </div>
            )}
            <a href="/auth/signin" className="button">
              Sign in with Google ↗
            </a>
          </section>
        </main>
      </div>
    );
  }

  if (gate.status === 'forbidden') {
    return (
      <div className="site-shell">
        <StudioHeader userEmail={gate.user.email} arenaUrl={arenaUrl} adminUrl={adminUrl} />
        <main>
          <section className="gate-card gate-card-solid">
            <div className="eyebrow eyebrow-danger">403 · SUPERADMIN ROLE REQUIRED</div>
            <h1
              style={{
                fontSize: '26px',
                fontWeight: 800,
                lineHeight: 1.22,
                margin: '8px 0 10px',
              }}
            >
              Signed in without Studio privileges.
            </h1>
            <p style={{ color: 'var(--fg-secondary)', fontSize: '14.5px', margin: '0 0 8px' }}>
              Signed in as <strong>{gate.user.email}</strong>, where{' '}
              <code>profiles.is_superadmin</code> is <code>FALSE</code>.
            </p>
            <p style={{ color: 'var(--muted)', fontSize: '13px', margin: 0 }}>
              Run the SQL statement below in the Supabase SQL Editor to grant superadmin access, or
              switch to an authorized account:
            </p>
            <ForbiddenSqlCopy userId={gate.user.id} />
          </section>
        </main>
      </div>
    );
  }

  const initialData = await fetchStudioInitialData();

  return (
    <div className="site-shell">
      <StudioHeader userEmail={gate.user.email} arenaUrl={arenaUrl} adminUrl={adminUrl} />
      <main>
        <PromptChainStudio
          initialData={initialData}
          initialChainSlug={typeof params.chain === 'string' ? params.chain : null}
        />
      </main>
    </div>
  );
}
