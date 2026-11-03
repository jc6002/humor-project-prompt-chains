'use client';
import { useEffect, useRef, useState } from 'react';
import { ChainSelect } from './chain-select';
import { SAMPLE_SCENES, getSampleSceneDataUri, type SampleSceneSpec } from '@/lib/chains/sample-scenes';
import type {
  AvailableModelOption,
  PromptChainRow,
  PromptChainRunRow,
  PromptChainStepRow,
  SampleSceneId,
  StepExecutionTrace,
} from '@/lib/chains/types';

type SourceTab = 'sample_svg' | 'upload' | 'image_url';

type Props = {
  chain: PromptChainRow;
  steps: readonly PromptChainStepRow[];
  models: readonly AvailableModelOption[];
  onRunCompleted: (run: PromptChainRunRow) => void;
  onRefresh: () => void;
  onError: (msg: string | null) => void;
  onStatus: (msg: string | null) => void;
};

async function rasterizeSvgToPngDataUrl(svgMarkup: string, width = 640, height = 400): Promise<string | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.fillStyle = '#141915';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = svgUrl;
  });
}

async function compressUploadFileToDataUrl(file: File): Promise<string> {
  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.type)) {
    throw new Error('Unsupported file format. Choose a PNG, JPEG, WebP, or GIF image.');
  }
  if (file.size > 4 * 1024 * 1024) {
    throw new Error('Selected file exceeds the 4 MB upload limit.');
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });

  if (file.type === 'image/gif' || file.size <= 160 * 1024) {
    return rawDataUrl;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const maxDim = 960;
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const targetW = Math.max(1, Math.round(img.width * scale));
        const targetH = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(rawDataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, targetW, targetH);
        const outMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const compacted = canvas.toDataURL(outMime, 0.86);
        resolve(compacted.length < rawDataUrl.length ? compacted : rawDataUrl);
      } catch {
        resolve(rawDataUrl);
      }
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
}

