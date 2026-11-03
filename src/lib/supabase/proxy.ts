import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseEnv, hasSupabaseEnv } from './env';
import { resolveSafeOrigin } from './origin';

export async function updateSession(request: NextRequest) {
  if (!hasSupabaseEnv()) {
    return NextResponse.next({ request });
  }

  const { url, key } = getSupabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    if (
      request.nextUrl.pathname === '/' ||
      request.nextUrl.pathname.startsWith('/auth') ||
      request.nextUrl.pathname.startsWith('/api')
    ) {
      return response;
    }
    const loginUrl = new URL('/', resolveSafeOrigin(request));
    loginUrl.searchParams.set('login', 'required');
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
