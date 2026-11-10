import { HANZI_APP_SCOPE } from '@/lib/chains/presets';
import { apiFailure, HttpStatusError, requireSuperadminApi } from '@/lib/chains/server';
import { CHAIN_UUID_PATTERN } from '@/lib/chains/validation';

type RouteCtx = { params: Promise<{ runId: string }> };

export async function DELETE(request: Request, context: RouteCtx) {
  try {
    const { admin } = await requireSuperadminApi(request, { requireJson: false });
    const { runId } = await context.params;
    if (!CHAIN_UUID_PATTERN.test(runId)) {
      throw new HttpStatusError(400, 'Invalid run ID.');
    }

    const { error } = await admin
      .from('prompt_chain_runs')
      .delete()
      .eq('id', runId)
      .eq('app_scope', HANZI_APP_SCOPE);

    if (error) {
      throw new Error(error.message);
    }

    return Response.json(
      { deleted: true, id: runId },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return apiFailure(error);
  }
}