export function MultimodalRunnerZone({
  chain,
  steps,
  models,
  onRunCompleted,
  onRefresh,
  onError,
  onStatus,
}: Props) {
  const orderedSteps = steps.slice().sort((a, b) => a.step_order - b.step_order);

  const [sourceTab, setSourceTab] = useState<SourceTab>('sample_svg');
  const [selectedSceneId, setSelectedSceneId] = useState<SampleSceneId>(SAMPLE_SCENES[0].id);
  const [premise, setPremise] = useState<string>(SAMPLE_SCENES[0].defaultPremise);

  const [uploadDataUrl, setUploadDataUrl] = useState<string | null>(null);
  const [uploadMeta, setUploadMeta] = useState<{ name: string; sizeKb: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [externalUrl, setExternalUrl] = useState('');
  const [urlPreviewError, setUrlPreviewError] = useState<string | null>(null);

  const defaultModelKey =
    models.find((m) => m.configured)?.key ?? models[0]?.key ?? '';
  const [selectedModelKey, setSelectedModelKey] = useState<string>(defaultModelKey);
  const effectiveModelKey = models.some((m) => m.key === selectedModelKey)
    ? selectedModelKey
    : defaultModelKey;

  const [running, setRunning] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState<number>(0);
  const [lastCompletedTraces, setLastCompletedTraces] = useState<StepExecutionTrace[] | null>(null);

  useEffect(() => {
    if (!running || orderedSteps.length <= 1) return;
    const timer = window.setInterval(() => {
      setActiveStepIndex((prev) => Math.min(orderedSteps.length - 1, prev + 1));
    }, 850);
    return () => window.clearInterval(timer);
  }, [running, orderedSteps.length]);

  function handleSelectScene(scene: SampleSceneSpec) {
    setSelectedSceneId(scene.id);
    setPremise(scene.defaultPremise);
    onError(null);
  }

  async function handleFileSelected(file: File | undefined) {
    if (!file) return;
    onError(null);
    try {
      const dataUrl = await compressUploadFileToDataUrl(file);
      setUploadDataUrl(dataUrl);
      setUploadMeta({ name: file.name, sizeKb: Math.max(1, Math.round(file.size / 1024)) });
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not load image.');
    }
  }

  function handleExternalUrlChange(val: string) {
    setExternalUrl(val);
    const trimmed = val.trim();
    if (!trimmed) {
      setUrlPreviewError(null);
      return;
    }
    if (!trimmed.toLowerCase().startsWith('https://')) {
      setUrlPreviewError('External image URLs must start with https://');
      return;
    }
    setUrlPreviewError(null);
  }

  async function handleRunChain() {
    if (orderedSteps.length === 0) {
      onError('Add at least one pipeline step in Zone 1 before running this chain.');
      return;
    }
    if (sourceTab === 'upload' && !uploadDataUrl) {
      onError('Choose a PNG, JPEG, WebP, or GIF image before running.');
      return;
    }
    if (sourceTab === 'image_url') {
      if (!externalUrl.trim()) {
        onError('Paste an https:// image URL before running.');
        return;
      }
      if (!externalUrl.trim().toLowerCase().startsWith('https://')) {
        onError('External image URLs must use https://.');
        return;
      }
    }

    setRunning(true);
    setActiveStepIndex(0);
    setLastCompletedTraces(null);
    onError(null);
    onStatus(null);

    try {
      let visionImageDataUrl: string | null = null;
      if (sourceTab === 'sample_svg') {
        const scene = SAMPLE_SCENES.find((s) => s.id === selectedSceneId) ?? SAMPLE_SCENES[0];
        visionImageDataUrl = await rasterizeSvgToPngDataUrl(scene.svgMarkup, 640, 400);
      }

      const res = await fetch(`/api/chains/${chain.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType: sourceTab,
          sceneId: sourceTab === 'sample_svg' ? selectedSceneId : undefined,
          visionImageDataUrl: sourceTab === 'sample_svg' ? visionImageDataUrl : undefined,
          imageDataUrl: sourceTab === 'upload' ? uploadDataUrl : undefined,
          uploadFileName: sourceTab === 'upload' ? uploadMeta?.name : undefined,
          imageUrl: sourceTab === 'image_url' ? externalUrl.trim() : undefined,
          premise,
          modelKey: effectiveModelKey || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Prompt chain execution failed.');
      }
      const completedRun = data.run as PromptChainRunRow;
      setLastCompletedTraces(completedRun.step_outputs);
      onRunCompleted(completedRun);
      onStatus(
        `Completed ${completedRun.step_outputs.length}-step chain in ${(
          completedRun.total_latency_ms / 1000
        ).toFixed(2)}s — synthesized ${completedRun.final_captions.length} captions.`
      );
      onRefresh();
    } catch (err) {
      setLastCompletedTraces(null);
      onError(err instanceof Error ? err.message : 'Prompt chain execution failed.');
    } finally {
      setRunning(false);
    }
  }

  const modelOptions = models.map((m) => ({
    value: m.key,
    label: m.configured ? m.displayName : `${m.displayName} (missing ${m.apiKeyEnv})`,
    description: `${m.protocol} · max ${m.maxOutputTokens} tok`,
  }));

  return (
    <section id="zone-runner" className="studio-card">
      <div style={{ marginBottom: '14px' }}>
        <div className="eyebrow">ZONE 2 · LIVE MULTIMODAL CHAIN RUNNER</div>
        <h2 style={{ fontSize: '19px', fontWeight: 800, margin: '4px 0 0' }}>
          Test {chain.name} End-to-End
        </h2>
      </div>

      <div className="runner-grid">
        {/* Left Column — Visual Scene Input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
          <div
            role="tablist"
            aria-label="Image input source"
            style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={sourceTab === 'sample_svg'}
              className={`chip ${sourceTab === 'sample_svg' ? 'chip-active' : ''}`}
              disabled={running}
              onClick={() => setSourceTab('sample_svg')}
            >
              Sample Scenes (4)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sourceTab === 'upload'}
              className={`chip ${sourceTab === 'upload' ? 'chip-active' : ''}`}
              disabled={running}
              onClick={() => setSourceTab('upload')}
            >
              Upload Image
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sourceTab === 'image_url'}
              className={`chip ${sourceTab === 'image_url' ? 'chip-active' : ''}`}
              disabled={running}
              onClick={() => setSourceTab('image_url')}
            >
              Image URL
            </button>
          </div>

          {sourceTab === 'sample_svg' && (
            <div className="scene-cards-grid">
              {SAMPLE_SCENES.map((scene) => {
                const selected = scene.id === selectedSceneId;
                return (
                  <button
                    key={scene.id}
                    type="button"
                    className={`scene-card-btn ${selected ? 'selected' : ''}`}
                    disabled={running}
                    onClick={() => handleSelectScene(scene)}
                  >
                    <div className="visual-stage">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={getSampleSceneDataUri(scene)} alt={scene.title} />
                    </div>
                    <div style={{ fontSize: '12.5px', fontWeight: 700, lineHeight: 1.3 }}>
                      {scene.title}
                    </div>
                    <span className="mono" style={{ fontSize: '10.5px', color: 'var(--muted)' }}>
                      {scene.shortBadge} · PNG Vision Raster
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {sourceTab === 'upload' && (
            <div
              style={{
                padding: '16px',
                borderRadius: '10px',
                border: '1px dashed var(--line-strong)',
                background: 'var(--surface-2)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!running) {
                  void handleFileSelected(e.dataTransfer.files?.[0]);
                }
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                style={{ display: 'none' }}
                onChange={(e) => void handleFileSelected(e.target.files?.[0])}
              />
              {uploadDataUrl ? (
                <>
                  <div className="visual-stage" style={{ maxHeight: '196px' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={uploadDataUrl} alt={uploadMeta?.name ?? 'Uploaded preview'} />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span className="badge mono">
                      {uploadMeta?.name} · {uploadMeta?.sizeKb} KB
                    </span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        className="chip"
                        disabled={running}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Replace
                      </button>
                      <button
                        type="button"
                        className="chip chip-danger"
                        disabled={running}
                        onClick={() => {
                          setUploadDataUrl(null);
                          setUploadMeta(null);
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '18px 8px' }}>
                  <p style={{ margin: '0 0 10px', fontSize: '13.5px', color: 'var(--fg-secondary)' }}>
                    Drop a PNG, JPEG, WebP, or GIF image here (max 4 MB)
                  </p>
                  <button
                    type="button"
                    className="button button-outline button-small"
                    disabled={running}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose Image File…
                  </button>
                </div>
              )}
            </div>
          )}

          {sourceTab === 'image_url' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label className="field-label" htmlFor="runner-image-url">
                  HTTPS Image URL (PNG / JPEG / WebP / GIF)
                </label>
                <input
                  id="runner-image-url"
                  type="url"
                  className="studio-input"
                  placeholder="https://example.com/funny-scene.png"
                  value={externalUrl}
                  disabled={running}
                  onChange={(e) => handleExternalUrlChange(e.target.value)}
                />
              </div>
              {urlPreviewError && <div className="alert-error">{urlPreviewError}</div>}
              {externalUrl.trim().toLowerCase().startsWith('https://') && !urlPreviewError && (
                <div className="visual-stage" style={{ maxHeight: '196px' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={externalUrl.trim()}
                    alt="External URL preview"
                    onError={() =>
                      setUrlPreviewError(
                        'Preview image failed to load in browser; verify the URL points directly to an image.'
                      )
                    }
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column — Premise, Model Selector & Run CTA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
          <div>
            <label className="field-label" htmlFor="runner-premise">
              Optional Premise / Extra Direction ({'{{input}}'})
            </label>
            <textarea
              id="runner-premise"
              rows={3}
              className="studio-textarea"
              placeholder="Optional comedic context or situational cue..."
              value={premise}
              disabled={running}
              onChange={(e) => setPremise(e.target.value)}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="runner-model-select">
              Execution Model
            </label>
            <ChainSelect
              id="runner-model-select"
              ariaLabel="Execution model"
              value={effectiveModelKey}
              options={modelOptions}
              placeholder="No models configured"
              disabled={running || modelOptions.length === 0}
              onChange={setSelectedModelKey}
            />
          </div>

          <button
            type="button"
            className="button"
            style={{ width: '100%', padding: '12px 16px', fontSize: '14px' }}
            disabled={running || orderedSteps.length === 0}
            onClick={handleRunChain}
          >
            {running
              ? `Running Step ${Math.min(activeStepIndex + 1, orderedSteps.length)} of ${orderedSteps.length}…`
              : `▶ Run Chain (${orderedSteps.length} Step${orderedSteps.length === 1 ? '' : 's'} → 5 Captions)`}
          </button>

          <div style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: 1.45 }}>
            Executes each step sequentially, passing real upstream LLM outputs into{' '}
            <code>{'{{prev_output}}'}</code> and <code>{'{{step_N_output}}'}</code>.
          </div>
        </div>
      </div>

      {/* Live / Completed Step Progress Stepper */}
      {(running || (lastCompletedTraces && lastCompletedTraces.length > 0)) && (
        <div className="progress-stepper" role="status" aria-live="polite">
          {orderedSteps.map((step, idx) => {
            const doneTrace = lastCompletedTraces?.find((t) => t.step_order === idx + 1);
            const isComplete = Boolean(doneTrace) || (running && idx < activeStepIndex);
            const isCurrent = running && idx === activeStepIndex;
            return (
              <div
                key={step.id}
                className={`progress-step-item ${isCurrent ? 'active' : isComplete ? 'done' : ''}`}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <strong className="mono">{String(idx + 1).padStart(2, '0')}</strong> {step.step_name}
                </span>
                <span className="mono" style={{ flexShrink: 0, fontSize: '11.5px' }}>
                  {doneTrace
                    ? `✓ ${doneTrace.latency_ms}ms`
                    : isCurrent
                      ? '● Running…'
                      : isComplete
                        ? '✓ Done'
                        : '○ Queued'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
