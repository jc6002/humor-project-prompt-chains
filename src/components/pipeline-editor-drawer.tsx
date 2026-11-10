'use client';

import { useEffect, useRef, useState } from 'react';
import { AppSelect, type AppSelectOption } from './app-select';
import { ConfirmDeleteButton } from './confirm-delete-button';
import { DECOMPOSITION_MODE_OPTIONS } from '@/lib/chains/presets';
import type {
  DecompositionMode,
  PromptChainRow,
  PromptChainStepRow,
  SelectableModelOption,
  StepModality,
} from '@/lib/chains/types';

interface PipelineEditorDrawerProps {
  open: boolean;
  mode: 'edit' | 'create';
  chain: PromptChainRow | null;
  steps: PromptChainStepRow[];
  models: SelectableModelOption[];
  canDeleteChain: boolean;
  onClose: () => void;
  onCreateChain: (payload: {
    name: string;
    description: string;
    persona_style: string;
    decomposition_mode: DecompositionMode;
  }) => Promise<void>;
  onUpdateChain: (
    chainId: string,
    payload: {
      name: string;
      description: string;
      persona_style: string;
      decomposition_mode: DecompositionMode;
    }
  ) => Promise<void>;
  onDeleteChain: (chainId: string) => Promise<void>;
  onAddStep: (
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
  ) => Promise<void>;
  onUpdateStep: (
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
  ) => Promise<void>;
  onDeleteStep: (chainId: string, stepId: string) => Promise<void>;
  onReorderSteps: (chainId: string, orderedIds: string[]) => Promise<void>;
}

