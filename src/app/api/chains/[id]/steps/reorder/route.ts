import {
  apiFailure,
  reorderChainStepsAtomically,
  requireSuperadminApi,
} from '@/lib/chains/server';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: chainId } = await context.params;
    const { admin } = await requireSuperadminApi(request);
    const body = (await request.json()) as { stepIds?: unknown };
    const stepIds = Array.isArray(body?.stepIds) ? (body.stepIds as string[]) : [];

    const ordered = await reorderChainStepsAtomically(admin, chainId, stepIds);
    return Response.json({ steps: ordered }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return apiFailure(err);
  }
}
