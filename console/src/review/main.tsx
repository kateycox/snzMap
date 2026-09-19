import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { S, font, mono, fmtUsd, fmtPct, jsonFetch, STATE_BADGE, OUTCOME_BADGE } from '../upload/shared';

/** Katey's page — both gates live here.
 * Gate 1 (spend): the exact quote, then Approve & extract.
 * Gate 2 (content): every extracted/mapped row, excludable with a reason (kept, never
 * deleted), then Publish — committed baseline + approved batches, never anything else. */

const box: React.CSSProperties = {
  background: S.panel, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16,
};
const button: React.CSSProperties = {
  padding: '8px 14px', fontSize: 13, fontWeight: 600, fontFamily: font, cursor: 'pointer',
  background: S.accent, color: '#fff', border: 'none', borderRadius: 6,
};
const ghost: React.CSSProperties = {
  ...button, background: S.surface, color: S.accent, border: `1px solid ${S.borderStrong}`,
};
const danger: React.CSSProperties = { ...ghost, color: S.error, borderColor: S.error };
const input: React.CSSProperties = {
  padding: '7px 9px', fontSize: 13, fontFamily: font, color: S.text,
  border: `1px solid ${S.borderStrong}`, borderRadius: 6, background: S.surface,
};

function StateBadge({ state }: { state: string }) {
  const b = STATE_BADGE[state] || { label: state, color: S.muted };
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, color: b.color, border: `1.5px solid ${b.color}`,
      borderRadius: 999, padding: '2px 10px', whiteSpace: 'nowrap',
    }}>{b.label}</span>
  );
}

function Login({ onIn }: { onIn: () => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setError('');
    try {
      await jsonFetch('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: pw }) });
      onIn();
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ maxWidth: 360, margin: '18vh auto 0' }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: S.heading }}>SNZ Map — review queue</div>
      <div style={{ fontSize: 13, color: S.muted, margin: '6px 0 16px' }}>
        Admin password. Entered once per session.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input style={{ ...input, flex: 1 }} type="password" value={pw} autoFocus
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()} />
        <button style={busy ? { ...button, opacity: 0.6 } : button} disabled={busy} onClick={go}>
          Enter
        </button>
      </div>
      {error && <div style={{ color: S.error, fontSize: 13, marginTop: 8 }}>{error}</div>}
    </div>
  );
}

