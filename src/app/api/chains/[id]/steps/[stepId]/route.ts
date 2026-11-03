import {
  apiFailure,
  reorderChainStepsAtomically,
  requireSuperadminApi,
} from '@/lib/chains/server';
import { CHAIN_UUID_PATTERN, validateStepInput } from '@/lib/chains/validation';

type RouteContext = { params: Promise<{ id: string; stepId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id: chainId, stepId } = await context.params;
    if (!CHAIN_UUID_PATTERN.test(chainId) || !CHAIN_UUID_PATTERN.test(stepId)) {
      throw new Error('Invalid chain or step ID.');
    }
    const { admin } = await requireSuperadminApi(request);
    const body = (await request.json()) as Record<string, unknown>;
    const updates = validateStepInput(body, true);
    if (Object.keys(updates).length === 0) {
      throw new Error('No step fields supplied to update.');
    }

    const { data, error } = await admin
      .from('prompt_chain_steps')
      .update(updates)
      .eq('chain_id', chainId)
      .eq('id', stepId)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }
    if (!data) {
      throw new Error('Prompt chain step not found.');
    }

    await admin
      .from('prompt_chains')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', chainId);

    return Response.json({ step: data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return apiFailure(err);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id: chainId, stepId } = await context.params;
    if (!CHAIN_UUID_PATTERN.test(chainId) || !CHAIN_UUID_PATTERN.test(stepId)) {
      throw new Error('Invalid chain or step ID.');
    }
    const { admin } = await requireSuperadminApi(request, { requireJson: false });

    const { error } = await admin
      .from('prompt_chain_steps')
      .delete()
      .eq('chain_id', chainId)
      .eq('id', stepId);
    if (error) {
      throw new Error(error.message);
    }

    const { data: remainingRows, error: remErr } = await admin
      .from('prompt_chain_steps')
      .select('id, step_order')
      .eq('chain_id', chainId)
      .order('step_order', { ascending: true });
    if (remErr) {
      throw new Error(remErr.message);
    }

    const remainingIds = (remainingRows ?? []).map((r: { id: string }) => r.id);
    const compacted =
      remainingIds.length > 0
        ? await reorderChainStepsAtomically(admin, chainId, remainingIds)
        : [];

    if (remainingIds.length === 0) {
      await admin
        .from('prompt_chains')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', chainId);
    }

    return Response.json(
      { deletedId: stepId, steps: compacted },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return apiFailure(err);
  }
}
