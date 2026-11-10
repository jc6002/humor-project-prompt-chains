'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppSelect, type AppSelectOption } from './app-select';
import { ConfirmDeleteButton } from './confirm-delete-button';
import { HanziGlyphSvg } from './hanzi-glyph-svg';
import { PipelineEditorDrawer } from './pipeline-editor-drawer';
import {
  SESSION_FREE_KEY_STORAGE,
  SESSION_KEYS_EVENT,
  SESSION_PAID_KEY_STORAGE,
  SessionKeysDrawer,
} from './session-keys-drawer';
import { StudioHeader } from './studio-header';
import {
  HANZI_METHOD_TABS,
  formatShortModelLabel,
  resolveMethodTabForMode,
} from '@/lib/chains/presets';
import {
  compileCardFromTextTraces,
  formatLiveTracePreview,
} from '@/lib/chains/validation';
import type {
  DailyImageBudget,
  DecompositionMode,
  LookupVerdict,
  PromptChainRow,
  PromptChainRunRow,
  PromptChainStepRow,
  SseRunEvent,
  StepExecutionTrace,
  StepModality,
  StudioInitialData,
} from '@/lib/chains/types';

interface HanziMnemonicStudioProps {
  initialData: StudioInitialData;
  userEmail: string;
  initialChainSlug?: string | null;
  initialDeckScope?: 'chain' | 'all';
}

function subscribeSessionKeys(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(SESSION_KEYS_EVENT, onStoreChange);
  window.addEventListener('storage', onStoreChange);
  return () => {
    window.removeEventListener(SESSION_KEYS_EVENT, onStoreChange);
    window.removeEventListener('storage', onStoreChange);
  };
}

function getSessionKeySnapshot(): string {
  if (typeof window === 'undefined') return '|';
  const f = sessionStorage.getItem(SESSION_FREE_KEY_STORAGE) ?? '';
  const p = sessionStorage.getItem(SESSION_PAID_KEY_STORAGE) ?? '';
  return `${f}|${p}`;
}

function getServerKeySnapshot(): string {
  return '|';
}

function shortStepRoleBadge(role: string, modality: StepModality, order: number): string {
  if (modality === 'image_generation') return 'PICTURE';
  const low = role.toLowerCase();
  if (low.includes('role') || order === 1) return 'ROLES';
  if (low.includes('scene') || order === 2) return 'SCENE';
  if (low.includes('json') || low.includes('prompt') || order === 3) return 'PROMPT';
  return 'STEP';
}

