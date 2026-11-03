'use client';
import { useEffect, useState } from 'react';

type Props = {
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
  label?: string;
  confirmLabel?: string;
  ariaLabel?: string;
};

export function ConfirmDeleteButton({
  onConfirm,
  disabled = false,
  label = '🗑 Delete',
  confirmLabel = 'Confirm',
  ariaLabel,
}: Props) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4500);
    return () => window.clearTimeout(timer);
  }, [armed]);

  if (!armed) {
    return (
      <button
        type="button"
        className="chip chip-danger"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setArmed(true)}
      >
        {label}
      </button>
    );
  }

  return (
    <span className="confirm-delete-group" role="group" aria-label="Confirm deletion">
      <button
        type="button"
        className="button button-small button-danger-solid"
        disabled={disabled}
        onClick={async () => {
          setArmed(false);
          await onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        className="chip"
        disabled={disabled}
        onClick={() => setArmed(false)}
      >
        Cancel
      </button>
    </span>
  );
}
