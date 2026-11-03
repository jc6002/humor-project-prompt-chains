'use client';
import { useRef, useState } from 'react';
import { ChainSelect } from './chain-select';
import { ConfirmDeleteButton } from './confirm-delete-button';
import { STEP_ROLE_OPTIONS, tokenizeTemplateVariables } from '@/lib/chains/validation';
import type { PromptChainRow, PromptChainStepRow } from '@/lib/chains/types';

type Props = {
  chain: PromptChainRow;
  steps: readonly PromptChainStepRow[];
  busy: boolean;
  onStepsMutated: (nextSteps: PromptChainStepRow[]) => void;
  onRefresh: () => void;
  onError: (msg: string | null) => void;
  onStatus: (msg: string | null) => void;
};

function VariableChipBar({
  stepNumber,
  onInsert,
}: {
  stepNumber: number;
  onInsert: (variableToken: string) => void;
}) {
  const upstreamNums = Array.from({ length: Math.max(0, stepNumber - 1) }, (_, idx) => idx + 1);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexWrap: 'wrap',
        marginBottom: '6px',
      }}
    >
      <span className="mono" style={{ fontSize: '11px', fontWeight: 700, color: 'var(--muted)' }}>
        INSERT VARIABLE:
      </span>
      <button
        type="button"
        className="chip"
        onClick={() => onInsert('{{input}}')}
        title="Scene image description + optional user premise"
      >
        + {'{{input}}'}
      </button>
      <button
        type="button"
        className="chip"
        disabled={stepNumber <= 1}
        onClick={() => onInsert('{{prev_output}}')}
        title={stepNumber <= 1 ? 'Step 1 has no prior step' : 'Insert output from immediately preceding step'}
      >
        + {'{{prev_output}}'}
        {stepNumber <= 1 ? ' (Step 1 has no prior step)' : ''}
      </button>
      {upstreamNums.map((n) => {
        const tok = `{{step_${n}_output}}`;
        return (
          <button
            key={tok}
            type="button"
            className="chip"
            onClick={() => onInsert(tok)}
            title={`Insert output from Step ${n}`}
          >
            + {tok}
          </button>
        );
      })}
    </div>
  );
}

function HighlightedInstruction({ template }: { template: string }) {
  const segments = tokenizeTemplateVariables(template);
  return (
    <p
      style={{
        margin: 0,
        fontSize: '13.5px',
        lineHeight: 1.55,
        color: 'var(--fg-secondary)',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
      }}
    >
      {segments.map((seg, i) =>
        seg.type === 'variable' ? (
          <span key={i} className="template-token-pill">
            {seg.value}
          </span>
        ) : (
          <span key={i}>{seg.value}</span>
        )
      )}
    </p>
  );
}

function insertTokenAtCaret(
  textarea: HTMLTextAreaElement | null,
  currentValue: string,
  token: string,
  setValue: (next: string) => void
) {
  if (!textarea) {
    setValue(currentValue ? `${currentValue} ${token}` : token);
    return;
  }
  const start = textarea.selectionStart ?? currentValue.length;
  const end = textarea.selectionEnd ?? currentValue.length;
  const next = `${currentValue.slice(0, start)}${token}${currentValue.slice(end)}`;
  setValue(next);
  const caretPos = start + token.length;
  window.requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(caretPos, caretPos);
  });
}

