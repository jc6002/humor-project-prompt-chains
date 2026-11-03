import { apiFailure, requireSuperadminApi } from '@/lib/chains/server';
import { CHAIN_UUID_PATTERN } from '@/lib/chains/validation';

type RouteContext = { params: Promise<{ runId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { runId } = await context.params;
    if (!CHAIN_UUID_PATTERN.test(runId)) {
      throw new Error('Invalid run ID.');
    }
    const { admin } = await requireSuperadminApi(request, { requireJson: false });
    const { error } = await admin.from('prompt_chain_runs').delete().eq('id', runId);
    if (error) {
      throw new Error(error.message);
    }
    return Response.json({ deletedId: runId }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return apiFailure(err);
  }
}
