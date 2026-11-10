'use client';

import { useEffect, useRef, useState } from 'react';
import type { DailyImageBudget } from '@/lib/chains/types';

export const SESSION_FREE_KEY_STORAGE = 'hanzi-session-free-key';
export const SESSION_PAID_KEY_STORAGE = 'hanzi-session-paid-key';
export const SESSION_KEYS_EVENT = 'hanzi-session-keys-change';

interface SessionKeysDrawerProps {
  open: boolean;
  onClose: () => void;
  serverStatus: {
    geminiFreeConfigured: boolean;
    geminiPaidConfigured: boolean;
  };
  imageBudget: DailyImageBudget;
}

export function SessionKeysDrawer({
  open,
  onClose,
  serverStatus,
  imageBudget,
}: SessionKeysDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [freeKey, setFreeKey] = useState(() =>
    typeof window !== 'undefined' ? sessionStorage.getItem(SESSION_FREE_KEY_STORAGE) ?? '' : ''
  );
  const [paidKey, setPaidKey] = useState(() =>
    typeof window !== 'undefined' ? sessionStorage.getItem(SESSION_PAID_KEY_STORAGE) ?? '' : ''
  );

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
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
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

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (freeKey.trim()) {
        sessionStorage.setItem(SESSION_FREE_KEY_STORAGE, freeKey.trim());
      } else {
        sessionStorage.removeItem(SESSION_FREE_KEY_STORAGE);
      }
      if (paidKey.trim()) {
        sessionStorage.setItem(SESSION_PAID_KEY_STORAGE, paidKey.trim());
      } else {
        sessionStorage.removeItem(SESSION_PAID_KEY_STORAGE);
      }
      window.dispatchEvent(new Event(SESSION_KEYS_EVENT));
    } catch {
      // Ignore sessionStorage restrictions.
    }
    onClose();
  };

  const handleClear = () => {
    setFreeKey('');
    setPaidKey('');
    try {
      sessionStorage.removeItem(SESSION_FREE_KEY_STORAGE);
      sessionStorage.removeItem(SESSION_PAID_KEY_STORAGE);
      window.dispatchEvent(new Event(SESSION_KEYS_EVENT));
    } catch {
      // Ignore sessionStorage restrictions.
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
        aria-label="Session API Keys and Daily Image Budget"
        tabIndex={-1}
        className="drawer-panel"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div className="eyebrow">DUAL-KEY ROUTING &amp; DAILY COST GUARD</div>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: '4px 0 0' }}>
              Session Keys &amp; Image Cap
            </h2>
          </div>
          <button type="button" className="button button-small" onClick={onClose}>
            Close ✕
          </button>
        </div>

        <div
          style={{
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid var(--border-strong)',
            background: 'var(--surface-subtle)',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 700 }}>
            <span>Today&apos;s Paid Scene Images (UTC)</span>
            <span className="mono-font">
              {imageBudget.usedToday} / {imageBudget.dailyCap} used ({imageBudget.remaining} left)
            </span>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--fg-muted)', margin: '6px 0 0', lineHeight: 1.45 }}>
            Seeded showcase cards and $0 Text-Preview runs never count against the daily cap. Step 4
            uses cheap $0.034/img Flash image models only (gemini-3.1-flash-lite-image cascading to
            gemini-nano-banana-2.1).
          </p>
        </div>

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label htmlFor="session-free-key" style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
              Project A · $0 Free-Tier Gemini Key (Steps 1–3 Text)
            </label>
            <input
              id="session-free-key"
              type="password"
              autoComplete="off"
              className="field-input mono-font"
              placeholder={
                serverStatus.geminiFreeConfigured
                  ? 'Server GEMINI_API_KEY configured (optional session override)'
                  : 'Paste AIza... Google AI Studio Free-Tier key'
              }
              value={freeKey}
              onChange={(e) => setFreeKey(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="session-paid-key" style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
              Project B · Paid Gemini Key (Step 4 $0.034/img Flash Scene)
            </label>
            <input
              id="session-paid-key"
              type="password"
              autoComplete="off"
              className="field-input mono-font"
              placeholder={
                serverStatus.geminiPaidConfigured
                  ? 'Server GEMINI_PAID_API_KEY configured (optional session override)'
                  : 'Paste AIza... Paid-Tier key (or toggle Text Steps Only $0 mode)'
              }
              value={paidKey}
              onChange={(e) => setPaidKey(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button type="submit" className="app-button-primary" style={{ flex: 1 }}>
              Save Session Keys
            </button>
            <button type="button" className="button" onClick={handleClear}>
              Clear Overrides
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
