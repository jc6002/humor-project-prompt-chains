import { HANZI_APP_SCOPE } from '@/lib/chains/presets';
import { apiFailure, HttpStatusError, requireSuperadminApi } from '@/lib/chains/server';
import { CHAIN_UUID_PATTERN } from '@/lib/chains/validation';

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteCtx) {
  try {
    const { admin } = await requireSuperadminApi(request);
    const { id: chainId } = await context.params;
    if (!CHAIN_UUID_PATTERN.test(chainId)) {
      throw new HttpStatusError(400, 'Invalid chain ID.');
    }

    const { data: chain } = await admin
      .from('prompt_chains')
      .select('id')
      .eq('id', chainId)
      .eq('app_scope', HANZI_APP_SCOPE)
      .maybeSingle();

    if (!chain) {
      throw new HttpStatusError(404, 'Prompt chain not found.');
    }

    const body = (await request.json()) as { step_ids?: unknown };
    const stepIds = Array.isArray(body.step_ids) ? body.step_ids.map(String) : [];
    if (stepIds.length === 0 || !stepIds.every((sid) => CHAIN_UUID_PATTERN.test(sid))) {
      throw new HttpStatusError(400, 'Provide a complete array of valid step UUIDs.');
    }

    const { data: reordered, error } = await admin.rpc('reorder_prompt_chain_steps', {
      p_chain_id: chainId,
      p_step_ids: stepIds,
    });

    if (error) {
      throw new Error(error.message);
    }

    return Response.json(
      { steps: reordered ?? [] },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return apiFailure(error);
  }
}
