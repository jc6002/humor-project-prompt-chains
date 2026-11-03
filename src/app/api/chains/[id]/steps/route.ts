import { apiFailure, requireSuperadminApi } from '@/lib/chains/server';
import { CHAIN_UUID_PATTERN, validateStepInput } from '@/lib/chains/validation';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: chainId } = await context.params;
    if (!CHAIN_UUID_PATTERN.test(chainId)) {
      throw new Error('Invalid chain ID.');
    }
    const { admin } = await requireSuperadminApi(request);
    const body = (await request.json()) as Record<string, unknown>;
    const payload = validateStepInput(body, false);

    const [{ data: chainRow, error: chainErr }, { data: existingSteps, error: stepErr }] =
      await Promise.all([
        admin.from('prompt_chains').select('id').eq('id', chainId).maybeSingle(),
        admin
          .from('prompt_chain_steps')
          .select('step_order')
          .eq('chain_id', chainId)
          .order('step_order', { ascending: false })
          .limit(1),
      ]);

    if (chainErr) throw new Error(chainErr.message);
    if (!chainRow) throw new Error('Prompt chain not found.');
    if (stepErr) throw new Error(stepErr.message);

    const maxOrder = Math.max(0, Number(existingSteps?.[0]?.step_order) || 0);
    const nextOrder = maxOrder + 1;

    const { data, error } = await admin
      .from('prompt_chain_steps')
      .insert({
        ...payload,
        chain_id: chainId,
        step_order: nextOrder,
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(error.message);
    }

    await admin
      .from('prompt_chains')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', chainId);

    return Response.json({ step: data }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return apiFailure(err);
  }
}
