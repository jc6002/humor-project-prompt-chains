import { apiFailure, requireSuperadminApi } from '@/lib/chains/server';
import { CHAIN_UUID_PATTERN, validateChainInput } from '@/lib/chains/validation';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!CHAIN_UUID_PATTERN.test(id)) {
      throw new Error('Invalid chain ID.');
    }
    const { admin } = await requireSuperadminApi(request);
    const body = (await request.json()) as Record<string, unknown>;
    const updates = validateChainInput(body, true);
    if (Object.keys(updates).length === 0) {
      throw new Error('No chain fields supplied to update.');
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await admin
      .from('prompt_chains')
      .update(updates)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      if (error.code === '23505') {
        throw new Error(`A prompt chain with slug "${String(updates.slug)}" already exists.`);
      }
      throw new Error(error.message);
    }
    if (!data) {
      throw new Error('Prompt chain not found.');
    }

    return Response.json({ chain: data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return apiFailure(err);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!CHAIN_UUID_PATTERN.test(id)) {
      throw new Error('Invalid chain ID.');
    }
    const { admin } = await requireSuperadminApi(request, { requireJson: false });

    const { error } = await admin.from('prompt_chains').delete().eq('id', id);
    if (error) {
      throw new Error(error.message);
    }

    return Response.json({ deletedId: id }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return apiFailure(err);
  }
}
