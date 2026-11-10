import {
  apiFailure,
  renderSceneForPreviewRun,
  requireSuperadminApi,
} from '@/lib/chains/server';

type RouteCtx = { params: Promise<{ runId: string }> };

export async function POST(request: Request, context: RouteCtx) {
  try {
    const { admin } = await requireSuperadminApi(request);
    const { runId } = await context.params;
    const geminiFreeKey = request.headers.get('x-studio-gemini-key')?.trim() || null;
    const geminiPaidKey = request.headers.get('x-studio-gemini-paid-key')?.trim() || null;

    const result = await renderSceneForPreviewRun({
      admin,
      runId,
      sessionKeys: { geminiFreeKey, geminiPaidKey },
    });

    return Response.json(result, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiFailure(error);
  }
}
