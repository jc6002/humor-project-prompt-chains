'use client';
import { useState } from 'react';

export function ForbiddenSqlCopy({ userId }: { userId: string }) {
  const [copied, setCopied] = useState(false);
  const sql = `UPDATE public.profiles SET is_superadmin = TRUE WHERE id = '${userId}';`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API unavailable in restricted context
    }
  }

  return (
    <div>
      <pre className="sql-pre">
        <code>{sql}</code>
      </pre>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="button button-outline button-small" onClick={handleCopy}>
          {copied ? '✓ Copied SQL' : 'Copy SQL'}
        </button>
        <form action="/auth/signout" method="post" style={{ margin: 0 }}>
          <button type="submit" className="button button-small">
            Sign out &amp; switch Google account
          </button>
        </form>
      </div>
    </div>
  );
}
