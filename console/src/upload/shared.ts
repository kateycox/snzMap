/** Shared bits for the two queue pages. Tokens copied from theme.ts — these pages are
 * separate Vite entries and deliberately import nothing from the map bundle. */

export const S = {
  surface: '#ffffff',
  panel: '#f8fafc',
  text: '#0f172a',
  heading: '#1e293b',
  muted: '#475569',
  border: '#e2e8f0',
  borderStrong: '#64748b',
  accent: '#0369a1',
  accentSoft: '#e0f2fe',
  error: '#b91c1c',
  ok: '#15803d',
  warn: '#b45309',
};

export const font =
  'ui-sans-serif, system-ui, -apple-system, sans-serif';

export const mono =
  'ui-monospace, SFMono-Regular, Menlo, monospace';

export function fmtUsd(v: number | null | undefined): string {
  return v == null ? '—' : `$${v.toFixed(2)}`;
}

export function fmtPct(v: number | null | undefined): string {
  return v == null ? '—' : `${(v * 100).toFixed(1)}%`;
}

export async function jsonFetch(url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, {
    headers: { Accept: 'application/json', ...(init?.body && typeof init.body === 'string'
      ? { 'Content-Type': 'application/json' } : {}) },
    ...init,
  });
  let data: any = null;
  try {
    data = await r.json();
  } catch {
    throw new Error(`${url}: HTTP ${r.status} (not JSON)`);
  }
  if (!r.ok) throw new Error(data?.error || `${url}: HTTP ${r.status}`);
  return data;
}

/** Outcome/state → color + label, one vocabulary across both pages. */
export const STATE_BADGE: Record<string, { label: string; color: string }> = {
  new: { label: 'new', color: S.muted },
  ingesting: { label: 'parsing…', color: S.warn },
  quoted: { label: 'waiting for Katey', color: S.accent },
  extracting: { label: 'extracting…', color: S.warn },
  extracted: { label: 'ready to review', color: S.accent },
  published: { label: 'on the map', color: S.ok },
  failed: { label: 'failed', color: S.error },
  discarded: { label: 'discarded', color: S.muted },
  corrupt: { label: 'corrupt', color: S.error },
};

export const OUTCOME_BADGE: Record<string, { label: string; color: string }> = {
  matched: { label: 'matched', color: S.ok },
  ambiguous: { label: 'ambiguous', color: S.warn },
  no_spine_match: { label: 'off this map', color: S.muted },
  not_corroborated: { label: 'not corroborated', color: S.warn },
  rejected: { label: 'rejected', color: S.error },
};
