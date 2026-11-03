import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveSafeNextPath, resolveSafeOrigin } from '@/lib/supabase/origin';

export async function GET(request: Request) {
  const reqUrl = new URL(request.url);
  const origin = resolveSafeOrigin(request);
  const safeNext = resolveSafeNextPath(reqUrl.searchParams.get('next'), origin, '');

  const callbackUrl = new URL('/auth/callback', origin);
  if (safeNext) {
    callbackUrl.searchParams.set('next', safeNext);
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callbackUrl.toString(),
      },
    });

    if (error || !data.url) {
      throw error ?? new Error('No OAuth URL was returned.');
    }

    return NextResponse.redirect(data.url);
  } catch {
    const fallback = new URL('/', origin);
    fallback.searchParams.set('authError', 'signin');
    return NextResponse.redirect(fallback);
  }
}
