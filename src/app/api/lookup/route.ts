import { lookupHanziTarget } from '@/lib/hanzi/dataset';
import { apiFailure, requireSuperadminApi } from '@/lib/chains/server';
import { normalizeDecompositionMode } from '@/lib/chains/validation';

export async function GET(request: Request) {
  try {
    await requireSuperadminApi(request, { methodIsMutating: false });
    const url = new URL(request.url);
    const input = url.searchParams.get('input') ?? '';
    const mode = normalizeDecompositionMode(url.searchParams.get('mode'), 'compound_word');
    const lookup = lookupHanziTarget(input, mode);
    return Response.json({ lookup }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiFailure(error);
  }
}
