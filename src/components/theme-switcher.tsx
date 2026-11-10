'use client';

import { useEffect, useState } from 'react';

type ThemePref = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'hanzi-parts-studio-theme';

function applyTheme(pref: ThemePref): void {
  if (typeof window === 'undefined') return;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = pref === 'dark' || (pref === 'system' && prefersDark) ? 'dark' : 'light';
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePref = pref;
  document.documentElement.style.colorScheme = resolved;
}

export function ThemeSwitcher() {
  const [pref, setPref] = useState<ThemePref>(() => {
    if (typeof window === 'undefined') return 'system';
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  });

  useEffect(() => {
    applyTheme(pref);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const latest = (localStorage.getItem(STORAGE_KEY) as ThemePref | null) ?? 'system';
      if (latest === 'system') applyTheme('system');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  const choose = (next: ThemePref) => {
    setPref(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage quota errors in restricted browsers.
    }
    applyTheme(next);
  };

  const options: ReadonlyArray<{ value: ThemePref; label: string }> = [
    { value: 'light', label: '☀ Light' },
    { value: 'dark', label: '☾ Dark' },
    { value: 'system', label: '◐ System' },
  ];

  return (
    <div className="theme-segment" role="radiogroup" aria-label="Color theme">
      {options.map((opt, idx) => {
        const active = pref === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            className={`theme-btn ${active ? 'active' : ''}`}
            onClick={() => choose(opt.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                choose(options[(idx + 1) % options.length].value);
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                choose(options[(idx - 1 + options.length) % options.length].value);
              }
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
