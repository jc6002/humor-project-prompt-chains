import {
  apiFailure,
  fetchStudioInitialData,
  requireSuperadminApi,
} from '@/lib/chains/server';
import { validateChainInput } from '@/lib/chains/validation';

export async function GET(request: Request) {
  try {
    await requireSuperadminApi(request, { requireJson: false });
    const data = await fetchStudioInitialData();
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return apiFailure(err);
  }
}

export async function POST(request: Request) {
  try {
    const { admin } = await requireSuperadminApi(request);
    const body = (await request.json()) as Record<string, unknown>;
    const payload = validateChainInput(body, false);

    const { data, error } = await admin
      .from('prompt_chains')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new Error(`A prompt chain with slug "${String(payload.slug)}" already exists.`);
      }
      throw new Error(error.message);
    }

    return Response.json({ chain: data }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return apiFailure(err);
  }
}
