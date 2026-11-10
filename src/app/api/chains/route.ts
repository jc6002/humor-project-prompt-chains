import { DEFAULT_STARTER_STEPS, HANZI_APP_SCOPE } from '@/lib/chains/presets';
import {
  apiFailure,
  fetchStudioInitialData,
  requireSuperadminApi,
} from '@/lib/chains/server';
import {
  slugifyChainName,
  validateChainInput,
} from '@/lib/chains/validation';

export async function GET(request: Request) {
  try {
    const { admin } = await requireSuperadminApi(request, { methodIsMutating: false });
    const data = await fetchStudioInitialData(admin);
    return Response.json(data, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const { admin } = await requireSuperadminApi(request);
    const body = await request.json();
    const validated = validateChainInput(body, { isUpdate: false });
    const slug = slugifyChainName(validated.name);

    const { data: chain, error: chainErr } = await admin
      .from('prompt_chains')
      .insert({
        slug,
        name: validated.name,
        description: validated.description,
        persona_style: validated.persona_style,
        decomposition_mode: validated.decomposition_mode,
        is_active: validated.is_active,
        mix_weight: 0,
        app_scope: HANZI_APP_SCOPE,
      })
      .select('*')
      .single();

    if (chainErr || !chain) {
      throw new Error(chainErr?.message ?? 'Failed to create prompt chain.');
    }

    const starterRows = DEFAULT_STARTER_STEPS.map((st, idx) => ({
      chain_id: chain.id,
      step_order: idx + 1,
      ...st,
    }));

    const { data: steps, error: stepsErr } = await admin
      .from('prompt_chain_steps')
      .insert(starterRows)
      .select('*')
      .order('step_order', { ascending: true });

    if (stepsErr) {
      throw new Error(stepsErr.message);
    }

    return Response.json(
      { chain, steps: steps ?? [] },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return apiFailure(error);
  }
}
