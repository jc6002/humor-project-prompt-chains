'use client';
import { useSyncExternalStore } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'prompt-chain-studio-theme';
const listeners = new Set<() => void>();

function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'light') return 'light';
  if (pref === 'dark') return 'dark';
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function applyDocumentTheme(pref: ThemePreference) {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePref = pref;
  document.documentElement.style.colorScheme = resolved;
}

function getClientSnapshot(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') {
      return raw;
    }
  } catch {
    // Ignore restricted storage environments
  }
  return 'system';
}

function getServerSnapshot(): ThemePreference {
  return 'system';
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  if (typeof window === 'undefined') {
    return () => listeners.delete(callback);
  }

  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const handleMedia = () => {
    const current = getClientSnapshot();
    if (current === 'system') {
      applyDocumentTheme('system');
      callback();
    }
  };
  const handleStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      applyDocumentTheme(getClientSnapshot());
      callback();
    }
  };

  mql.addEventListener('change', handleMedia);
  window.addEventListener('storage', handleStorage);
  return () => {
    listeners.delete(callback);
    mql.removeEventListener('change', handleMedia);
    window.removeEventListener('storage', handleStorage);
  };
}

export function setThemePreference(nextPref: ThemePreference) {
  try {
    window.localStorage.setItem(STORAGE_KEY, nextPref);
  } catch {
    // Ignore storage write errors
  }
  applyDocumentTheme(nextPref);
  for (const listener of listeners) {
    listener();
  }
}

const SEGMENTS: ReadonlyArray<{ value: ThemePreference; icon: string; label: string }> = [
  { value: 'light', icon: '☀', label: 'Light' },
  { value: 'dark', icon: '☾', label: 'Dark' },
  { value: 'system', icon: '◐', label: 'System' },
];

export function ThemeSwitcher() {
  const pref = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);

  return (
    <div className="theme-switcher" role="radiogroup" aria-label="Color theme">
      {SEGMENTS.map((seg) => {
        const active = pref === seg.value;
        return (
          <button
            key={seg.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`theme-segment ${active ? 'active' : ''}`}
            onClick={() => setThemePreference(seg.value)}
          >
            <span aria-hidden="true">{seg.icon}</span>
            <span>{seg.label}</span>
          </button>
        );
      })}
    </div>
  );
}
