import React, { useEffect, useState } from 'react';
import { S, font, jsonFetch } from './shared';

/** The one door. Both /add and /review sit behind the same shared passphrase, entered
 * once per device — the server answers with a signed cookie that lasts about a year, so
 * in practice this screen is seen exactly once per browser. The passphrase itself is
 * never in this bundle; the page only ever sends what the person typed to /api/unlock. */

const input: React.CSSProperties = {
  padding: '8px 10px', fontSize: 14, fontFamily: font, color: S.text,
  border: `1px solid ${S.borderStrong}`, borderRadius: 6, background: S.surface,
};
const button: React.CSSProperties = {
  padding: '8px 16px', fontSize: 13, fontWeight: 600, fontFamily: font, cursor: 'pointer',
  background: S.accent, color: '#fff', border: 'none', borderRadius: 6,
};

/** null = still checking, false = locked, true = in. */
export function useUnlock(): [boolean | null, () => void] {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  useEffect(() => {
    jsonFetch('/api/unlock/session')
      .then((r) => setUnlocked(!!r.ok))
      .catch(() => setUnlocked(false));
  }, []);
  return [unlocked, () => setUnlocked(true)];
}

export function UnlockScreen({ title, onIn }: { title: string; onIn: () => void }) {
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!phrase.trim()) return;
    setBusy(true); setError('');
    try {
      await jsonFetch('/api/unlock', {
        method: 'POST', body: JSON.stringify({ passphrase: phrase }),
      });
      onIn();
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ fontFamily: font, color: S.text, background: S.surface, minHeight: '100vh' }}>
      <div style={{ maxWidth: 380, margin: '18vh auto 0', padding: '0 16px' }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: S.heading }}>{title}</div>
        <div style={{ fontSize: 13, color: S.muted, margin: '6px 0 16px', lineHeight: 1.5 }}>
          Enter the passphrase. This device remembers it — you won't be asked again here.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ ...input, flex: 1 }} type="password" value={phrase} autoFocus
            placeholder="passphrase"
            onChange={(e) => setPhrase(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && go()} />
          <button style={busy ? { ...button, opacity: 0.6 } : button} disabled={busy}
            onClick={go}>Unlock</button>
        </div>
        {error && <div style={{ color: S.error, fontSize: 13, marginTop: 8 }}>{error}</div>}
      </div>
    </div>
  );
}