export function PipelineEditorDrawer({
  open,
  mode,
  chain,
  steps,
  models,
  canDeleteChain,
  onClose,
  onCreateChain,
  onUpdateChain,
  onDeleteChain,
  onAddStep,
  onUpdateStep,
  onDeleteStep,
  onReorderSteps,
}: PipelineEditorDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const stepFormRef = useRef<HTMLFormElement>(null);
  const isCreate = mode === 'create' || !chain;

  const [name, setName] = useState(isCreate ? '' : chain.name);
  const [description, setDescription] = useState(isCreate ? '' : chain.description ?? '');
  const [personaStyle, setPersonaStyle] = useState(
    isCreate
      ? 'Clear pedagogical Chinese component mnemonics with concrete visual objects and zero invented etymology.'
      : chain.persona_style
  );
  const [decompMode, setDecompMode] = useState<DecompositionMode>(
    isCreate ? 'flexible' : chain.decomposition_mode
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [addingStep, setAddingStep] = useState(false);

  const [stepName, setStepName] = useState('');
  const [stepRole, setStepRole] = useState('analysis');
  const [outputField, setOutputField] = useState('step_output');
  const [stepModality, setStepModality] = useState<StepModality>('text');
  const [stepModelId, setStepModelId] = useState('gemini-3.5-flash-lite');
  const [stepTemp, setStepTemp] = useState(0.25);
  const [stepTemplate, setStepTemplate] = useState('{{prev_output}}');

  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      prevFocus?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const decompOptions: AppSelectOption[] = DECOMPOSITION_MODE_OPTIONS.map((opt) => ({
    value: opt.value,
    label: opt.label,
    description: opt.badge,
  }));

  const modalityOptions: AppSelectOption[] = [
    { value: 'text', label: 'Text Generation ($0 Free Tier)' },
    { value: 'image_generation', label: '1:1 Scene Image ($0.034/img Flash Tier)' },
  ];

  const filteredModelOptions: AppSelectOption[] = models
    .filter((m) => m.modality === stepModality)
    .map((m) => ({
      value: m.modelId,
      label: m.label,
      description: m.tierBadge,
    }));

  const scrollStepFormIntoView = () => {
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      stepFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };

  const beginEditStep = (st: PromptChainStepRow) => {
    setAddingStep(false);
    setEditingStepId(st.id);
    setStepName(st.step_name);
    setStepRole(st.step_role);
    setOutputField(st.output_field);
    setStepModality(st.step_modality);
    setStepModelId(st.model_id);
    setStepTemp(st.temperature);
    setStepTemplate(st.instruction_template);
    scrollStepFormIntoView();
  };

  const beginAddStep = () => {
    setEditingStepId(null);
    setAddingStep(true);
    setStepName('Custom Mnemonic Step');
    setStepRole('analysis');
    setOutputField('custom_step_output');
    setStepModality('text');
    setStepModelId('gemini-3.5-flash-lite');
    setStepTemp(0.35);
    setStepTemplate('Refine {{prev_output}} for {{input}} ({{meaning}}) using clear learner notes.');
    scrollStepFormIntoView();
  };

  const handleChainSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (isCreate) {
        await onCreateChain({
          name,
          description,
          persona_style: personaStyle,
          decomposition_mode: decompMode,
        });
        onClose();
      } else if (chain) {
        await onUpdateChain(chain.id, {
          name,
          description,
          persona_style: personaStyle,
          decomposition_mode: decompMode,
        });
      }
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleStepSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chain) return;
    setBusy(true);
    setErr(null);
    try {
      const payload = {
        step_name: stepName,
        step_role: stepRole,
        output_field: outputField,
        model_id: stepModelId,
        temperature: stepTemp,
        step_modality: stepModality,
        instruction_template: stepTemplate,
      };
      if (addingStep) {
        await onAddStep(chain.id, payload);
        setAddingStep(false);
      } else if (editingStepId) {
        await onUpdateStep(chain.id, editingStepId, payload);
        setEditingStepId(null);
      }
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Step save failed.');
    } finally {
      setBusy(false);
    }
  };

  const moveStepToIndex = async (fromIdx: number, toIdx: number) => {
    if (!chain || fromIdx === toIdx || toIdx < 0 || toIdx >= steps.length) return;
    setBusy(true);
    setErr(null);
    try {
      const copy = [...steps];
      const [moved] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, moved);
      await onReorderSteps(
        chain.id,
        copy.map((s) => s.id)
      );
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Step reorder failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="drawer-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={isCreate ? 'Create New Prompt Chain' : `Edit Prompt Chain ${chain?.name ?? ''}`}
        tabIndex={-1}
        className="drawer-panel"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div className="eyebrow">PROMPT CHAIN &amp; STEP CRUD</div>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: '4px 0 0' }}>
              {isCreate ? 'Create New Prompt Chain' : `Edit Chain · ${chain.name}`}
            </h2>
          </div>
          <button type="button" className="button button-small" onClick={onClose}>
            Close ✕
          </button>
        </div>

        {err && (
          <div className="alert-error" style={{ marginBottom: 12 }}>
            {err}
          </div>
        )}

        <form onSubmit={handleChainSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label htmlFor="chain-name-input" style={{ display: 'block', fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>
              Chain Name
            </label>
            <input
              id="chain-name-input"
              type="text"
              required
              className="field-input"
              placeholder="e.g. Custom Storyboard Mnemonic Chain"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>
              Linguistic Decomposition Mode
            </label>
            <AppSelect
              ariaLabel="Linguistic Decomposition Mode"
              value={decompMode}
              options={decompOptions}
              onChange={(v) => setDecompMode(v as DecompositionMode)}
            />
          </div>

          <div>
            <label htmlFor="chain-desc-input" style={{ display: 'block', fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>
              Description
            </label>
            <input
              id="chain-desc-input"
              type="text"
              className="field-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="chain-persona-input" style={{ display: 'block', fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>
              Editorial Persona
            </label>
            <textarea
              id="chain-persona-input"
              rows={2}
              className="field-textarea"
              value={personaStyle}
              onChange={(e) => setPersonaStyle(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <button type="submit" className="app-button-primary" disabled={busy} style={{ flex: 1 }}>
              {isCreate ? 'Create 4-Step Chain' : 'Save Chain Metadata'}
            </button>
            {!isCreate && chain && canDeleteChain && (
              <ConfirmDeleteButton
                label="Delete Chain"
                confirmLabel="Confirm Delete"
                ariaLabel={`Delete chain ${chain.name}`}
                disabled={busy}
                onConfirm={async () => {
                  await onDeleteChain(chain.id);
                  onClose();
                }}
              />
            )}
          </div>
        </form>

        {!isCreate && chain && (
          <div style={{ marginTop: 20, borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong style={{ fontSize: 13.5 }}>
                Sequential Chain Steps ({steps.length})
              </strong>
              <button type="button" className="button button-small" onClick={beginAddStep} disabled={busy}>
                + Add Step
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {steps.map((st, idx) => {
                const posOptions: AppSelectOption[] = steps.map((_, targetIdx) => ({
                  value: String(targetIdx),
                  label: `Step ${targetIdx + 1}`,
                }));
                return (
                  <div
                    key={st.id}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--surface-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                        0{st.step_order} · {st.step_name}{' '}
                        <span className="mono-font" style={{ color: 'var(--accent-primary)', fontSize: 11 }}>
                          ({st.model_id} · T={st.temperature.toFixed(2)})
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="step-ctrl-btn"
                          disabled={busy || idx === 0}
                          aria-label={`Move step ${st.step_order} up`}
                          onClick={() => moveStepToIndex(idx, idx - 1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="step-ctrl-btn"
                          disabled={busy || idx === steps.length - 1}
                          aria-label={`Move step ${st.step_order} down`}
                          onClick={() => moveStepToIndex(idx, idx + 1)}
                        >
                          ↓
                        </button>
                        <div style={{ width: 92 }}>
                          <AppSelect
                            compact
                            ariaLabel={`Move ${st.step_name} to position`}
                            value={String(idx)}
                            options={posOptions}
                            disabled={busy}
                            onChange={(v) => moveStepToIndex(idx, Number(v))}
                          />
                        </div>
                        <button
                          type="button"
                          className="step-ctrl-btn"
                          disabled={busy}
                          onClick={() => beginEditStep(st)}
                        >
                          Edit
                        </button>
                        {steps.length > 1 && (
                          <ConfirmDeleteButton
                            label="Delete"
                            disabled={busy}
                            ariaLabel={`Delete step ${st.step_name}`}
                            onConfirm={() => onDeleteStep(chain.id, st.id)}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {(addingStep || editingStepId) && (
              <form
                ref={stepFormRef}
                onSubmit={handleStepSave}
                style={{
                  marginTop: 14,
                  padding: 12,
                  borderRadius: 10,
                  border: '1px solid var(--accent-primary)',
                  background: 'var(--surface-panel)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <strong style={{ fontSize: 13 }}>
                  {addingStep ? 'Add New Step' : 'Edit Step Settings'}
                </strong>

                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, marginBottom: 3 }}>
                    Step Name
                  </label>
                  <input
                    type="text"
                    required
                    className="field-input"
                    value={stepName}
                    onChange={(e) => setStepName(e.target.value)}
                  />
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                    gap: 8,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, marginBottom: 3 }}>
                      Step Modality
                    </label>
                    <AppSelect
                      ariaLabel="Step Modality"
                      value={stepModality}
                      options={modalityOptions}
                      onChange={(val) => {
                        const mod = val as StepModality;
                        setStepModality(mod);
                        setStepModelId(
                          mod === 'image_generation'
                            ? 'gemini-3.1-flash-lite-image'
                            : 'gemini-3.5-flash-lite'
                        );
                        setStepTemp(mod === 'image_generation' ? 0.6 : 0.25);
                      }}
                    />
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, marginBottom: 3 }}>
                      Gemini Model
                    </label>
                    <AppSelect
                      ariaLabel="Step Model"
                      value={stepModelId}
                      options={filteredModelOptions}
                      onChange={setStepModelId}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 700, marginBottom: 3 }}>
                    <span>Temperature</span>
                    <span className="mono-font">{stepTemp.toFixed(2)}</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.05}
                    value={stepTemp}
                    onChange={(e) => setStepTemp(Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, marginBottom: 3 }}>
                    Instruction Template (supports {'{{input}}'}, {'{{lookup_json}}'}, {'{{prev_output}}'}, {'{{step_1_output}}'})
                  </label>
                  <textarea
                    rows={4}
                    required
                    className="field-textarea mono-font"
                    style={{ fontSize: 11.5 }}
                    value={stepTemplate}
                    onChange={(e) => setStepTemplate(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="app-button-primary" disabled={busy} style={{ flex: 1 }}>
                    {addingStep ? 'Insert Step' : 'Save Step'}
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      setAddingStep(false);
                      setEditingStepId(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