function EventRow({ ev, snippet, excluded, onExclude, onUndo }: {
  ev: any; snippet?: string; excluded?: { reason: string };
  onExclude: (id: string, reason: string) => void; onUndo: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(false);
  return (
    <div style={{
      borderTop: `1px solid ${S.border}`, padding: '8px 4px',
      opacity: excluded ? 0.55 : 1,
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 13 }}>{ev.operator_normalized || ev.operator}</b>
        <span style={{
          fontSize: 11, fontWeight: 700, color: S.accent, textTransform: 'uppercase',
        }}>{ev.event_type}</span>
        <span style={{ fontSize: 12 }}>{ev.event_date || 'no date'}
          <span style={{ color: S.muted }}> ({ev.date_precision})</span></span>
        <span style={{ fontSize: 12, color: ev.venue_id ? S.ok : S.muted }}>
          {ev.venue_id ? `spine: ${ev.venue_id}` : 'no spine venue'}
        </span>
        <span style={{ fontSize: 12, color: S.muted }}>"{ev.venue_name_as_written}"</span>
        {ev.needs_review && (
          <span style={{ fontSize: 11, fontWeight: 700, color: S.warn }}>needs review</span>
        )}
        <span style={{ flex: 1 }} />
        <button style={{ ...ghost, padding: '2px 8px', fontSize: 11 }}
          onClick={() => setOpen(!open)}>{open ? 'less' : 'more'}</button>
        {excluded ? (
          <button style={{ ...ghost, padding: '2px 8px', fontSize: 11 }}
            onClick={() => onUndo(ev.event_id)}>re-include</button>
        ) : (
          <button style={{ ...danger, padding: '2px 8px', fontSize: 11 }}
            onClick={() => setAsking(!asking)}>exclude</button>
        )}
      </div>
      {excluded && (
        <div style={{ fontSize: 12, color: S.error, marginTop: 4 }}>
          excluded by reviewer: {excluded.reason}
        </div>
      )}
      {asking && !excluded && (
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <input style={{ ...input, flex: 1 }} placeholder="Why? (kept with the row, never deleted)"
            value={reason} autoFocus onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && reason.trim()) {
                onExclude(ev.event_id, reason.trim()); setAsking(false);
              }
            }} />
          <button style={{ ...danger, padding: '4px 10px', fontSize: 12 }}
            disabled={!reason.trim()}
            onClick={() => { onExclude(ev.event_id, reason.trim()); setAsking(false); }}>
            Exclude
          </button>
        </div>
      )}
      {open && (
        <div style={{ fontSize: 12, color: S.text, marginTop: 6, lineHeight: 1.6 }}>
          {snippet && (
            <div style={{
              background: S.surface, border: `1px solid ${S.border}`, borderRadius: 6,
              padding: 8, fontStyle: 'italic',
            }}>“{snippet}”</div>
          )}
          <div style={{ color: S.muted, marginTop: 4 }}>
            source: {ev.source_publication} · {ev.source_date} · {ev.source_title}
            <br />confidence {ev.extraction_confidence} · {ev.notes || 'no notes'}
            <br /><span style={{ fontFamily: mono }}>{ev.event_id}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function BatchDetail({ id, onBack, onChanged }: {
  id: string; onBack: () => void; onChanged: () => void;
}) {
  const [d, setD] = useState<any>(null);
  const [log, setLog] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [publishResult, setPublishResult] = useState<any>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const dRef = useRef<any>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await jsonFetch(`/api/admin/batches/${id}`);
      setD(data);
      if (data.batch.state === 'extracting') {
        const l = await jsonFetch(`/api/admin/batches/${id}/log`);
        setLog(l.log || '');
      }
    } catch (e: any) {
      setError(String(e.message || e));
    }
  }, [id]);

  useEffect(() => {
    refresh();
    timer.current = setInterval(async () => {
      const state = (dRef.current as any)?.batch?.state;
      if (state === 'extracting' || state === 'ingesting') await refresh();
    }, 3000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [refresh]);

  dRef.current = d;

  if (error) return <div style={{ color: S.error, padding: 20 }}>{error}</div>;
  if (!d) return <div style={{ color: S.muted, padding: 20 }}>Loading…</div>;

  const b = d.batch;
  const quote = b.quote || {};
  const excludedMap: Record<string, { reason: string }> = {};
  for (const x of b.excluded_by_reviewer || []) excludedMap[x.event_id] = x;
  const events = [...(d.events_articles || []), ...(d.events_tabular || [])];
  const keptCount = events.filter((e) => !excludedMap[e.event_id]).length;

  async function act(name: string, fn: () => Promise<any>) {
    setBusy(name); setError('');
    try {
      await fn();
      await refresh();
      onChanged();
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setBusy('');
    }
  }

  const exclude = (event_id: string, reason: string) =>
    act('exclude', () => jsonFetch(`/api/admin/batches/${id}/exclude`, {
      method: 'POST', body: JSON.stringify({ event_id, reason }),
    }));
  const undo = (event_id: string) =>
    act('exclude', () => jsonFetch(`/api/admin/batches/${id}/exclude`, {
      method: 'POST', body: JSON.stringify({ event_id, undo: true }),
    }));

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <button style={ghost} onClick={onBack}>← all batches</button>
        <div style={{ fontSize: 16, fontWeight: 800, color: S.heading }}>Batch {b.id}</div>
        <StateBadge state={b.state} />
        {b.note && <span style={{ fontSize: 13, color: S.muted }}>“{b.note}”</span>}
      </div>

      {b.error && (
        <div style={{ ...box, borderLeft: `4px solid ${S.error}`, marginBottom: 12 }}>
          <b style={{ color: S.error }}>Failed:</b>{' '}
          <span style={{ fontFamily: mono, fontSize: 12 }}>{b.error}</span>
        </div>
      )}

      {b.parse && (
        <div style={{ ...box, marginBottom: 12, fontSize: 13, lineHeight: 1.7 }}>
          <b>{b.parse.articles}</b> articles parsed · <b>{b.parse.usable}</b> usable ·
          body share <b>{fmtPct(b.parse.body_share)}</b>
          {(b.files || []).length > 0 && (
            <div style={{ fontSize: 12, color: S.muted, marginTop: 4 }}>
              {(b.files || []).map((f: any, i: number) => (
                <span key={i} style={{ marginRight: 12 }}>
                  {f.name} <i>({f.kind}{f.note ? ` — ${f.note}` : ''})</i>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Gate 1 — spend */}
      {b.state === 'quoted' && quote.billable > 0 && (
        <div style={{ ...box, borderLeft: `4px solid ${S.accent}`, marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: S.heading }}>
            Gate 1 — approve the spend
          </div>
          <div style={{ fontSize: 13, margin: '6px 0 10px', lineHeight: 1.6 }}>
            {quote.billable} article{quote.billable === 1 ? '' : 's'} would be sent to the
            extractor for about <b>{fmtUsd(quote.estimate_usd)}</b>{' '}
            <span style={{ color: S.muted }}>
              ({fmtUsd(quote.rate_per_article)}/article, measured over the last{' '}
              {quote.rate_basis_articles}-article run — an estimate, not a bill)
            </span>.
            {quote.already_cached > 0 && <> {quote.already_cached} already paid for (cached, free).</>}
          </div>
          <button style={busy ? { ...button, opacity: 0.6 } : button} disabled={!!busy}
            onClick={() => act('approve', () =>
              jsonFetch(`/api/admin/batches/${id}/approve`, { method: 'POST' }))}>
            Approve & extract (~{fmtUsd(quote.estimate_usd)})
          </button>
        </div>
      )}
      {b.state === 'quoted' && quote.billable === 0 && (d.events_tabular || []).length === 0
        && (b.parse?.articles || 0) > 0 && (
        <div style={{ ...box, marginBottom: 12, fontSize: 13 }}>
          Everything in this batch is already extracted (cached) — approving costs nothing.
          <div style={{ marginTop: 8 }}>
            <button style={button} disabled={!!busy}
              onClick={() => act('approve', () =>
                jsonFetch(`/api/admin/batches/${id}/approve`, { method: 'POST' }))}>
              Run extraction (free — all cached)
            </button>
          </div>
        </div>
      )}

      {b.state === 'extracting' && (
        <div style={{ ...box, borderLeft: `4px solid ${S.warn}`, marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: S.heading }}>Extracting…</div>
          <div style={{ fontSize: 12, color: S.muted, margin: '4px 0 8px' }}>
            Runs in the background at about 10 seconds per article. This page refreshes itself.
          </div>
          {log && (
            <pre style={{
              fontFamily: mono, fontSize: 11, background: S.surface, borderRadius: 6,
              border: `1px solid ${S.border}`, padding: 8, maxHeight: 180, overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}>{log}</pre>
          )}
        </div>
      )}

      {b.extract?.finished_at && (
        <div style={{ ...box, marginBottom: 12, fontSize: 13, lineHeight: 1.7 }}>
          Extraction: <b>{b.extract.events}</b> events ({b.extract.venue_matched} name a spine
          venue, {b.extract.needs_review} flagged for review), {b.extract.rejected} rejected —
          billed <b>{b.extract.billed_articles}</b> article{b.extract.billed_articles === 1 ? '' : 's'},{' '}
          <b>{fmtUsd(b.extract.billed_usd)}</b>
          {b.extract.cache_hits > 0 && <> · {b.extract.cache_hits} cache hits (free)</>}
          {b.extract.failed > 0 && (
            <span style={{ color: S.error }}> · {b.extract.failed} calls failed</span>
          )}
        </div>
      )}

      {/* Gate 2 — content */}
      {events.length > 0 && (
        <div style={{ ...box, marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: S.heading, marginBottom: 4 }}>
            Gate 2 — review the rows ({keptCount} of {events.length} will publish)
          </div>
          <div style={{ fontSize: 12, color: S.muted, marginBottom: 8 }}>
            Excluding tags the row with your reason and keeps it in the batch file — nothing
            is deleted.
          </div>
          {events.map((ev: any) => (
            <EventRow key={ev.event_id} ev={ev} snippet={d.snippets?.[ev.event_id]}
              excluded={excludedMap[ev.event_id]} onExclude={exclude} onUndo={undo} />
          ))}
        </div>
      )}

      {(d.rejected || []).length > 0 && (
        <div style={{ ...box, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: S.heading }}>
            Rejected by the schema ({d.rejected.length}) — kept, visible, not publishable
          </div>
          {d.rejected.slice(0, 50).map((r: any, i: number) => (
            <div key={i} style={{
              fontSize: 12, color: S.muted, borderTop: `1px solid ${S.border}`,
              padding: '6px 0',
            }}>
              {(r.problems || []).join('; ')}
            </div>
          ))}
        </div>
      )}

      {Object.keys(d.tabular_results || {}).length > 0 && (
        <div style={{ ...box, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: S.heading, marginBottom: 6 }}>
            Spreadsheet rows
          </div>
          {Object.entries(d.tabular_results).map(([name, t]: any) => (
            <div key={name} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
              <div style={{ fontSize: 12, color: S.muted, margin: '2px 0 6px' }}>
                {Object.entries(t.counts).map(([k, v]) =>
                  `${OUTCOME_BADGE[k]?.label || k}: ${v}`).join(' · ')}
              </div>
              <div style={{ maxHeight: 220, overflow: 'auto' }}>
                {t.results.filter((r: any) => r.outcome !== 'matched').slice(0, 100)
                  .map((r: any) => (
                    <div key={r.row} style={{
                      fontSize: 12, borderTop: `1px solid ${S.border}`, padding: '4px 0',
                    }}>
                      row {r.row}: <b>{r.venue}</b> / {r.operator} —{' '}
                      <span style={{ color: OUTCOME_BADGE[r.outcome]?.color || S.muted }}>
                        {OUTCOME_BADGE[r.outcome]?.label || r.outcome}</span>{' '}
                      <span style={{ color: S.muted }}>({r.reason})</span>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {publishResult && (
        <div style={{ ...box, borderLeft: `4px solid ${S.ok}`, marginBottom: 12, fontSize: 13, lineHeight: 1.7 }}>
          <b style={{ color: S.ok }}>Published.</b> The map now carries{' '}
          <b>{publishResult.merged_events}</b> events —{' '}
          {publishResult.baseline_events} from the committed baseline plus{' '}
          {publishResult.merged_events - publishResult.baseline_events} from approved
          batches → {publishResult.tenure_features} operator runs and{' '}
          {publishResult.event_features} event pins on the map.{' '}
          <a href="/console" target="_blank" rel="noreferrer"
            style={{ color: S.accent }}>Open the console ↗</a>
          <div style={{ color: S.muted, fontSize: 12, marginTop: 4 }}>
            Untouched, on purpose: venues, federal, ACS and the audit figure.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 40 }}>
        {(b.state === 'extracted' || b.state === 'published'
          || (b.state === 'quoted' && (d.events_tabular || []).length > 0)) && (
          <button style={busy ? { ...button, opacity: 0.6 } : button} disabled={!!busy}
            onClick={() => act('publish', async () => {
              setPublishResult(await jsonFetch(`/api/admin/batches/${id}/publish`,
                { method: 'POST' }));
            })}>
            {busy === 'publish' ? 'Publishing…'
              : b.state === 'published' ? 'Re-publish (free)' : `Publish ${keptCount} rows to the map (free)`}
          </button>
        )}
        {b.state !== 'published' && b.state !== 'discarded' && (
          <button style={danger} disabled={!!busy}
            onClick={() => act('discard', () =>
              jsonFetch(`/api/admin/batches/${id}/discard`, { method: 'POST' }))}>
            Discard batch
          </button>
        )}
      </div>
    </div>
  );
}

function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [batches, setBatches] = useState<any[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setBatches(await jsonFetch('/api/admin/batches'));
    } catch (e: any) {
      setError(String(e.message || e));
    }
  }, []);

  useEffect(() => {
    jsonFetch('/api/admin/session')
      .then((r) => setAuthed(!!r.ok))
      .catch(() => setAuthed(false));
  }, []);

  useEffect(() => { if (authed) load(); }, [authed, load]);

  if (authed === null) return null;
  if (!authed) {
    return (
      <div style={{ fontFamily: font, color: S.text, background: S.surface, minHeight: '100vh' }}>
        <Login onIn={() => setAuthed(true)} />
      </div>
    );
  }

  return (
    <div style={{
      fontFamily: font, color: S.text, background: S.surface, minHeight: '100vh',
      padding: '32px 16px',
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {!open && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: S.heading }}>
                SNZ Map — review queue
              </div>
              <a href="/console" style={{ fontSize: 13, color: S.accent }}>console ↗</a>
            </div>
            <div style={{ fontSize: 13, color: S.muted, margin: '6px 0 18px' }}>
              Two gates, both yours: approve the spend, then approve the content. The map
              only changes when you hit Publish.
            </div>
            {error && <div style={{ color: S.error, fontSize: 13 }}>{error}</div>}
            {batches.length === 0 && (
              <div style={{ ...box, color: S.muted, fontSize: 13 }}>
                No batches yet. When Yash drops something on his upload link it appears here.
              </div>
            )}
            {batches.map((b) => (
              <div key={b.id} onClick={() => setOpen(b.id)}
                style={{
                  ...box, marginBottom: 8, cursor: 'pointer', display: 'flex', gap: 12,
                  alignItems: 'center', flexWrap: 'wrap',
                }}>
                <b style={{ fontSize: 13 }}>{b.id}</b>
                <StateBadge state={b.state} />
                <span style={{ fontSize: 12, color: S.muted }}>
                  {b.parse ? `${b.parse.articles} articles (${b.parse.usable} usable)` : ''}
                  {b.files ? ` · ${b.files} file(s)` : ''}
                  {b.quote?.billable > 0 && b.quote?.estimate_usd != null
                    ? ` · quote ${fmtUsd(b.quote.estimate_usd)}` : ''}
                  {b.extract?.events != null ? ` · ${b.extract.events} events` : ''}
                  {b.excluded ? ` · ${b.excluded} excluded` : ''}
                </span>
                {b.note && <span style={{ fontSize: 12, color: S.muted }}>“{b.note}”</span>}
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: S.muted }}>{b.created_at}</span>
              </div>
            ))}
          </>
        )}
        {open && (
          <BatchDetail id={open} onBack={() => { setOpen(null); load(); }} onChanged={load} />
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
