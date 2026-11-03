import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveSafeOrigin } from '@/lib/supabase/origin';

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const origin = resolveSafeOrigin(request);
  return NextResponse.redirect(new URL('/', origin), { status: 303 });
}