export function HanziMnemonicStudio({
  initialData,
  userEmail,
  initialChainSlug = null,
  initialDeckScope = 'chain',
}: HanziMnemonicStudioProps) {
  const [chains, setChains] = useState<PromptChainRow[]>(initialData.chains);
  const [stepsByChainId, setStepsByChainId] = useState<Record<string, PromptChainStepRow[]>>(
    initialData.stepsByChainId
  );
  const [runs, setRuns] = useState<PromptChainRunRow[]>(initialData.runs);
  const [imageBudget, setImageBudget] = useState<DailyImageBudget>(initialData.imageBudget);

  const initialChain = useMemo(() => {
    if (initialChainSlug) {
      const bySlug = initialData.chains.find((c) => c.slug === initialChainSlug);
      if (bySlug) return bySlug;
    }
    return (
      initialData.chains.find((c) => c.slug === 'compound-word') ?? initialData.chains[0] ?? null
    );
  }, [initialChainSlug, initialData.chains]);

  const initialSelectedRun = useMemo(() => {
    if (!initialChain) return initialData.runs[0] ?? null;
    const forChain = initialData.runs.filter((r) => r.chain_id === initialChain.id);
    return (
      forChain.find((r) => r.input_premise === '猫头鹰') ??
      forChain[0] ??
      initialData.runs[0] ??
      null
    );
  }, [initialChain, initialData.runs]);

  const [activeChainId, setActiveChainId] = useState<string>(initialChain?.id ?? '');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialSelectedRun?.id ?? null);
  const [hanziInput, setHanziInput] = useState<string>(
    initialSelectedRun?.input_premise ?? '猫头鹰'
  );
  const [textOnlyPreview, setTextOnlyPreview] = useState<boolean>(false);
  const [deckScope, setDeckScope] = useState<'chain' | 'all'>(initialDeckScope);

  const [lookupPreview, setLookupPreview] = useState<LookupVerdict | null>(null);
  const [mismatchCard, setMismatchCard] = useState<LookupVerdict | null>(null);

  // Live SSE streaming state
  const [running, setRunning] = useState<boolean>(false);
  const [runningStepOrder, setRunningStepOrder] = useState<number | null>(null);
  const [liveLookup, setLiveLookup] = useState<LookupVerdict | null>(null);
  const [liveTraces, setLiveTraces] = useState<StepExecutionTrace[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [renderingRunId, setRenderingRunId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Interactive card & drawer state
  const [highlightedPart, setHighlightedPart] = useState<number | null>(null);
  const [inspectedStepOrder, setInspectedStepOrder] = useState<number | null>(null);
  const [drawerState, setDrawerState] = useState<{ open: boolean; mode: 'edit' | 'create' }>({
    open: false,
    mode: 'edit',
  });
  const [keysDrawerOpen, setKeysDrawerOpen] = useState<boolean>(false);

  const sessionKeyPair = useSyncExternalStore(
    subscribeSessionKeys,
    getSessionKeySnapshot,
    getServerKeySnapshot
  );
  const [sessionFreeKey, sessionPaidKey] = sessionKeyPair.split('|');

  const activeChain = useMemo(
    () => chains.find((c) => c.id === activeChainId) ?? chains[0] ?? null,
    [chains, activeChainId]
  );

  const activeSteps = useMemo(
    () => (activeChain ? stepsByChainId[activeChain.id] ?? [] : []),
    [activeChain, stepsByChainId]
  );

  const activeMethodTab = useMemo(
    () => resolveMethodTabForMode(activeChain?.decomposition_mode ?? 'compound_word'),
    [activeChain]
  );

  const isCustomChain = useMemo(() => {
    if (!activeChain) return false;
    return !HANZI_METHOD_TABS.some((t) => t.slug === activeChain.slug);
  }, [activeChain]);

  const chainRuns = useMemo(
    () => (activeChain ? runs.filter((r) => r.chain_id === activeChain.id) : []),
    [runs, activeChain]
  );

  const displayedDeckRuns = useMemo(
    () => (deckScope === 'all' ? runs : chainRuns),
    [deckScope, runs, chainRuns]
  );

  const displayedRun = useMemo(() => {
    if (selectedRunId) {
      const exact = runs.find((r) => r.id === selectedRunId);
      if (exact) return exact;
    }
    return chainRuns[0] ?? runs[0] ?? null;
  }, [selectedRunId, runs, chainRuns]);

  const syncUrlParams = useCallback((slug: string, scope: 'chain' | 'all') => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('chain', slug);
    url.searchParams.set('deck', scope);
    window.history.replaceState(null, '', url.toString());
  }, []);

  // Debounced deterministic pre-run Lookup & Fit-Check preview
  useEffect(() => {
    const clean = hanziInput.trim();
    if (!clean || !activeChain) {
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/lookup?input=${encodeURIComponent(clean)}&mode=${encodeURIComponent(
            activeChain.decomposition_mode
          )}`,
          { signal: ctrl.signal }
        );
        if (!res.ok) return;
        const data = (await res.json()) as { lookup?: LookupVerdict };
        if (data.lookup) {
          setLookupPreview(data.lookup);
        }
      } catch {
        // Ignore aborted lookup previews.
      }
    }, 90);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [hanziInput, activeChain]);

  const visibleLookupPreview =
    hanziInput.trim() && activeChain && lookupPreview?.input === hanziInput.trim()
      ? lookupPreview
      : null;

  const effectiveMismatchCard =
    mismatchCard ??
    (visibleLookupPreview &&
    (visibleLookupPreview.status === 'fit_mismatch' ||
      visibleLookupPreview.status === 'base_pictograph')
      ? visibleLookupPreview
      : null);

  const handleChainSwitch = useCallback(
    (nextChainId: string) => {
      const nextChain = chains.find((c) => c.id === nextChainId);
      if (!nextChain) return;
      setActiveChainId(nextChain.id);
      setMismatchCard(null);
      setRunError(null);
      setInspectedStepOrder(null);
      const existingForChain = runs.filter((r) => r.chain_id === nextChain.id);
      const nextRun = existingForChain[0] ?? null;
      setSelectedRunId(nextRun?.id ?? null);
      if (nextRun) {
        setHanziInput(nextRun.input_premise);
      } else {
        const tab = resolveMethodTabForMode(nextChain.decomposition_mode);
        setHanziInput(tab.graderSamples[0]?.hanzi ?? '猫头鹰');
      }
      syncUrlParams(nextChain.slug, deckScope);
    },
    [chains, runs, deckScope, syncUrlParams]
  );

  const mountSavedRun = useCallback((run: PromptChainRunRow) => {
    setMismatchCard(null);
    setRunError(null);
    setInspectedStepOrder(null);
    setSelectedRunId(run.id);
    setHanziInput(run.input_premise);
  }, []);

  const buildSessionHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (sessionFreeKey) headers['x-studio-gemini-key'] = sessionFreeKey;
    if (sessionPaidKey) headers['x-studio-gemini-paid-key'] = sessionPaidKey;
    return headers;
  }, [sessionFreeKey, sessionPaidKey]);

  const executeRun = useCallback(
    async (targetInput: string, targetChainId: string, forceTextOnly?: boolean) => {
      const clean = targetInput.trim();
      if (!clean || !targetChainId) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setRunning(true);
      setRunningStepOrder(1);
      setLiveLookup(null);
      setLiveTraces([]);
      setMismatchCard(null);
      setRunError(null);
      setInspectedStepOrder(null);

      try {
        const resp = await fetch(`/api/chains/${targetChainId}/run`, {
          method: 'POST',
          headers: {
            ...buildSessionHeaders(),
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({
            input: clean,
            text_only: forceTextOnly ?? textOnlyPreview,
            stream: true,
          }),
          signal: controller.signal,
        });

        if (!resp.ok || !resp.body) {
          const errBody = (await resp.json().catch(() => ({}))) as { error?: string };
          throw new Error(errBody.error ?? `HTTP ${resp.status}`);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() ?? '';

          for (const block of blocks) {
            const dataLine = block
              .split('\n')
              .find((l) => l.startsWith('data:'));
            if (!dataLine) continue;
            const rawJson = dataLine.slice(5).trim();
            if (!rawJson) continue;
            const ev = JSON.parse(rawJson) as SseRunEvent;

            if (ev.type === 'lookup_complete') {
              setLiveLookup(ev.lookup);
            } else if (ev.type === 'fit_mismatch') {
              setMismatchCard(ev.lookup);
              setLiveLookup(null);
              setRunningStepOrder(null);
            } else if (ev.type === 'step_started') {
              setRunningStepOrder(ev.step_order);
            } else if (ev.type === 'step_completed') {
              setLiveTraces((prev) => [...prev, ev.trace]);
            } else if (ev.type === 'run_completed') {
              setRuns((prev) => [ev.run, ...prev.filter((r) => r.id !== ev.run.id)]);
              setSelectedRunId(ev.run.id);
              setHanziInput(ev.run.input_premise);
              setImageBudget(ev.imageBudget);
              setLiveLookup(null);
              setRunningStepOrder(null);
            } else if (ev.type === 'run_error') {
              setRunError(ev.message);
            }
          }
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          setRunError('Run cancelled.');
        } else {
          setRunError(err instanceof Error ? err.message : 'Run failed.');
        }
      } finally {
        setRunning(false);
        setRunningStepOrder(null);
      }
    },
    [buildSessionHeaders, textOnlyPreview]
  );

  const handleSwitchAndRunFittingChain = useCallback(
    (fittingSlug: string, targetHanzi: string) => {
      const targetChain = chains.find((c) => c.slug === fittingSlug);
      if (!targetChain) return;
      setActiveChainId(targetChain.id);
      setHanziInput(targetHanzi);
      setMismatchCard(null);
      syncUrlParams(targetChain.slug, deckScope);

      // Mount stored card immediately if already seeded on the fitting chain; otherwise run live!
      const alreadySaved = runs.find(
        (r) => r.chain_id === targetChain.id && r.input_premise === targetHanzi
      );
      if (alreadySaved) {
        setSelectedRunId(alreadySaved.id);
      } else {
        void executeRun(targetHanzi, targetChain.id);
      }
    },
    [chains, runs, deckScope, syncUrlParams, executeRun]
  );

  const handleRenderPreviewScene = useCallback(
    async (run: PromptChainRunRow) => {
      setRenderingRunId(run.id);
      setRunError(null);
      try {
        const resp = await fetch(`/api/runs/${run.id}/render-image`, {
          method: 'POST',
          headers: buildSessionHeaders(),
          body: JSON.stringify({}),
        });
        const data = (await resp.json()) as {
          run?: PromptChainRunRow;
          imageBudget?: DailyImageBudget;
          error?: string;
        };
        if (!resp.ok || !data.run) {
          throw new Error(data.error ?? `HTTP ${resp.status}`);
        }
        setRuns((prev) => prev.map((r) => (r.id === data.run!.id ? data.run! : r)));
        setSelectedRunId(data.run.id);
        if (data.imageBudget) {
          setImageBudget(data.imageBudget);
        }
      } catch (err) {
        setRunError(err instanceof Error ? err.message : 'Scene rendering failed.');
      } finally {
        setRenderingRunId(null);
      }
    },
    [buildSessionHeaders]
  );

  const handleDownloadPng = useCallback((run: PromptChainRunRow) => {
    if (!run.generated_media_url) return;
    const a = document.createElement('a');
    a.href = run.generated_media_url;
    const ext = run.generated_media_mime.includes('png') ? 'png' : 'jpg';
    a.download = `hanzi-${run.input_premise}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  // CRUD callbacks for PipelineEditorDrawer
  const handleCreateChain = async (payload: {
    name: string;
    description: string;
    persona_style: string;
    decomposition_mode: DecompositionMode;
  }) => {
    const resp = await fetch('/api/chains', {
      method: 'POST',
      headers: buildSessionHeaders(),
      body: JSON.stringify(payload),
    });
    const data = (await resp.json()) as {
      chain?: PromptChainRow;
      steps?: PromptChainStepRow[];
      error?: string;
    };
    if (!resp.ok || !data.chain) throw new Error(data.error ?? 'Failed to create chain.');
    setChains((prev) => [...prev, data.chain!]);
    setStepsByChainId((prev) => ({ ...prev, [data.chain!.id]: data.steps ?? [] }));
    setActiveChainId(data.chain.id);
    syncUrlParams(data.chain.slug, deckScope);
  };

  const handleUpdateChain = async (
    chainId: string,
    payload: {
      name: string;
      description: string;
      persona_style: string;
      decomposition_mode: DecompositionMode;
    }
  ) => {
    const resp = await fetch(`/api/chains/${chainId}`, {
      method: 'PATCH',
      headers: buildSessionHeaders(),
      body: JSON.stringify(payload),
    });
    const data = (await resp.json()) as { chain?: PromptChainRow; error?: string };
    if (!resp.ok || !data.chain) throw new Error(data.error ?? 'Failed to update chain.');
    setChains((prev) => prev.map((c) => (c.id === chainId ? data.chain! : c)));
  };

  const handleDeleteChain = async (chainId: string) => {
    const resp = await fetch(`/api/chains/${chainId}`, { method: 'DELETE' });
    if (!resp.ok) {
      const data = (await resp.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? 'Failed to delete chain.');
    }
    const remaining = chains.filter((c) => c.id !== chainId);
    setChains(remaining);
    setRuns((prev) => prev.filter((r) => r.chain_id !== chainId));
    if (remaining[0]) {
      handleChainSwitch(remaining[0].id);
    }
  };

  const handleAddStep = async (
    chainId: string,
    payload: {
      step_name: string;
      step_role: string;
      output_field: string;
      model_id: string;
      temperature: number;
      step_modality: StepModality;
      instruction_template: string;
    }
  ) => {
    const resp = await fetch(`/api/chains/${chainId}/steps`, {
      method: 'POST',
      headers: buildSessionHeaders(),
      body: JSON.stringify(payload),
    });
    const data = (await resp.json()) as { step?: PromptChainStepRow; error?: string };
    if (!resp.ok || !data.step) throw new Error(data.error ?? 'Failed to add step.');
    setStepsByChainId((prev) => ({
      ...prev,
      [chainId]: [...(prev[chainId] ?? []), data.step!],
    }));
  };

  const handleUpdateStep = async (
    chainId: string,
    stepId: string,
    payload: {
      step_name: string;
      step_role: string;
      output_field: string;
      model_id: string;
      temperature: number;
      step_modality: StepModality;
      instruction_template: string;
    }
  ) => {
    const resp = await fetch(`/api/chains/${chainId}/steps/${stepId}`, {
      method: 'PATCH',
      headers: buildSessionHeaders(),
      body: JSON.stringify(payload),
    });
    const data = (await resp.json()) as { step?: PromptChainStepRow; error?: string };
    if (!resp.ok || !data.step) throw new Error(data.error ?? 'Failed to update step.');
    setStepsByChainId((prev) => ({
      ...prev,
      [chainId]: (prev[chainId] ?? []).map((s) => (s.id === stepId ? data.step! : s)),
    }));
  };

  const handleDeleteStep = async (chainId: string, stepId: string) => {
    const resp = await fetch(`/api/chains/${chainId}/steps/${stepId}`, {
      method: 'DELETE',
    });
    const data = (await resp.json()) as { steps?: PromptChainStepRow[]; error?: string };
    if (!resp.ok) throw new Error(data.error ?? 'Failed to delete step.');
    if (data.steps) {
      setStepsByChainId((prev) => ({ ...prev, [chainId]: data.steps! }));
    }
  };

  const handleReorderSteps = async (chainId: string, orderedIds: string[]) => {
    const resp = await fetch(`/api/chains/${chainId}/steps/reorder`, {
      method: 'POST',
      headers: buildSessionHeaders(),
      body: JSON.stringify({ step_ids: orderedIds }),
    });
    const data = (await resp.json()) as { steps?: PromptChainStepRow[]; error?: string };
    if (!resp.ok || !data.steps) throw new Error(data.error ?? 'Failed to reorder steps.');
    setStepsByChainId((prev) => ({ ...prev, [chainId]: data.steps! }));
  };

  const handleDeleteRun = async (runId: string) => {
    const resp = await fetch(`/api/runs/${runId}`, { method: 'DELETE' });
    if (!resp.ok) return;
    setRuns((prev) => prev.filter((r) => r.id !== runId));
    if (selectedRunId === runId) {
      setSelectedRunId(null);
    }
  };

  const chainOptions: AppSelectOption[] = useMemo(
    () =>
      chains.map((c) => {
        const count = (stepsByChainId[c.id] ?? []).length;
        return {
          value: c.id,
          label: `${c.name} (${count})`,
          description: c.decomposition_mode.replace('_', ' ').toUpperCase(),
        };
      }),
    [chains, stepsByChainId]
  );

  // Determine relay bar traces & provenance label
  const relayTraces = running
    ? liveTraces
    : effectiveMismatchCard
      ? null
      : displayedRun?.step_outputs ?? null;

  const isSeededRun = Boolean(displayedRun?.generated_media_url?.startsWith('/showcase/'));
  const provenanceText = running
    ? `SSE LIVE · ${liveTraces.length}/${activeSteps.length}`
    : effectiveMismatchCard
      ? 'FIT REDIRECT · $0.00'
      : displayedRun
        ? isSeededRun
          ? 'SEEDED · CLICK STEP'
          : `LIVE · ${(Math.max(100, displayedRun.total_latency_ms) / 1000).toFixed(1)}S · CLICK STEP`
        : 'READY';

  const inspectedTrace = useMemo(() => {
    if (inspectedStepOrder === null) return null;
    return (relayTraces ?? []).find((t) => t.step_order === inspectedStepOrder) ?? null;
  }, [inspectedStepOrder, relayTraces]);

  const liveCompiledCard = useMemo(() => {
    if (!running || !liveLookup || liveTraces.length < 2) return null;
    const latestText = [...liveTraces].reverse().find((t) => t.step_modality === 'text');
    if (!latestText) return null;
    return compileCardFromTextTraces({
      lookup: liveLookup,
      rawStepText: latestText.output_text,
      textOnlyPreview,
    }).card;
  }, [running, liveLookup, liveTraces, textOnlyPreview]);

  const charCount = Array.from(hanziInput.trim()).length;

  return (
    <div className="site-shell">
      <StudioHeader
        userEmail={userEmail}
        leftControls={
          <>
            <div style={{ minWidth: 232, maxWidth: 286, flex: '1 1 232px' }}>
              <AppSelect
                ariaLabel="Active Prompt Chain"
                value={activeChain?.id ?? ''}
                options={chainOptions}
                onChange={handleChainSwitch}
              />
            </div>
            <button
              type="button"
              className="button button-small"
              onClick={() => setDrawerState({ open: true, mode: 'edit' })}
            >
              Edit Chain ({activeSteps.length})
            </button>
            <button
              type="button"
              className="button button-small"
              onClick={() => setDrawerState({ open: true, mode: 'create' })}
            >
              + New Chain
            </button>
          </>
        }
        rightExtra={
          <button
            type="button"
            className="keys-pill mono-font"
            onClick={() => setKeysDrawerOpen(true)}
          >
            <span aria-hidden="true">●</span>
            <span>
              Keys Ready · {imageBudget.usedToday}/{imageBudget.dailyCap} imgs
            </span>
          </button>
        }
      />

      <main className="workbench-main">
        <div className="studio-grid">
          {/* Left Column: Method Selector + Hanzi Input + Grader Samples + Lookup Preview + Cost Guard */}
          <aside className="panel-card" aria-label="Mnemonic card composer">
            <div className="method-tabs" role="tablist" aria-label="Chinese decomposition methods">
              {HANZI_METHOD_TABS.map((tab) => {
                const matchingChain = chains.find((c) => c.slug === tab.slug);
                const isSelected = Boolean(
                  !isCustomChain && activeChain && activeChain.slug === tab.slug
                );
                return (
                  <button
                    key={tab.slug}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    className={`method-tab ${isSelected ? 'active' : ''}`}
                    onClick={() => {
                      if (matchingChain) handleChainSwitch(matchingChain.id);
                    }}
                  >
                    {tab.shortLabel}
                  </button>
                );
              })}
            </div>

            {isCustomChain && activeChain && (
              <div
                style={{
                  marginTop: 6,
                  padding: '4px 8px',
                  borderRadius: 6,
                  background: 'var(--accent-soft)',
                  border: '1px solid var(--accent-border)',
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--accent-primary)',
                }}
              >
                Custom Chain: {activeChain.name} ({activeChain.decomposition_mode})
              </div>
            )}

            <p
              style={{
                fontSize: 12,
                color: 'var(--fg-secondary)',
                margin: '8px 0 12px',
                lineHeight: 1.45,
              }}
            >
              {activeChain?.description || activeMethodTab.summary}
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (activeChain) void executeRun(hanziInput, activeChain.id);
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 10.5,
                    fontWeight: 800,
                    letterSpacing: '0.04em',
                    color: 'var(--fg-muted)',
                    marginBottom: 5,
                  }}
                >
                  <label htmlFor="hanzi-main-input">CHINESE CHARACTER OR WORD</label>
                  <span>1-4 CHARS</span>
                </div>

                <div className="hanzi-input-wrap">
                  <input
                    id="hanzi-main-input"
                    type="text"
                    lang="zh-CN"
                    maxLength={8}
                    className="hanzi-input cjk-font"
                    placeholder={activeMethodTab.graderSamples[0]?.hanzi ?? '猫头鹰'}
                    value={hanziInput}
                    onChange={(e) => {
                      setHanziInput(e.target.value);
                      setMismatchCard(null);
                    }}
                  />
                  <span
                    className="mono-font"
                    style={{
                      fontSize: 11,
                      color: 'var(--fg-muted)',
                      whiteSpace: 'nowrap',
                      marginRight: 6,
                    }}
                  >
                    {charCount} {charCount === 1 ? 'char' : 'chars'}
                  </span>
                  {hanziInput && (
                    <button
                      type="button"
                      aria-label="Clear input"
                      onClick={() => setHanziInput('')}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--fg-muted)',
                        cursor: 'pointer',
                        fontSize: 14,
                        padding: '2px 4px',
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Row A: 1-Click Grader Samples (mount stored card at $0.00) */}
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: '0.04em',
                    color: 'var(--fg-muted)',
                    marginBottom: 5,
                  }}
                >
                  <span>1-CLICK GRADER SAMPLES</span>
                  <span>NO IME NEEDED</span>
                </div>
                <div className="sample-grid">
                  {activeMethodTab.graderSamples.map((chip) => {
                    const activeSample =
                      hanziInput.trim() === chip.hanzi && !effectiveMismatchCard;
                    return (
                      <button
                        key={chip.hanzi}
                        type="button"
                        className={`sample-chip ${activeSample ? 'active' : ''}`}
                        onClick={() => {
                          setHanziInput(chip.hanzi);
                          setMismatchCard(null);
                          setRunError(null);
                          const stored = chainRuns.find((r) => r.input_premise === chip.hanzi);
                          if (stored) {
                            setSelectedRunId(stored.id);
                          } else if (activeChain) {
                            void executeRun(chip.hanzi, activeChain.id);
                          }
                        }}
                      >
                        <span className="sample-chip-hanzi cjk-font">{chip.hanzi}</span>
                        <span className="sample-chip-gloss">{chip.gloss}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Row B: 1-Click Unseen Live Test (fresh SSE run) */}
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: '0.04em',
                    color: 'var(--fg-muted)',
                    marginBottom: 5,
                  }}
                >
                  <span>1-CLICK UNSEEN LIVE TEST</span>
                  <span>FRESH RUN</span>
                </div>
                <div className="sample-grid">
                  {activeMethodTab.unseenSamples.map((chip) => (
                    <button
                      key={chip.hanzi}
                      type="button"
                      disabled={running}
                      className={`sample-chip ${hanziInput.trim() === chip.hanzi ? 'active' : ''}`}
                      onClick={() => {
                        setHanziInput(chip.hanzi);
                        if (activeChain) {
                          void executeRun(chip.hanzi, activeChain.id);
                        }
                      }}
                    >
                      <span className="sample-chip-hanzi cjk-font">{chip.hanzi}</span>
                      <span className="sample-chip-gloss">{chip.gloss}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Instant Deterministic Lookup & Fit-Check Preview */}
              {visibleLookupPreview && (
                <div
                  className={`lookup-box ${
                    visibleLookupPreview.status === 'fit' ? 'fit' : 'mismatch'
                  }`}
                >
                  {visibleLookupPreview.status === 'fit' ? (
                    <>
                      <div style={{ fontWeight: 800, color: 'var(--ok-fg)', marginBottom: 2 }}>
                        ✓ Fits {activeChain?.name ?? 'Active Chain'} · Make Me a Hanzi
                      </div>
                      <div style={{ color: 'var(--fg-secondary)' }} className="cjk-font">
                        {visibleLookupPreview.decomposition_label}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontWeight: 800, color: 'var(--warn-fg)', marginBottom: 2 }}>
                        ⚠ {visibleLookupPreview.mismatch_title}
                      </div>
                      <div style={{ color: 'var(--fg-secondary)', fontSize: 11.5 }}>
                        {visibleLookupPreview.mismatch_reason}
                      </div>
                      {visibleLookupPreview.fitting_chain_slug &&
                        visibleLookupPreview.fitting_chain_name && (
                          <button
                            type="button"
                            className="button button-small"
                            style={{ marginTop: 7, width: '100%' }}
                            onClick={() =>
                              handleSwitchAndRunFittingChain(
                                visibleLookupPreview.fitting_chain_slug!,
                                visibleLookupPreview.input
                              )
                            }
                          >
                            Switch &amp; Run on {visibleLookupPreview.fitting_chain_name} →
                          </button>
                        )}
                    </>
                  )}
                </div>
              )}

              {/* Cost Guard #2: Text Steps Only ($0 Preview) */}
              <div className="cost-switch-row">
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>
                    Text Steps Only ($0 Preview)
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--fg-muted)' }}>
                    Run Steps 1–3 free before spending $0.034
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={textOnlyPreview}
                  aria-label="Text Steps Only ($0 Preview)"
                  className="toggle-pill"
                  onClick={() => setTextOnlyPreview((v) => !v)}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <button
                type="submit"
                className="app-button-primary"
                disabled={
                  running ||
                  !activeChain ||
                  !hanziInput.trim() ||
                  Boolean(effectiveMismatchCard)
                }
              >
                {running
                  ? `Running Step ${runningStepOrder ?? 1}/${activeSteps.length}…`
                  : textOnlyPreview
                    ? 'Run Text Preview ($0) →'
                    : 'Create Mnemonic Card →'}
              </button>
            </form>
          </aside>

          {/* Right Column: Live SSE Progress Rail + Hero Mnemonic Card + Saved Deck */}
          <div className="right-stack">
            {/* Non-Blocking Step Progress Rail */}
            <div className="relay-card" aria-live="polite">
              <div className="relay-top-row">
                {effectiveMismatchCard ? (
                  <div className="relay-steps-row">
                    <span className="relay-pill done">
                      <span className="relay-num">01</span>
                      <span>FIT CHECK · Deterministic Lookup (&lt;50ms) ✓</span>
                    </span>
                    <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>→</span>
                    <span className="relay-pill">
                      <span className="relay-num">02</span>
                      <span>STOPPED BEFORE LLM · 0 FALSE ORIGINS</span>
                    </span>
                  </div>
                ) : (
                  <div className="relay-steps-row">
                    {activeSteps.map((step, idx) => {
                      const doneTrace = (relayTraces ?? []).find(
                        (t) => t.step_order === step.step_order
                      );
                      const isStepRunning = running && runningStepOrder === step.step_order;
                      const isSelected = inspectedStepOrder === step.step_order;
                      const roleTag = shortStepRoleBadge(
                        step.step_role,
                        step.step_modality,
                        step.step_order
                      );
                      const modelShort = formatShortModelLabel(
                        doneTrace?.model_id ?? step.model_id
                      );
                      return (
                        <span
                          key={step.id}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          <button
                            type="button"
                            className={`relay-pill ${doneTrace ? 'done' : ''} ${
                              isStepRunning ? 'running' : ''
                            } ${isSelected ? 'selected' : ''}`}
                            onClick={() =>
                              setInspectedStepOrder((cur) =>
                                cur === step.step_order ? null : step.step_order
                              )
                            }
                          >
                            <span className="relay-num">0{step.step_order}</span>
                            <span>
                              {roleTag} · {modelShort} · T={step.temperature.toFixed(2)}{' '}
                              {isStepRunning ? '●' : doneTrace ? '✓' : ''}
                            </span>
                          </button>
                          {idx < activeSteps.length - 1 && (
                            <span style={{ color: 'var(--fg-muted)', fontSize: 10 }}>→</span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                )}

                <div className="relay-provenance mono-font">
                  <span>{provenanceText}</span>
                  {running && (
                    <button
                      type="button"
                      className="step-ctrl-btn step-ctrl-danger"
                      onClick={() => abortRef.current?.abort()}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>

              {/* Live Intermediate Output Strip During Active SSE Run */}
              {running && (
                <div className="sse-live-strip">
                  <span className="sse-live-text">
                    {liveTraces.length > 0 ? (
                      <>
                        <strong>
                          Step {liveTraces[liveTraces.length - 1].step_order} Output (
                          {(liveTraces[liveTraces.length - 1].latency_ms / 1000).toFixed(1)}s):
                        </strong>{' '}
                        {formatLiveTracePreview(liveTraces[liveTraces.length - 1].output_text)}
                      </>
                    ) : (
                      <>
                        <strong>Deterministic Lookup Ready:</strong> Streaming Step{' '}
                        {runningStepOrder ?? 1} via non-blocking SSE…
                      </>
                    )}
                  </span>
                  <span
                    className="mono-font"
                    style={{ fontSize: 10.5, color: 'var(--accent-primary)', flexShrink: 0 }}
                  >
                    Non-blocking SSE
                  </span>
                </div>
              )}

              {/* Expandable Step Trace Inspector */}
              {inspectedTrace && (
                <div
                  style={{
                    marginTop: 6,
                    padding: 10,
                    borderRadius: 9,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--surface-subtle)',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                    gap: 10,
                    fontSize: 11.5,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 800, marginBottom: 4 }}>
                      Step 0{inspectedTrace.step_order} Compiled Input ({inspectedTrace.model_id})
                    </div>
                    <pre
                      className="mono-font"
                      style={{
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        maxHeight: 150,
                        overflowY: 'auto',
                        fontSize: 10.5,
                        color: 'var(--fg-secondary)',
                      }}
                    >
                      {inspectedTrace.compiled_prompt}
                    </pre>
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, marginBottom: 4 }}>
                      Step 0{inspectedTrace.step_order} Output ({inspectedTrace.latency_ms} ms ·{' '}
                      {inspectedTrace.tokens} tok)
                    </div>
                    <pre
                      className="mono-font"
                      style={{
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        maxHeight: 150,
                        overflowY: 'auto',
                        fontSize: 10.5,
                        color: 'var(--fg-primary)',
                      }}
                    >
                      {inspectedTrace.output_text}
                    </pre>
                  </div>
                </div>
              )}
            </div>

            {runError && (
              <div className="alert-error" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <span>{runError}</span>
                {activeChain && (
                  <button
                    type="button"
                    className="button button-small"
                    onClick={() => void executeRun(hanziInput, activeChain.id)}
                  >
                    Retry Run
                  </button>
                )}
              </div>
            )}

            {/* State A: Honest $0.00 Fit Mismatch / Base Pictograph Card */}
            {effectiveMismatchCard ? (
              <section
                className="panel-card"
                style={{ padding: '22px 24px' }}
                aria-label="Chain fit check notice"
              >
                <span
                  className="method-chip"
                  style={{
                    borderColor: 'var(--warn-bd)',
                    background: 'var(--warn-bg)',
                    color: 'var(--warn-fg)',
                  }}
                >
                  {effectiveMismatchCard.status === 'base_pictograph'
                    ? 'FOUNDATIONAL RECORD · NO FALSE ETYMOLOGY INVENTED'
                    : 'FIT MISMATCH · NO FALSE ETYMOLOGY INVENTED'}
                </span>

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'baseline',
                    gap: 10,
                    margin: '10px 0 14px',
                  }}
                >
                  <h1 style={{ fontSize: 25, fontWeight: 800, margin: 0 }}>
                    {effectiveMismatchCard.mismatch_title}
                  </h1>
                  <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--accent-primary)' }}>
                    {effectiveMismatchCard.pinyin} · {effectiveMismatchCard.english_meaning}
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 20,
                    alignItems: 'flex-start',
                  }}
                >
                  <HanziGlyphSvg glyphs={effectiveMismatchCard.glyphs} highlightedPart={null} />

                  <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                    <div
                      style={{
                        padding: '12px 14px',
                        borderRadius: 10,
                        borderLeft: '3.5px solid #F59E0B',
                        background: 'var(--surface-subtle)',
                        fontSize: 13.5,
                        lineHeight: 1.55,
                        marginBottom: 14,
                      }}
                    >
                      {effectiveMismatchCard.mismatch_reason}
                    </div>

                    {effectiveMismatchCard.status === 'fit_mismatch' &&
                      effectiveMismatchCard.fitting_chain_slug &&
                      effectiveMismatchCard.fitting_chain_name && (
                        <button
                          type="button"
                          className="app-button-primary"
                          style={{ width: 'auto', padding: '10px 18px' }}
                          onClick={() =>
                            handleSwitchAndRunFittingChain(
                              effectiveMismatchCard.fitting_chain_slug!,
                              effectiveMismatchCard.input
                            )
                          }
                        >
                          Switch &amp; Run on {effectiveMismatchCard.fitting_chain_name} →
                        </button>
                      )}

                    {effectiveMismatchCard.suggested_samples.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {effectiveMismatchCard.suggested_samples.map((sug) => (
                          <button
                            key={sug.hanzi}
                            type="button"
                            className="button"
                            onClick={() =>
                              handleSwitchAndRunFittingChain(sug.chain_slug, sug.hanzi)
                            }
                          >
                            <strong className="cjk-font">{sug.hanzi}</strong>
                            <span style={{ color: 'var(--fg-muted)' }}>{sug.gloss}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            ) : running && liveLookup ? (
              /* State B: Live Optimistic Card During Non-Blocking SSE Streaming (<50ms lookup_complete) */
              <section className="hero-card" aria-label="Streaming mnemonic card">
                <div className="card-left">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span className="method-chip">
                      {resolveMethodTabForMode(liveLookup.effective_mode).methodBadge}
                    </span>
                    <span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>
                      Hover a part to spotlight strokes
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, lineHeight: 1.15 }}>
                      {liveLookup.english_meaning}
                    </h1>
                    <span style={{ fontSize: 19, fontWeight: 700, color: 'var(--accent-primary)' }}>
                      {liveLookup.pinyin}
                    </span>
                  </div>

                  <HanziGlyphSvg glyphs={liveLookup.glyphs} highlightedPart={highlightedPart} />

                  <div className="legend-stack">
                    {(liveCompiledCard?.legend_items ?? liveLookup.parts).map((part) => (
                      <div
                        key={`${part.part_number}-${part.glyph}`}
                        tabIndex={0}
                        className={`legend-row part-${part.part_number}`}
                        onMouseEnter={() => setHighlightedPart(part.part_number)}
                        onMouseLeave={() => setHighlightedPart(null)}
                        onFocus={() => setHighlightedPart(part.part_number)}
                        onBlur={() => setHighlightedPart(null)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <span className={`legend-num part-${part.part_number}`}>
                            {part.part_number}
                          </span>
                          <span
                            className="cjk-font"
                            style={{ fontSize: 16, fontWeight: 800 }}
                          >
                            {part.glyph}
                          </span>
                          <span style={{ fontSize: 12.5, fontWeight: 700 }}>
                            {part.pinyin} · “{part.gloss}”
                            {part.scene_cue ? (
                              <span style={{ fontWeight: 500, color: 'var(--fg-secondary)' }}>
                                {' '}
                                ({part.scene_cue})
                              </span>
                            ) : null}
                          </span>
                        </div>
                        <span
                          className={
                            part.role === 'SOUND_ONLY' ? 'role-badge-sound' : 'role-badge-meaning'
                          }
                        >
                          {part.role_badge}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="mnemonic-hook-box">
                    {liveCompiledCard?.mnemonic_hook ||
                      'Composing memorable scene association across Steps 1–3…'}
                  </div>
                </div>

                <div className="scene-col">
                  <div className="scene-frame">
                    <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-muted)' }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--fg-primary)', marginBottom: 6 }}>
                        {textOnlyPreview
                          ? 'Compiling $0 Text-Only Scene Spec…'
                          : 'Painting 1:1 Component Scene (No Text)…'}
                      </div>
                      <div style={{ fontSize: 12 }}>
                        Step {runningStepOrder ?? 1} of {activeSteps.length} running via live SSE
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            ) : displayedRun ? (
              /* State C: Mounted Completed Mnemonic Flashcard */
              <section className="hero-card" aria-label="Mnemonic flashcard">
                <div className="card-left">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="method-chip">
                      {displayedRun.structured_card.method_badge}
                    </span>
                    <span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>
                      Hover a part to spotlight strokes
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, lineHeight: 1.15 }}>
                      {displayedRun.structured_card.english_meaning}
                    </h1>
                    <span style={{ fontSize: 19, fontWeight: 700, color: 'var(--accent-primary)' }}>
                      {displayedRun.structured_card.pinyin}
                    </span>
                  </div>

                  <HanziGlyphSvg
                    glyphs={displayedRun.structured_card.glyphs}
                    highlightedPart={highlightedPart}
                  />

                  <div className="legend-stack">
                    {displayedRun.structured_card.legend_items.map((part) => (
                      <div
                        key={`${part.part_number}-${part.glyph}`}
                        tabIndex={0}
                        className={`legend-row part-${part.part_number}`}
                        onMouseEnter={() => setHighlightedPart(part.part_number)}
                        onMouseLeave={() => setHighlightedPart(null)}
                        onFocus={() => setHighlightedPart(part.part_number)}
                        onBlur={() => setHighlightedPart(null)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: '1 1 180px' }}>
                          <span className={`legend-num part-${part.part_number}`}>
                            {part.part_number}
                          </span>
                          <span
                            className="cjk-font"
                            style={{ fontSize: 16, fontWeight: 800, flexShrink: 0 }}
                          >
                            {part.glyph}
                          </span>
                          <span style={{ fontSize: 12.5, fontWeight: 700, minWidth: 0 }}>
                            {part.pinyin} · “{part.gloss}”
                            {part.scene_cue ? (
                              <span style={{ fontWeight: 500, color: 'var(--fg-secondary)' }}>
                                {' '}
                                ({part.scene_cue})
                              </span>
                            ) : null}
                          </span>
                        </div>
                        <span
                          className={
                            part.role === 'SOUND_ONLY' ? 'role-badge-sound' : 'role-badge-meaning'
                          }
                        >
                          {part.role_badge}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="mnemonic-hook-box">
                    {displayedRun.structured_card.mnemonic_hook}
                  </div>
                </div>

                <div className="scene-col">
                  <div className="scene-frame">
                    {displayedRun.generated_media_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={displayedRun.generated_media_url}
                        alt={`Visual mnemonic scene for ${displayedRun.input_premise} (${displayedRun.structured_card.english_meaning}): ${displayedRun.structured_card.scene_checklist}`}
                        className="scene-img"
                      />
                    ) : (
                      <div
                        style={{
                          padding: 18,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                          justifyContent: 'center',
                          height: '100%',
                        }}
                      >
                        <div className="eyebrow">
                          {displayedRun.structured_card.daily_cap_reached
                            ? 'DAILY IMAGE CAP REACHED ($0 MODE)'
                            : 'SCENE PROMPT PREVIEW ($0 TEXT MODE)'}
                        </div>
                        <p
                          style={{
                            fontSize: 12,
                            color: 'var(--fg-secondary)',
                            margin: 0,
                            lineHeight: 1.48,
                            maxHeight: 160,
                            overflowY: 'auto',
                          }}
                        >
                          {displayedRun.structured_card.image_prompt}
                        </p>
                        <button
                          type="button"
                          className="app-button-primary"
                          disabled={
                            renderingRunId === displayedRun.id || imageBudget.remaining <= 0
                          }
                          onClick={() => void handleRenderPreviewScene(displayedRun)}
                        >
                          {renderingRunId === displayedRun.id
                            ? 'Rendering 1:1 Scene…'
                            : 'Render Scene ($0.034) →'}
                        </button>
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--fg-muted)',
                        minWidth: 0,
                      }}
                    >
                      {displayedRun.structured_card.scene_checklist}
                    </span>
                    {displayedRun.generated_media_url && (
                      <button
                        type="button"
                        className="button button-small"
                        onClick={() => handleDownloadPng(displayedRun)}
                      >
                        Save PNG ↓
                      </button>
                    )}
                  </div>
                </div>
              </section>
            ) : null}

            {/* Bottom Saved Deck Gallery (Rubric #6: View media generated by a specific prompt chain) */}
            <section className="deck-section" aria-label="Saved mnemonic deck">
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 14 }}>
                    Saved Deck · {deckScope === 'chain' ? activeChain?.name : 'All Chains'} (
                    {displayedDeckRuns.length})
                  </strong>
                  <span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>
                    0 API calls on view
                  </span>
                </div>

                <div className="theme-segment" role="group" aria-label="Filter deck by chain">
                  <button
                    type="button"
                    className={`theme-btn ${deckScope === 'chain' ? 'active' : ''}`}
                    onClick={() => {
                      setDeckScope('chain');
                      if (activeChain) syncUrlParams(activeChain.slug, 'chain');
                    }}
                  >
                    This Chain ({chainRuns.length})
                  </button>
                  <button
                    type="button"
                    className={`theme-btn ${deckScope === 'all' ? 'active' : ''}`}
                    onClick={() => {
                      setDeckScope('all');
                      if (activeChain) syncUrlParams(activeChain.slug, 'all');
                    }}
                  >
                    All Chains ({runs.length})
                  </button>
                </div>
              </div>

              <div className="deck-grid">
                {displayedDeckRuns.map((item) => {
                  const isCurrent = displayedRun?.id === item.id && !effectiveMismatchCard;
                  return (
                    <article
                      key={item.id}
                      className={`deck-card ${isCurrent ? 'active' : ''}`}
                    >
                      <button
                        type="button"
                        onClick={() => mountSavedRun(item)}
                        style={{
                          border: 'none',
                          padding: 0,
                          background: 'transparent',
                          cursor: 'pointer',
                          textAlign: 'left',
                          width: '100%',
                        }}
                      >
                        <div
                          style={{
                            width: '100%',
                            aspectRatio: '1 / 1',
                            background: '#F6F1E7',
                            borderBottom: '1px solid var(--border-subtle)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                          }}
                        >
                          {item.generated_media_url ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={item.generated_media_url}
                              alt={`${item.input_premise} (${item.structured_card.english_meaning})`}
                              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            />
                          ) : (
                            <span className="mono-font" style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                              $0 Text Preview
                            </span>
                          )}
                        </div>

                        <div style={{ padding: '9px 11px 6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                            <strong className="cjk-font" style={{ fontSize: 16 }}>
                              {item.input_premise}
                            </strong>
                            <span style={{ fontSize: 11.5, color: 'var(--accent-primary)', fontWeight: 700 }}>
                              {item.structured_card.pinyin}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: 'var(--fg-secondary)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {item.structured_card.english_meaning}
                          </div>
                        </div>
                      </button>

                      <div
                        style={{
                          padding: '4px 11px 9px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 6,
                          marginTop: 'auto',
                        }}
                      >
                        <button
                          type="button"
                          className="step-ctrl-btn"
                          onClick={() => mountSavedRun(item)}
                        >
                          Study Card ↑
                        </button>
                        <ConfirmDeleteButton
                          label="Delete"
                          ariaLabel={`Delete saved card ${item.input_premise}`}
                          onConfirm={() => handleDeleteRun(item.id)}
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            {/* Open-Source Dataset Attribution Footer */}
            <footer
              style={{
                fontSize: 11,
                color: 'var(--fg-muted)',
                textAlign: 'center',
                padding: '4px 0 8px',
              }}
            >
              Character decompositions &amp; stroke SVGs from Make Me a Hanzi (dictionary under LGPL
              v3+, stroke graphics under Arphic Public License) · Compound glosses &amp; readings
              from CC-CEDICT (CC BY-SA 4.0).
            </footer>
          </div>
        </div>
      </main>

      <PipelineEditorDrawer
        key={`${drawerState.mode}-${activeChain?.id ?? 'new'}-${drawerState.open ? '1' : '0'}`}
        open={drawerState.open}
        mode={drawerState.mode}
        chain={activeChain}
        steps={activeSteps}
        models={initialData.models}
        canDeleteChain={chains.length > 1}
        onClose={() => setDrawerState((prev) => ({ ...prev, open: false }))}
        onCreateChain={handleCreateChain}
        onUpdateChain={handleUpdateChain}
        onDeleteChain={handleDeleteChain}
        onAddStep={handleAddStep}
        onUpdateStep={handleUpdateStep}
        onDeleteStep={handleDeleteStep}
        onReorderSteps={handleReorderSteps}
      />

      <SessionKeysDrawer
        open={keysDrawerOpen}
        onClose={() => setKeysDrawerOpen(false)}
        serverStatus={initialData.providerStatus}
        imageBudget={imageBudget}
      />
    </div>
  );
}
