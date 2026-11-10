import { HANZI_APP_SCOPE } from '@/lib/chains/presets';
import { apiFailure, HttpStatusError, requireSuperadminApi } from '@/lib/chains/server';
import { CHAIN_UUID_PATTERN, validateStepInput } from '@/lib/chains/validation';

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

    const validated = validateStepInput(await request.json());
    const { data: existing } = await admin
      .from('prompt_chain_steps')
      .select('step_order')
      .eq('chain_id', chainId)
      .order('step_order', { ascending: false })
      .limit(1);

    const nextOrder = (existing?.[0]?.step_order ?? 0) + 1;

    const { data: created, error } = await admin
      .from('prompt_chain_steps')
      .insert({
        chain_id: chainId,
        step_order: nextOrder,
        ...validated,
      })
      .select('*')
      .single();

    if (error || !created) {
      throw new Error(error?.message ?? 'Failed to add chain step.');
    }

    return Response.json({ step: created }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiFailure(error);
  }
}
