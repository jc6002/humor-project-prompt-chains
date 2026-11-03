import {
  apiFailure,
  requireSuperadminApi,
  runPromptChainSequentially,
} from '@/lib/chains/server';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: chainId } = await context.params;
    const { admin, user } = await requireSuperadminApi(request);
    const body = (await request.json()) as Record<string, unknown>;
    const run = await runPromptChainSequentially({
      admin,
      user,
      chainId,
      body,
    });
    return Response.json({ run }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return apiFailure(err);
  }
}
