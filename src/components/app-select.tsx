'use client';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

export type AppSelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: readonly AppSelectOption[];
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  compact?: boolean;
  disabled?: boolean;
};

type MenuCoords = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

export function AppSelect({
  value,
  onChange,
  options,
  id,
  ariaLabel,
  placeholder = 'Choose option…',
  compact = false,
  disabled = false,
}: Props) {
  const listboxId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [coords, setCoords] = useState<MenuCoords | null>(null);

  const selectedIdx = options.findIndex((o) => o.value === value);
  const selected = selectedIdx >= 0 ? options[selectedIdx] : null;

  const updateCoords = useCallback(() => {
    const el = triggerRef.current;
    if (!el || typeof window === 'undefined') return;
    const rect = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;

    if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) {
      setOpen(false);
      return;
    }

    const desiredWidth = Math.max(rect.width, compact ? 168 : 240);
    const width = Math.min(desiredWidth, Math.max(140, vw - 16));
    const left = Math.max(8, Math.min(rect.left, vw - width - 8));

    const spaceBelow = vh - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openUpward = spaceBelow < 180 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(130, Math.min(296, openUpward ? spaceAbove : spaceBelow));
    const estimatedMenuHeight = Math.min(maxHeight, options.length * 44 + 12);
    const top = openUpward
      ? Math.max(8, rect.top - estimatedMenuHeight - 5)
      : rect.bottom + 5;

    setCoords({ top, left, width, maxHeight });
  }, [compact, options.length]);

  useLayoutEffect(() => {
    if (!open) return;
    updateCoords();
  }, [open, updateCoords]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }

    function handleViewportChange() {
      updateCoords();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, updateCoords]);

  function findNextEnabledIndex(start: number, step: 1 | -1): number {
    if (options.length === 0) return -1;
    let idx = start;
    for (let i = 0; i < options.length; i++) {
      idx = (idx + step + options.length) % options.length;
      if (!options[idx]?.disabled) return idx;
    }
    return -1;
  }

  function openMenu() {
    if (disabled || options.length === 0) return;
    const initial =
      selectedIdx >= 0 && !options[selectedIdx]?.disabled
        ? selectedIdx
        : findNextEnabledIndex(-1, 1);
    setActiveIndex(Math.max(0, initial));
    setOpen(true);
  }

  function commitIndex(idx: number) {
    const opt = options[idx];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMenu();
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = findNextEnabledIndex(activeIndex, 1);
      if (next >= 0) setActiveIndex(next);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = findNextEnabledIndex(activeIndex, -1);
      if (prev >= 0) setActiveIndex(prev);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      const first = findNextEnabledIndex(-1, 1);
      if (first >= 0) setActiveIndex(first);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      const last = findNextEnabledIndex(0, -1);
      if (last >= 0) setActiveIndex(last);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      commitIndex(activeIndex);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`chain-select-trigger ${compact ? 'chain-select-compact' : ''} ${
          open ? 'chain-select-open' : ''
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className={`chain-select-label ${selected ? '' : 'chain-select-placeholder'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          className="chain-select-chevron"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 6.25L8 10.25L12 6.25"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            className="chain-select-menu"
            style={{
              top: coords.top,
              left: coords.left,
              width: coords.width,
              maxHeight: coords.maxHeight,
            }}
          >
            {options.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isActive = idx === activeIndex;
              return (
                <div
                  key={`${opt.value}-${idx}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled || undefined}
                  className={`chain-select-option ${isSelected ? 'selected' : ''} ${
                    isActive ? 'active' : ''
                  } ${opt.disabled ? 'disabled' : ''}`}
                  onMouseEnter={() => {
                    if (!opt.disabled) setActiveIndex(idx);
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commitIndex(idx)}
                >
                  <div className="chain-select-option-text">
                    <span>{opt.label}</span>
                    {opt.description && <small>{opt.description}</small>}
                  </div>
                  {isSelected && (
                    <span className="chain-select-check" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
