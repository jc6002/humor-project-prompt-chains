import { HANZI_APP_SCOPE } from '@/lib/chains/presets';
import { apiFailure, HttpStatusError, requireSuperadminApi } from '@/lib/chains/server';
import { CHAIN_UUID_PATTERN, validateChainInput } from '@/lib/chains/validation';

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteCtx) {
  try {
    const { admin } = await requireSuperadminApi(request);
    const { id } = await context.params;
    if (!CHAIN_UUID_PATTERN.test(id)) {
      throw new HttpStatusError(400, 'Invalid chain ID.');
    }

    const body = await request.json();
    const validated = validateChainInput(body, { isUpdate: true });

    const { data: updated, error } = await admin
      .from('prompt_chains')
      .update({
        name: validated.name,
        description: validated.description,
        persona_style: validated.persona_style,
        decomposition_mode: validated.decomposition_mode,
        is_active: validated.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('app_scope', HANZI_APP_SCOPE)
      .select('*')
      .single();

    if (error || !updated) {
      throw new HttpStatusError(404, error?.message ?? 'Prompt chain not found.');
    }

    return Response.json({ chain: updated }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function DELETE(request: Request, context: RouteCtx) {
  try {
    const { admin } = await requireSuperadminApi(request, { requireJson: false });
    const { id } = await context.params;
    if (!CHAIN_UUID_PATTERN.test(id)) {
      throw new HttpStatusError(400, 'Invalid chain ID.');
    }

    const { error } = await admin
      .from('prompt_chains')
      .delete()
      .eq('id', id)
      .eq('app_scope', HANZI_APP_SCOPE);

    if (error) {
      throw new Error(error.message);
    }

    return Response.json({ deleted: true, id }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiFailure(error);
  }
}
