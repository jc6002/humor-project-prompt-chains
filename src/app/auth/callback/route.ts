import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/chains/server';
import { escapePostgrestIlike } from '@/lib/chains/validation';
import { resolveSafeNextPath, resolveSafeOrigin } from '@/lib/supabase/origin';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const origin = resolveSafeOrigin(request);

  if (!code) {
    return NextResponse.redirect(new URL('/auth/auth-code-error', origin));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(new URL('/auth/auth-code-error', origin));
  }

  if (process.env.SUPABASE_SERVICE_ROLE_KEY && data.user.email) {
    try {
      const admin = adminClient();
      const emailLower = data.user.email.trim().toLowerCase();
      const domain = emailLower.split('@')[1] ?? '';

      const [{ data: domains }, { data: whitelist }] = await Promise.all([
        admin.from('allowed_signup_domains').select('domain').eq('is_active', true),
        admin
          .from('whitelisted_emails')
          .select('email, auto_superadmin')
          .eq('is_active', true)
          .ilike('email', escapePostgrestIlike(emailLower)),
      ]);

      const whitelistedEntry = (whitelist ?? []).find(
        (w: { email?: string }) => String(w.email ?? '').trim().toLowerCase() === emailLower
      );

      if (domains && domains.length > 0 && !whitelistedEntry) {
        const domainAllowed = domains.some((d: { domain?: string }) => {
          const clean = String(d.domain).toLowerCase().replace(/^@/, '');
          return domain === clean || domain.endsWith(`.${clean}`);
        });

        if (!domainAllowed) {
          const rejectedUserId = data.user.id;
          await supabase.auth.signOut();
          try {
            await admin.from('profiles').delete().eq('id', rejectedUserId);
            await admin.auth.admin.deleteUser(rejectedUserId);
          } catch {
            // Best-effort cleanup if user had pre-existing FK records
          }
          const deniedUrl = new URL('/', origin);
          deniedUrl.searchParams.set('authError', 'domain_restricted');
          return NextResponse.redirect(deniedUrl);
        }
      }

      if (whitelistedEntry?.auto_superadmin) {
        await admin
          .from('profiles')
          .upsert(
            { id: data.user.id, email: data.user.email, is_superadmin: true },
            { onConflict: 'id' }
          );
      }
    } catch {
      // Allow login if optional access-control tables are not yet migrated
    }
  }

  const safePath = resolveSafeNextPath(requestUrl.searchParams.get('next'), origin, '/');
  return NextResponse.redirect(new URL(safePath, origin));
}
