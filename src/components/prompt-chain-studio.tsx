'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChainSelect } from './chain-select';
import { ConfirmDeleteButton } from './confirm-delete-button';
import { StepEditorZone } from './step-editor-zone';
import { MultimodalRunnerZone } from './multimodal-runner-zone';
import { MediaGalleryZone } from './media-gallery-zone';
import { usePropSyncedState } from './use-prop-synced-state';
import { slugifyChainName } from '@/lib/chains/validation';
import type {
  PromptChainRow,
  PromptChainRunRow,
  PromptChainStepRow,
  StudioInitialData,
} from '@/lib/chains/types';

type Props = {
  initialData: StudioInitialData;
  initialChainSlug?: string | null;
};

export function PromptChainStudio({ initialData, initialChainSlug }: Props) {
  const router = useRouter();

  const [chains, setChains] = usePropSyncedState<PromptChainRow[]>(initialData.chains);
  const [steps, setSteps] = usePropSyncedState<PromptChainStepRow[]>(initialData.steps);
  const [runs, setRuns] = usePropSyncedState<PromptChainRunRow[]>(initialData.runs);

  const initialSelectedId =
    (initialChainSlug
      ? initialData.chains.find((c) => c.slug === initialChainSlug)?.id
      : undefined) ??
    initialData.chains[0]?.id ??
    '';

  const [selectedChainId, setSelectedChainId] = useState<string>(initialSelectedId);
  const [railFilter, setRailFilter] = useState('');

  const [showCreateChain, setShowCreateChain] = useState(false);
  const [newChainName, setNewChainName] = useState('');
  const [newChainSlug, setNewChainSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [newChainPersona, setNewChainPersona] = useState(
    'You are a sharp visual comedy writer who extracts concrete details from an image and crafts punchy, non-cliché captions.'
  );
  const [newChainDesc, setNewChainDesc] = useState('');
  const [newChainWeight, setNewChainWeight] = useState('0');
  const [newChainActive, setNewChainActive] = useState(true);

  const [editingChain, setEditingChain] = useState(false);
  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editPersona, setEditPersona] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editWeight, setEditWeight] = useState('0');
  const [editActive, setEditActive] = useState(true);

  const [busyChain, setBusyChain] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const activeChain =
    chains.find((c) => c.id === selectedChainId) ?? chains[0] ?? null;

  const activeSteps = activeChain
    ? steps
        .filter((s) => s.chain_id === activeChain.id)
        .sort((a, b) => a.step_order - b.step_order)
    : [];

  const filterLower = railFilter.trim().toLowerCase();
  const visibleRailChains = chains.filter((c) => {
    if (!filterLower) return true;
    return (
      c.name.toLowerCase().includes(filterLower) ||
      c.slug.toLowerCase().includes(filterLower) ||
      c.description.toLowerCase().includes(filterLower)
    );
  });

  function selectChain(id: string) {
    setSelectedChainId(id);
    setEditingChain(false);
    setErrorMsg(null);
  }

  function openEditChain(chain: PromptChainRow) {
    setEditName(chain.name);
    setEditSlug(chain.slug);
    setEditPersona(chain.persona_style);
    setEditDesc(chain.description);
    setEditWeight(String(chain.mix_weight ?? 0));
    setEditActive(Boolean(chain.is_active));
    setEditingChain(true);
    setErrorMsg(null);
  }

  async function handleCreateChain(e: React.FormEvent) {
    e.preventDefault();
    setBusyChain(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/chains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newChainName,
          slug: newChainSlug || slugifyChainName(newChainName),
          persona_style: newChainPersona,
          description: newChainDesc,
          mix_weight: Number(newChainWeight) || 0,
          is_active: newChainActive,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create prompt chain.');
      const created = data.chain as PromptChainRow;
      setChains((prev) => [created, ...prev]);
      setSelectedChainId(created.id);
      setShowCreateChain(false);
      setNewChainName('');
      setNewChainSlug('');
      setSlugTouched(false);
      setNewChainDesc('');
      setNewChainWeight('0');
      setStatusMsg(`Created prompt chain "${created.name}". Add pipeline steps below.`);
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create prompt chain.');
    } finally {
      setBusyChain(false);
    }
  }

  async function handleSaveChain(e: React.FormEvent) {
    e.preventDefault();
    if (!activeChain) return;
    setBusyChain(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/chains/${activeChain.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          slug: editSlug,
          persona_style: editPersona,
          description: editDesc,
          mix_weight: Number(editWeight) || 0,
          is_active: editActive,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update prompt chain.');
      const updated = data.chain as PromptChainRow;
      setChains((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setEditingChain(false);
      setStatusMsg(`Saved prompt chain "${updated.name}".`);
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update prompt chain.');
    } finally {
      setBusyChain(false);
    }
  }

  async function handleToggleChainActive(chain: PromptChainRow) {
    const nextActive = !chain.is_active;
    setBusyChain(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/chains/${chain.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: nextActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to toggle active status.');
      const updated = data.chain as PromptChainRow;
      setChains((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setStatusMsg(`${updated.name} is now ${updated.is_active ? 'Active' : 'Paused'}.`);
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to toggle chain.');
    } finally {
      setBusyChain(false);
    }
  }

  async function handleDeleteChain(chain: PromptChainRow) {
    setBusyChain(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/chains/${chain.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete prompt chain.');
      const remaining = chains.filter((c) => c.id !== chain.id);
      setChains(remaining);
      setSteps((prev) => prev.filter((s) => s.chain_id !== chain.id));
      setRuns((prev) => prev.filter((r) => r.chain_id !== chain.id));
      setEditingChain(false);
      if (selectedChainId === chain.id) {
        setSelectedChainId(remaining[0]?.id ?? '');
      }
      setStatusMsg(`Deleted prompt chain "${chain.name}".`);
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete prompt chain.');
    } finally {
      setBusyChain(false);
    }
  }

  function handleStepsMutatedForActiveChain(nextChainSteps: PromptChainStepRow[]) {
    if (!activeChain) return;
    setSteps((prev) => [
      ...prev.filter((s) => s.chain_id !== activeChain.id),
      ...nextChainSteps,
    ]);
  }

  const mobileChainOptions = chains.map((c) => {
    const stepCnt = steps.filter((s) => s.chain_id === c.id).length;
    return {
      value: c.id,
      label: c.name,
      description: `${c.is_active ? 'Active' : 'Paused'} · ${stepCnt} steps · w=${c.mix_weight}`,
    };
  });

  return (
    <div className="studio-grid">
      {/* Desktop Sticky Left Rail */}
      <aside className="studio-rail" aria-label="Prompt chains directory">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            marginBottom: '10px',
          }}
        >
          <span className="eyebrow">PROMPT CHAINS ({chains.length})</span>
          <button
            type="button"
            className="button button-small"
            disabled={busyChain}
            onClick={() => {
              setShowCreateChain((v) => !v);
              setErrorMsg(null);
            }}
          >
            {showCreateChain ? 'Close' : '+ New'}
          </button>
        </div>

        <input
          type="search"
          className="studio-input"
          style={{ marginBottom: '10px', padding: '7px 10px', fontSize: '12.5px' }}
          placeholder="Filter chains…"
          aria-label="Filter prompt chains"
          value={railFilter}
          onChange={(e) => setRailFilter(e.target.value)}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {visibleRailChains.map((c) => {
            const stepCnt = steps.filter((s) => s.chain_id === c.id).length;
            const runCnt = runs.filter(
              (r) => (r.chain_id === c.id || r.chain_slug === c.slug) && r.status === 'completed'
            ).length;
            const isSelected = activeChain?.id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                className={`chain-rail-item ${isSelected ? 'selected' : ''}`}
                onClick={() => selectChain(c.id)}
              >
                <div style={{ fontWeight: 700, fontSize: '13.5px', lineHeight: 1.3 }}>
                  {c.name}
                </div>
                <div
                  className="mono"
                  style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', gap: '6px', flexWrap: 'wrap' }}
                >
                  <span>{c.is_active ? '● Active' : '○ Paused'}</span>
                  <span>· {stepCnt} steps</span>
                  <span>· {runCnt} runs</span>
                  <span>· w={c.mix_weight}</span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Mobile / Tablet Compact Chain Selector Bar */}
      <div className="mobile-chain-bar">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <span className="eyebrow">ACTIVE PROMPT CHAIN ({chains.length})</span>
          <button
            type="button"
            className="button button-small"
            disabled={busyChain}
            onClick={() => setShowCreateChain((v) => !v)}
          >
            {showCreateChain ? 'Close' : '+ New Chain'}
          </button>
        </div>
        <ChainSelect
          ariaLabel="Select active prompt chain"
          value={activeChain?.id ?? ''}
          options={mobileChainOptions}
          placeholder="Create a prompt chain"
          onChange={selectChain}
        />
      </div>

      {/* Right Main Studio Workspace */}
      <div className="studio-main">
        {errorMsg && <div className="alert-error">{errorMsg}</div>}
        {statusMsg && <div className="alert-ok">{statusMsg}</div>}

        {/* Inline Create Chain Card */}
        {showCreateChain && (
          <form onSubmit={handleCreateChain} className="studio-card">
            <div className="eyebrow" style={{ marginBottom: '10px' }}>
              NEW PROMPT CHAIN
            </div>
            <div className="form-grid-2">
              <div>
                <label className="field-label" htmlFor="create-chain-name">
                  Chain Name
                </label>
                <input
                  id="create-chain-name"
                  required
                  className="studio-input"
                  placeholder="e.g. Visual Deadpan Captioner"
                  value={newChainName}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNewChainName(val);
                    if (!slugTouched) {
                      setNewChainSlug(slugifyChainName(val));
                    }
                  }}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="create-chain-slug">
                  Slug
                </label>
                <input
                  id="create-chain-slug"
                  required
                  className="studio-input mono"
                  placeholder="visual-deadpan-captioner"
                  value={newChainSlug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setNewChainSlug(e.target.value);
                  }}
                />
              </div>
              <div className="field-span-2">
                <label className="field-label" htmlFor="create-chain-persona">
                  System Persona
                </label>
                <textarea
                  id="create-chain-persona"
                  required
                  rows={2}
                  className="studio-textarea"
                  value={newChainPersona}
                  onChange={(e) => setNewChainPersona(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="create-chain-desc">
                  Description
                </label>
                <input
                  id="create-chain-desc"
                  className="studio-input"
                  placeholder="Brief pipeline summary..."
                  value={newChainDesc}
                  onChange={(e) => setNewChainDesc(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="create-chain-weight">
                  Traffic Weight (0–100)
                </label>
                <input
                  id="create-chain-weight"
                  type="number"
                  min={0}
                  max={100}
                  className="studio-input mono"
                  value={newChainWeight}
                  onChange={(e) => setNewChainWeight(e.target.value)}
                />
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                flexWrap: 'wrap',
                marginTop: '12px',
              }}
            >
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '13px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={newChainActive}
                  onChange={(e) => setNewChainActive(e.target.checked)}
                />
                <span>Active immediately</span>
              </label>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button type="submit" className="button button-small" disabled={busyChain}>
                  Create Chain
                </button>
                <button
                  type="button"
                  className="button button-outline button-small"
                  disabled={busyChain}
                  onClick={() => setShowCreateChain(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        )}

        {activeChain ? (
          <>
            {/* Active Chain Header & Jump Bar */}
            <section className="studio-card">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: '12px',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
                    <span className="badge mono">{activeChain.slug}</span>
                    <button
                      type="button"
                      className={`chip ${activeChain.is_active ? 'chip-active' : ''}`}
                      disabled={busyChain}
                      onClick={() => handleToggleChainActive(activeChain)}
                    >
                      {activeChain.is_active ? '● Active' : '○ Paused'}
                    </button>
                    <span className="badge mono">Weight: {activeChain.mix_weight}</span>
                  </div>
                  <h1
                    style={{
                      fontSize: '23px',
                      fontWeight: 800,
                      letterSpacing: '-0.02em',
                      margin: '8px 0 6px',
                    }}
                  >
                    {activeChain.name}
                  </h1>
                  {activeChain.description && (
                    <p style={{ margin: '0 0 6px', fontSize: '13.5px', color: 'var(--fg-secondary)' }}>
                      {activeChain.description}
                    </p>
                  )}
                  <div style={{ fontSize: '12.5px', color: 'var(--muted)' }}>
                    <strong>Persona:</strong> {activeChain.persona_style}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="chip"
                    disabled={busyChain}
                    onClick={() =>
                      editingChain ? setEditingChain(false) : openEditChain(activeChain)
                    }
                  >
                    {editingChain ? 'Close Edit' : '✏️ Edit Chain'}
                  </button>
                  <ConfirmDeleteButton
                    disabled={busyChain}
                    ariaLabel={`Delete chain ${activeChain.name}`}
                    onConfirm={() => handleDeleteChain(activeChain)}
                  />
                </div>
              </div>

              {editingChain && (
                <form
                  onSubmit={handleSaveChain}
                  style={{
                    marginTop: '14px',
                    paddingTop: '14px',
                    borderTop: '1px solid var(--line)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div className="form-grid-2">
                    <div>
                      <label className="field-label" htmlFor="edit-chain-name">
                        Chain Name
                      </label>
                      <input
                        id="edit-chain-name"
                        required
                        className="studio-input"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="field-label" htmlFor="edit-chain-slug">
                        Slug
                      </label>
                      <input
                        id="edit-chain-slug"
                        required
                        className="studio-input mono"
                        value={editSlug}
                        onChange={(e) => setEditSlug(e.target.value)}
                      />
                    </div>
                    <div className="field-span-2">
                      <label className="field-label" htmlFor="edit-chain-persona">
                        System Persona
                      </label>
                      <textarea
                        id="edit-chain-persona"
                        required
                        rows={2}
                        className="studio-textarea"
                        value={editPersona}
                        onChange={(e) => setEditPersona(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="field-label" htmlFor="edit-chain-desc">
                        Description
                      </label>
                      <input
                        id="edit-chain-desc"
                        className="studio-input"
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="field-label" htmlFor="edit-chain-weight">
                        Traffic Weight (0–100)
                      </label>
                      <input
                        id="edit-chain-weight"
                        type="number"
                        min={0}
                        max={100}
                        className="studio-input mono"
                        value={editWeight}
                        onChange={(e) => setEditWeight(e.target.value)}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '13px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={editActive}
                        onChange={(e) => setEditActive(e.target.checked)}
                      />
                      <span>Chain active</span>
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button type="submit" className="button button-small" disabled={busyChain}>
                        Save Changes
                      </button>
                      <button
                        type="button"
                        className="button button-outline button-small"
                        disabled={busyChain}
                        onClick={() => setEditingChain(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {/* Quick Section Jump Bar */}
              <div
                style={{
                  display: 'flex',
                  gap: '6px',
                  flexWrap: 'wrap',
                  marginTop: '14px',
                  paddingTop: '12px',
                  borderTop: '1px solid var(--line)',
                }}
              >
                <a href="#zone-steps" className="chip">
                  1 · Steps ({activeSteps.length})
                </a>
                <a href="#zone-runner" className="chip">
                  2 · Live Runner
                </a>
                <a href="#zone-gallery" className="chip">
                  3 · Media Gallery
                </a>
              </div>
            </section>

            {/* Zone 1: Pipeline Step Editor */}
            <StepEditorZone
              key={`steps-${activeChain.id}`}
              chain={activeChain}
              steps={activeSteps}
              busy={busyChain}
              onStepsMutated={handleStepsMutatedForActiveChain}
              onRefresh={() => router.refresh()}
              onError={setErrorMsg}
              onStatus={setStatusMsg}
            />

            {/* Zone 2: Live Multimodal Chain Runner */}
            <MultimodalRunnerZone
              key={`runner-${activeChain.id}`}
              chain={activeChain}
              steps={activeSteps}
              models={initialData.models}
              onRunCompleted={(newRun) => setRuns((prev) => [newRun, ...prev])}
              onRefresh={() => router.refresh()}
              onError={setErrorMsg}
              onStatus={setStatusMsg}
            />
          </>
        ) : (
          <section className="studio-card">
            <p style={{ margin: 0, color: 'var(--muted)' }}>
              No prompt chains exist yet. Click <strong>+ New</strong> to create your first pipeline.
            </p>
          </section>
        )}

        {/* Zone 3: Chain-Filtered Generated Media Gallery */}
        <MediaGalleryZone
          activeChain={activeChain}
          runs={runs}
          onRunDeleted={(runId) => setRuns((prev) => prev.filter((r) => r.id !== runId))}
          onRefresh={() => router.refresh()}
          onError={setErrorMsg}
          onStatus={setStatusMsg}
        />
      </div>
    </div>
  );
}