export function StepEditorZone({
  chain,
  steps,
  busy,
  onStepsMutated,
  onRefresh,
  onError,
  onStatus,
}: Props) {
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('custom_instruction');
  const [editOutputField, setEditOutputField] = useState('');
  const [editTemplate, setEditTemplate] = useState('');
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('twist_planner');
  const [newOutputField, setNewOutputField] = useState('');
  const [newTemplate, setNewTemplate] = useState(
    'Take {{prev_output}} and sharpen the unexpected engineering or campus irony in 2 crisp sentences.'
  );
  const newTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [savingStep, setSavingStep] = useState(false);

  const orderedSteps = steps.slice().sort((a, b) => a.step_order - b.step_order);

  function startEditStep(step: PromptChainStepRow) {
    setEditingStepId(step.id);
    setEditName(step.step_name);
    setEditRole(step.step_role || 'custom_instruction');
    setEditOutputField(step.output_field ?? '');
    setEditTemplate(step.instruction_template);
    onError(null);
  }

  async function saveEditStep(stepId: string) {
    setSavingStep(true);
    onError(null);
    try {
      const res = await fetch(`/api/chains/${chain.id}/steps/${stepId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step_name: editName,
          step_role: editRole,
          output_field: editOutputField,
          instruction_template: editTemplate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update step.');
      const updated = data.step as PromptChainStepRow;
      onStepsMutated(orderedSteps.map((s) => (s.id === stepId ? updated : s)));
      setEditingStepId(null);
      onStatus(`Saved Step ${String(updated.step_order).padStart(2, '0')} (${updated.step_name}).`);
      onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save step.');
    } finally {
      setSavingStep(false);
    }
  }

  async function createStep(e: React.FormEvent) {
    e.preventDefault();
    setSavingStep(true);
    onError(null);
    try {
      const res = await fetch(`/api/chains/${chain.id}/steps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step_name: newName,
          step_role: newRole,
          output_field: newOutputField,
          instruction_template: newTemplate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add step.');
      const created = data.step as PromptChainStepRow;
      onStepsMutated([...orderedSteps, created]);
      setShowAddForm(false);
      setNewName('');
      setNewOutputField('');
      onStatus(`Added Step ${String(created.step_order).padStart(2, '0')} (${created.step_name}).`);
      onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create step.');
    } finally {
      setSavingStep(false);
    }
  }

  async function deleteStep(stepId: string, stepName: string) {
    setSavingStep(true);
    onError(null);
    try {
      const res = await fetch(`/api/chains/${chain.id}/steps/${stepId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete step.');
      const compacted = Array.isArray(data.steps) ? (data.steps as PromptChainStepRow[]) : [];
      onStepsMutated(compacted);
      if (editingStepId === stepId) setEditingStepId(null);
      onStatus(`Deleted "${stepName}" and compacted remaining step order.`);
      onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delete step.');
    } finally {
      setSavingStep(false);
    }
  }

  async function moveStepToIndex(fromIndex: number, toIndex: number) {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= orderedSteps.length ||
      toIndex >= orderedSteps.length
    ) {
      return;
    }

    const nextList = orderedSteps.slice();
    const [moved] = nextList.splice(fromIndex, 1);
    nextList.splice(toIndex, 0, moved);
    const optimistic = nextList.map((s, idx) => ({ ...s, step_order: idx + 1 }));
    onStepsMutated(optimistic);
    setSavingStep(true);
    onError(null);

    try {
      const res = await fetch(`/api/chains/${chain.id}/steps/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepIds: optimistic.map((s) => s.id) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reorder steps.');
      if (Array.isArray(data.steps)) {
        onStepsMutated(data.steps as PromptChainStepRow[]);
      }
      onStatus(`Moved "${moved.step_name}" to Step #${toIndex + 1}.`);
      onRefresh();
    } catch (err) {
      onStepsMutated(orderedSteps);
      onError(err instanceof Error ? err.message : 'Step reorder failed.');
    } finally {
      setSavingStep(false);
    }
  }

  const controlsDisabled = busy || savingStep;

  return (
    <section id="zone-steps" className="studio-card">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
          marginBottom: '12px',
        }}
      >
        <div>
          <div className="eyebrow">ZONE 1 · PIPELINE STEP EDITOR</div>
          <h2 style={{ fontSize: '19px', fontWeight: 800, margin: '4px 0 0' }}>
            Ordered Reasoning Steps ({orderedSteps.length})
          </h2>
        </div>
        <button
          type="button"
          className={showAddForm ? 'button button-outline button-small' : 'button button-small'}
          disabled={controlsDisabled}
          onClick={() => {
            setShowAddForm((v) => !v);
            onError(null);
          }}
        >
          {showAddForm ? 'Cancel New Step' : '+ Add Step'}
        </button>
      </div>

      {/* Pipeline Breadcrumb Strip */}
      <div className="pipeline-breadcrumb" style={{ marginBottom: '14px' }}>
        <span className="badge badge-accent">Scene Image + Premise</span>
        {orderedSteps.map((s, idx) => (
          <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span aria-hidden="true" style={{ color: 'var(--muted)' }}>
              →
            </span>
            <span className="badge">
              <strong className="mono">{String(idx + 1).padStart(2, '0')}</strong> {s.step_name}
            </span>
          </span>
        ))}
      </div>

      {/* Ordered Step Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {orderedSteps.length === 0 && (
          <div
            style={{
              padding: '18px',
              borderRadius: '9px',
              border: '1px dashed var(--line-strong)',
              color: 'var(--muted)',
              fontSize: '13.5px',
            }}
          >
            This prompt chain has no steps yet. Click <strong>+ Add Step</strong> to define Step 01.
          </div>
        )}

        {orderedSteps.map((step, idx) => {
          const isEditing = editingStepId === step.id;
          const isFinal = idx === orderedSteps.length - 1;
          const moveOptions = orderedSteps.map((_, posIdx) => ({
            value: String(posIdx),
            label: `Move: #${posIdx + 1}`,
            description:
              posIdx === idx ? 'Current step position' : `Move step to position #${posIdx + 1}`,
          }));

          return (
            <div key={step.id} className="step-card">
              <div className="step-header-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
                  <span className="badge badge-accent mono">
                    STEP {String(idx + 1).padStart(2, '0')}
                  </span>
                  <strong style={{ fontSize: '15px' }}>{step.step_name}</strong>
                  <span className="badge mono">{step.step_role}</span>
                  <span className="badge mono">
                    Produces: {`{{step_${idx + 1}_output}}`}
                    {step.output_field ? ` · ${step.output_field}` : ''}
                  </span>
                </div>

                <div className="step-actions">
                  <button
                    type="button"
                    className="chip"
                    aria-label={`Move step ${idx + 1} up`}
                    disabled={controlsDisabled || idx === 0}
                    onClick={() => moveStepToIndex(idx, idx - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="chip"
                    aria-label={`Move step ${idx + 1} down`}
                    disabled={controlsDisabled || idx === orderedSteps.length - 1}
                    onClick={() => moveStepToIndex(idx, idx + 1)}
                  >
                    ↓
                  </button>
                  <ChainSelect
                    compact
                    ariaLabel={`Move step ${idx + 1} to position`}
                    value={String(idx)}
                    options={moveOptions}
                    disabled={controlsDisabled || orderedSteps.length <= 1}
                    onChange={(val) => moveStepToIndex(idx, Number.parseInt(val, 10))}
                  />
                  <button
                    type="button"
                    className="chip"
                    disabled={controlsDisabled}
                    onClick={() => (isEditing ? setEditingStepId(null) : startEditStep(step))}
                  >
                    {isEditing ? 'Close' : '✏️ Edit'}
                  </button>
                  <ConfirmDeleteButton
                    disabled={controlsDisabled}
                    ariaLabel={`Delete step ${step.step_name}`}
                    onConfirm={() => deleteStep(step.id, step.step_name)}
                  />
                </div>
              </div>

              {isEditing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '4px' }}>
                  <div className="form-grid-2">
                    <div>
                      <label className="field-label" htmlFor={`edit-step-name-${step.id}`}>
                        Step Name
                      </label>
                      <input
                        id={`edit-step-name-${step.id}`}
                        className="studio-input"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="field-label" htmlFor={`edit-step-role-${step.id}`}>
                        Step Role
                      </label>
                      <ChainSelect
                        id={`edit-step-role-${step.id}`}
                        ariaLabel="Step role"
                        value={editRole}
                        options={STEP_ROLE_OPTIONS}
                        onChange={setEditRole}
                      />
                    </div>
                    <div className="field-span-2">
                      <label className="field-label" htmlFor={`edit-step-field-${step.id}`}>
                        Output Field Label (Optional)
                      </label>
                      <input
                        id={`edit-step-field-${step.id}`}
                        className="studio-input"
                        placeholder="e.g. image_description, funny_observation, captions"
                        value={editOutputField}
                        onChange={(e) => setEditOutputField(e.target.value)}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="field-label" htmlFor={`edit-step-tpl-${step.id}`}>
                      Instruction Template
                    </label>
                    <VariableChipBar
                      stepNumber={idx + 1}
                      onInsert={(tok) =>
                        insertTokenAtCaret(editTextareaRef.current, editTemplate, tok, setEditTemplate)
                      }
                    />
                    <textarea
                      ref={editTextareaRef}
                      id={`edit-step-tpl-${step.id}`}
                      rows={4}
                      className="studio-textarea"
                      value={editTemplate}
                      onChange={(e) => setEditTemplate(e.target.value)}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="button button-small"
                      disabled={controlsDisabled}
                      onClick={() => saveEditStep(step.id)}
                    >
                      Save Step
                    </button>
                    <button
                      type="button"
                      className="button button-outline button-small"
                      disabled={controlsDisabled}
                      onClick={() => setEditingStepId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <HighlightedInstruction template={step.instruction_template} />
                  {isFinal && (
                    <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                      Final step synthesizes 5 ranked funny captions for the input image/scene.
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Step Form */}
      {showAddForm && (
        <form
          onSubmit={createStep}
          style={{
            marginTop: '14px',
            padding: '16px',
            borderRadius: '10px',
            background: 'var(--surface-2)',
            border: '1px solid var(--accent-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div className="eyebrow">
            APPEND STEP {String(orderedSteps.length + 1).padStart(2, '0')}
          </div>
          <div className="form-grid-2">
            <div>
              <label className="field-label" htmlFor="new-step-name">
                Step Name
              </label>
              <input
                id="new-step-name"
                required
                className="studio-input"
                placeholder="e.g. Escalate Irony"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="new-step-role">
                Step Role
              </label>
              <ChainSelect
                id="new-step-role"
                ariaLabel="New step role"
                value={newRole}
                options={STEP_ROLE_OPTIONS}
                onChange={setNewRole}
              />
            </div>
            <div className="field-span-2">
              <label className="field-label" htmlFor="new-step-field">
                Output Field Label (Optional)
              </label>
              <input
                id="new-step-field"
                className="studio-input"
                placeholder="e.g. comic_observation"
                value={newOutputField}
                onChange={(e) => setNewOutputField(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="new-step-template">
              Instruction Template
            </label>
            <VariableChipBar
              stepNumber={orderedSteps.length + 1}
              onInsert={(tok) =>
                insertTokenAtCaret(newTextareaRef.current, newTemplate, tok, setNewTemplate)
              }
            />
            <textarea
              ref={newTextareaRef}
              id="new-step-template"
              required
              rows={3}
              className="studio-textarea"
              value={newTemplate}
              onChange={(e) => setNewTemplate(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button type="submit" className="button button-small" disabled={controlsDisabled}>
              Append Step #{orderedSteps.length + 1}
            </button>
            <button
              type="button"
              className="button button-outline button-small"
              disabled={controlsDisabled}
              onClick={() => setShowAddForm(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
