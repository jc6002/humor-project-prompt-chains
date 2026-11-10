import {
  apiFailure,
  executeHanziChainRunGenerator,
  HttpStatusError,
  requireSuperadminApi,
} from '@/lib/chains/server';
import type { SseRunEvent } from '@/lib/chains/types';

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteCtx) {
  try {
    const { admin, user } = await requireSuperadminApi(request);
    const { id: chainId } = await context.params;
    const body = (await request.json()) as {
      input?: unknown;
      hanzi?: unknown;
      text_only?: unknown;
      stream?: unknown;
    };

    const hanziInput = String(body.input ?? body.hanzi ?? '').trim();
    const textOnlyPreview = body.text_only === true;
    const wantsSse =
      body.stream === true ||
      Boolean(request.headers.get('accept')?.toLowerCase().includes('text/event-stream'));

    const geminiFreeKey = request.headers.get('x-studio-gemini-key')?.trim() || null;
    const geminiPaidKey = request.headers.get('x-studio-gemini-paid-key')?.trim() || null;

    if (!wantsSse) {
      let finalRun = null;
      let finalBudget = null;
      let mismatchLookup = null;
      let imageWarning: string | undefined;

      for await (const ev of executeHanziChainRunGenerator({
        admin,
        user,
        chainId,
        hanziInput,
        textOnlyPreview,
        sessionKeys: { geminiFreeKey, geminiPaidKey },
        signal: request.signal,
      })) {
        if (ev.type === 'fit_mismatch') {
          mismatchLookup = ev.lookup;
        } else if (ev.type === 'run_completed') {
          finalRun = ev.run;
          finalBudget = ev.imageBudget;
          imageWarning = ev.imageWarning;
        }
      }

      if (mismatchLookup) {
        return Response.json(
          { fit_mismatch: true, lookup: mismatchLookup },
          { status: 200, headers: { 'Cache-Control': 'no-store' } }
        );
      }

      if (!finalRun) {
        throw new HttpStatusError(500, 'Chain run ended without producing a card.');
      }

      return Response.json(
        { run: finalRun, imageBudget: finalBudget, imageWarning },
        { status: 201, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const sendEvent = (ev: SseRunEvent) => {
          controller.enqueue(
            encoder.encode(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`)
          );
        };

        try {
          for await (const ev of executeHanziChainRunGenerator({
            admin,
            user,
            chainId,
            hanziInput,
            textOnlyPreview,
            sessionKeys: { geminiFreeKey, geminiPaidKey },
            signal: request.signal,
          })) {
            sendEvent(ev);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Chain execution failed.';
          sendEvent({ type: 'run_error', message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    return apiFailure(error);
  }
}
