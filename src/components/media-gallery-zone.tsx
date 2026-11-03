'use client';
import { useState } from 'react';
import { ChainSelect } from './chain-select';
import { ConfirmDeleteButton } from './confirm-delete-button';
import { getSampleSceneById, getSampleSceneDataUri } from '@/lib/chains/sample-scenes';
import type { PromptChainRow, PromptChainRunRow } from '@/lib/chains/types';

type Props = {
  activeChain: PromptChainRow | null;
  runs: readonly PromptChainRunRow[];
  onRunDeleted: (runId: string) => void;
  onRefresh: () => void;
  onError: (msg: string | null) => void;
  onStatus: (msg: string | null) => void;
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function sourceTypeLabel(sourceType: string): string {
  if (sourceType === 'upload') return 'Uploaded image';
  if (sourceType === 'image_url') return 'External URL';
  if (sourceType === 'text_only') return 'Text premise';
  return 'Built-in SVG';
}

export function MediaGalleryZone({
  activeChain,
  runs,
  onRunDeleted,
  onRefresh,
  onError,
  onStatus,
}: Props) {
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [modelFilter, setModelFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [expandedRunIds, setExpandedRunIds] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);

  const completedRuns = runs.filter((r) => r.status === 'completed');
  const activeChainCount = activeChain
    ? completedRuns.filter((r) => r.chain_id === activeChain.id || r.chain_slug === activeChain.slug)
        .length
    : completedRuns.length;

  const uniqueModels = Array.from(new Set(completedRuns.map((r) => r.model).filter(Boolean)));
  const modelFilterOptions = [
    { value: 'all', label: 'All Models' },
    ...uniqueModels.map((m) => ({ value: m, label: m })),
  ];

  const effectiveModelFilter =
    modelFilter === 'all' || uniqueModels.includes(modelFilter) ? modelFilter : 'all';

  const queryLower = query.trim().toLowerCase();
  const filteredRuns = completedRuns.filter((run) => {
    if (scope === 'active' && activeChain) {
      if (run.chain_id !== activeChain.id && run.chain_slug !== activeChain.slug) {
        return false;
      }
    }
    if (effectiveModelFilter !== 'all' && run.model !== effectiveModelFilter) {
      return false;
    }
    if (queryLower) {
      const haystack = [
        run.chain_name,
        run.model,
        run.input_scene_title ?? '',
        run.input_premise,
        ...run.final_captions,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(queryLower)) {
        return false;
      }
    }
    return true;
  });

  async function handleCopyCaption(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 1500);
    } catch {
      // Clipboard API unavailable
    }
  }

  async function handleDeleteRun(runId: string) {
    setDeletingRunId(runId);
    onError(null);
    try {
      const res = await fetch(`/api/runs/${runId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete run.');
      onRunDeleted(runId);
      onStatus('Removed run from Generated Media Gallery.');
      onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delete run.');
    } finally {
      setDeletingRunId(null);
    }
  }

  function toggleWaterfall(runId: string) {
    setExpandedRunIds((prev) => ({ ...prev, [runId]: !prev[runId] }));
  }

  return (
    <section id="zone-gallery" className="studio-card">
      <div style={{ marginBottom: '12px' }}>
        <div className="eyebrow">ZONE 3 · CHAIN-FILTERED GENERATED MEDIA GALLERY</div>
        <h2 style={{ fontSize: '19px', fontWeight: 800, margin: '4px 0 0' }}>
          Generated Captions &amp; Intermediate Step Waterfalls ({filteredRuns.length})
        </h2>
      </div>

      {/* Filter Bar */}
      <div className="gallery-filter-bar" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`chip ${scope === 'active' ? 'chip-active' : ''}`}
            onClick={() => setScope('active')}
          >
            Active Chain ({activeChainCount})
          </button>
          <button
            type="button"
            className={`chip ${scope === 'all' ? 'chip-active' : ''}`}
            onClick={() => setScope('all')}
          >
            All Chains ({completedRuns.length})
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', minWidth: 0 }}>
          <ChainSelect
            compact
            ariaLabel="Filter gallery by model"
            value={effectiveModelFilter}
            options={modelFilterOptions}
            onChange={setModelFilter}
          />
          <input
            type="search"
            className="studio-input"
            style={{ width: '210px', maxWidth: '100%', padding: '6px 10px', fontSize: '12.5px' }}
            placeholder="Filter by caption or scene…"
            aria-label="Filter gallery by caption or scene"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Gallery Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {filteredRuns.length === 0 && (
          <div
            style={{
              padding: '22px',
              borderRadius: '10px',
              border: '1px dashed var(--line-strong)',
              color: 'var(--muted)',
              fontSize: '13.5px',
              textAlign: 'center',
            }}
          >
            {scope === 'active' && completedRuns.length > 0 ? (
              <>
                No saved runs for <strong>{activeChain?.name}</strong> yet. Click{' '}
                <strong>▶ Run Chain</strong> above or switch to{' '}
                <button
                  type="button"
                  className="chip"
                  style={{ marginLeft: '4px' }}
                  onClick={() => setScope('all')}
                >
                  All Chains ({completedRuns.length})
                </button>
                .
              </>
            ) : (
              'No matching prompt chain runs found.'
            )}
          </div>
        )}

        {filteredRuns.map((run) => {
          const sampleScene = getSampleSceneById(run.input_scene_id);
          const imageSrc = sampleScene
            ? getSampleSceneDataUri(sampleScene)
            : run.input_image_url;
          const sceneCaptionText =
            run.input_scene_title || run.input_premise || 'Multimodal prompt chain input';
          const isExpanded = Boolean(expandedRunIds[run.id]);

          return (
            <article key={run.id} className="gallery-run-card">
              {/* 1. Run Metadata Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span className="badge badge-accent">{run.chain_name}</span>
                  <span className="badge mono">
                    {run.provider} · {run.model}
                  </span>
                  <span className="badge mono">
                    {(run.total_latency_ms / 1000).toFixed(2)}s · {run.total_tokens} tokens
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    {formatTimestamp(run.created_at)}
                  </span>
                </div>

                <ConfirmDeleteButton
                  disabled={deletingRunId === run.id}
                  ariaLabel={`Delete gallery run ${run.id}`}
                  onConfirm={() => handleDeleteRun(run.id)}
                />
              </div>

              {/* 2. Source Visual + Final 5 Funny Captions Split */}
              <div className="gallery-split">
                <div className="gallery-visual-card">
                  <div className="gallery-visual-frame">
                    {imageSrc ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={imageSrc} alt={sceneCaptionText} />
                    ) : (
                      <span className="mono" style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
                        TEXT PREMISE
                      </span>
                    )}
                  </div>
                  {/* Immediate Scene Caption directly beneath image */}
                  <div
                    style={{
                      fontSize: '12.5px',
                      fontWeight: 600,
                      color: 'var(--fg-secondary)',
                      lineHeight: 1.4,
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {sceneCaptionText}
                  </div>
                  {run.input_premise && run.input_scene_title && (
                    <div
                      style={{
                        fontSize: '11.5px',
                        color: 'var(--muted)',
                        lineHeight: 1.4,
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {run.input_premise}
                    </div>
                  )}
                  <div
                    style={{
                      borderTop: '1px solid var(--line)',
                      paddingTop: '6px',
                      fontSize: '11px',
                      color: 'var(--muted)',
                    }}
                    className="mono"
                  >
                    {sourceTypeLabel(run.input_source_type)}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
                  {run.final_captions.map((caption, capIdx) => {
                    const copyId = `${run.id}-${capIdx}`;
                    return (
                      <div key={copyId} className="caption-row">
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', minWidth: 0 }}>
                          <span
                            className="mono"
                            style={{
                              color: 'var(--accent-ink)',
                              fontWeight: 700,
                              fontSize: '13px',
                              paddingTop: '1px',
                              flexShrink: 0,
                            }}
                          >
                            {String(capIdx + 1).padStart(2, '0')}
                          </span>
                          <span
                            style={{
                              fontSize: '14.5px',
                              lineHeight: 1.5,
                              color: 'var(--fg)',
                              overflowWrap: 'anywhere',
                            }}
                          >
                            {caption}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="chip"
                          style={{ flexShrink: 0, padding: '3px 8px', fontSize: '11.5px' }}
                          onClick={() => handleCopyCaption(copyId, caption)}
                        >
                          {copiedKey === copyId ? '✓ Copied' : 'Copy'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 3. Expandable Step-by-Step Intermediate Output Waterfall */}
              <div>
                <button
                  type="button"
                  className="chip"
                  aria-expanded={isExpanded}
                  onClick={() => toggleWaterfall(run.id)}
                >
                  {isExpanded ? '▴' : '▾'} View Step-by-Step Intermediate Waterfall (
                  {run.step_outputs.length} step{run.step_outputs.length === 1 ? '' : 's'})
                </button>

                {isExpanded && (
                  <div
                    style={{
                      marginTop: '10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                    }}
                  >
                    {run.step_outputs.map((st, stIdx) => {
                      const stepNum = st.step_order || stIdx + 1;
                      const stepTokens = (st.input_tokens ?? 0) + (st.output_tokens ?? 0);
                      return (
                        <div key={`${run.id}-step-${stepNum}`} className="waterfall-step">
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '8px',
                              flexWrap: 'wrap',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                flexWrap: 'wrap',
                              }}
                            >
                              <span className="badge badge-accent mono">
                                STEP {String(stepNum).padStart(2, '0')} · {st.step_name}
                              </span>
                              <span className="badge mono">{st.step_role}</span>
                              <span className="badge mono">{`{{step_${stepNum}_output}}`}</span>
                            </div>
                            <span className="mono" style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
                              {st.latency_ms}ms · {stepTokens} tok
                            </span>
                          </div>

                          <div
                            style={{
                              padding: '9px 11px',
                              borderRadius: '6px',
                              background: 'var(--surface-2)',
                              border: '1px solid var(--line)',
                              fontSize: '13px',
                              lineHeight: 1.5,
                              color: 'var(--fg)',
                              whiteSpace: 'pre-wrap',
                              overflowWrap: 'anywhere',
                            }}
                          >
                            {st.output_text}
                          </div>

                          {st.compiled_prompt && (
                            <details style={{ fontSize: '12px', color: 'var(--muted)' }}>
                              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                                Inspect compiled step prompt
                              </summary>
                              <pre
                                className="sql-pre"
                                style={{ marginTop: '6px', marginBottom: 0, fontSize: '11.5px' }}
                              >
                                {st.compiled_prompt}
                              </pre>
                            </details>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
