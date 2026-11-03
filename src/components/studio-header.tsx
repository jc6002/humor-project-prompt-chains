import Link from 'next/link';
import { ThemeSwitcher } from './theme-switcher';

type Props = {
  userEmail?: string | null;
  arenaUrl?: string | null;
  adminUrl?: string | null;
};

export function StudioHeader({ userEmail, arenaUrl, adminUrl }: Props) {
  return (
    <header className="site-header">
      <Link href="/" className="brand-link">
        <span className="brand-mark" aria-hidden="true">
          ai
        </span>
        <span>
          prompt chain studio<span className="brand-dot">.</span>
        </span>
      </Link>

      <div className="header-controls">
        {arenaUrl && (
          <a
            href={arenaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="button button-outline button-small"
          >
            Open Live Arena ↗
          </a>
        )}
        {adminUrl && (
          <a
            href={adminUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="button button-outline button-small"
          >
            Admin Console ↗
          </a>
        )}

        <ThemeSwitcher />

        {userEmail ? (
          <>
            <span className="account-pill" title={userEmail}>
              <span className="account-dot" aria-hidden="true" />
              <span>{userEmail}</span>
            </span>
            <form action="/auth/signout" method="post">
              <button type="submit" className="button button-outline button-small">
                Sign out
              </button>
            </form>
          </>
        ) : (
          <a href="/auth/signin" className="button button-small">
            Sign in with Google ↗
          </a>
        )}
      </div>
    </header>
  );
}
