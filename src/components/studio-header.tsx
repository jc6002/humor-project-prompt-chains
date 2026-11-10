'use client';

import Link from 'next/link';
import { ThemeSwitcher } from './theme-switcher';

interface StudioHeaderProps {
  userEmail: string | null;
  leftControls?: React.ReactNode;
  rightExtra?: React.ReactNode;
}

export function StudioHeader({ userEmail, leftControls, rightExtra }: StudioHeaderProps) {
  return (
    <header className="site-header">
      <div className="header-left">
        <Link href="/" className="brand-mark">
          <span className="brand-badge cjk-font" aria-hidden="true">
            字
          </span>
          <span className="brand-title">Hanzi Parts Studio</span>
        </Link>
        {leftControls}
      </div>

      <div className="header-controls">
        {rightExtra}
        <ThemeSwitcher />
        {userEmail && (
          <>
            <div className="account-pill" title={userEmail}>
              <span className="account-pill-dot" aria-hidden="true" />
              <span className="account-pill-email">{userEmail}</span>
            </div>
            <form action="/auth/signout" method="post" style={{ margin: 0 }}>
              <button type="submit" className="button button-small">
                Sign out
              </button>
            </form>
          </>
        )}
      </div>
    </header>
  );
}
