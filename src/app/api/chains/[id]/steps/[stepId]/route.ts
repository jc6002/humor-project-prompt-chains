import { HANZI_APP_SCOPE } from '@/lib/chains/presets';
import { apiFailure, HttpStatusError, requireSuperadminApi } from '@/lib/chains/server';
import { CHAIN_UUID_PATTERN, validateStepInput } from '@/lib/chains/validation';

type RouteCtx = { params: Promise<{ id: string; stepId: string }> };

export async function PATCH(request: Request, context: RouteCtx) {
  try {
    const { admin } = await requireSuperadminApi(request);
    const { id: chainId, stepId } = await context.params;
    if (!CHAIN_UUID_PATTERN.test(chainId) || !CHAIN_UUID_PATTERN.test(stepId)) {
      throw new HttpStatusError(400, 'Invalid chain or step ID.');
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

    const validated = validateStepInput(await request.json());
    const { data: updated, error } = await admin
      .from('prompt_chain_steps')
      .update(validated)
      .eq('id', stepId)
      .eq('chain_id', chainId)
      .select('*')
      .single();

    if (error || !updated) {
      throw new HttpStatusError(404, error?.message ?? 'Chain step not found.');
    }

    return Response.json({ step: updated }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function DELETE(request: Request, context: RouteCtx) {
  try {
    const { admin } = await requireSuperadminApi(request, { requireJson: false });
    const { id: chainId, stepId } = await context.params;
    if (!CHAIN_UUID_PATTERN.test(chainId) || !CHAIN_UUID_PATTERN.test(stepId)) {
      throw new HttpStatusError(400, 'Invalid chain or step ID.');
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

    const { data: allSteps } = await admin
      .from('prompt_chain_steps')
      .select('id')
      .eq('chain_id', chainId)
      .order('step_order', { ascending: true });

    if (!allSteps || allSteps.length <= 1) {
      throw new HttpStatusError(400, 'A prompt chain must retain at least one step.');
    }

    const { error: delErr } = await admin
      .from('prompt_chain_steps')
      .delete()
      .eq('id', stepId)
      .eq('chain_id', chainId);

    if (delErr) {
      throw new Error(delErr.message);
    }

    const remainingIds = allSteps.filter((s) => s.id !== stepId).map((s) => s.id);
    const { data: reordered, error: rpcErr } = await admin.rpc('reorder_prompt_chain_steps', {
      p_chain_id: chainId,
      p_step_ids: remainingIds,
    });

    if (rpcErr) {
      throw new Error(rpcErr.message);
    }

    return Response.json(
      { deleted: true, steps: reordered ?? [] },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return apiFailure(error);
  }
}
