import React, { useEffect, useMemo, useState } from 'react';
import { S, font, mono, fmtUsd, jsonFetch, STATE_BADGE } from '../upload/shared';
import { apa, bibliography, citeFlags, cleanPub, mla, type BrowseEvent } from './cite';

/** The data browser — everything the backend store holds, strictly read-only.
 *
 * Published events are read from the exact file the last publish built the map from,
 * each row labelled baseline / batch-id / untracked. Exclusions keep their reasons,
 * rejected rows keep their problems, and nothing here can edit, delete or publish —
 * those actions live only in the per-batch review flow. Elian's rule throughout: real
 * provenance, absences stated, nothing prettified.
 */

type SectionKey = 'events' | 'batches' | 'exclusions' | 'rejected';

const box: React.CSSProperties = {
  background: S.panel, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16,
};
const ghost: React.CSSProperties = {
  padding: '4px 10px', fontSize: 12, fontWeight: 600, fontFamily: font, cursor: 'pointer',
  background: S.surface, color: S.accent, border: `1px solid ${S.borderStrong}`,
  borderRadius: 6,
};
const input: React.CSSProperties = {
  padding: '7px 9px', fontSize: 13, fontFamily: font, color: S.text,
  border: `1px solid ${S.borderStrong}`, borderRadius: 6, background: S.surface,
};
const th: React.CSSProperties = {
  textAlign: 'left', fontSize: 11, fontWeight: 700, color: S.muted, padding: '6px 8px',
  textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap',
  cursor: 'pointer', userSelect: 'none',
};
const td: React.CSSProperties = { fontSize: 12, padding: '6px 8px', verticalAlign: 'top' };

function download(name: string, text: string, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))]
    .join('\n');
}

function rowText(r: Record<string, unknown>): string {
  return Object.values(r)
    .map((v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)))
    .join(' ')
    .toLowerCase();
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button style={ghost} onClick={async () => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Sandboxed iframes can refuse the clipboard API; the fallback still works.
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    }}>{done ? 'Copied ✓' : label}</button>
  );
}

function CiteBox({ ev }: { ev: BrowseEvent }) {
  const m = mla(ev);
  const a = apa(ev);
  const flags = citeFlags(ev);
  return (
    <div style={{
      background: S.surface, border: `1px solid ${S.border}`, borderRadius: 6,
      padding: 10, marginTop: 6, fontSize: 12, lineHeight: 1.6,
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 11, color: S.muted, width: 44 }}>MLA 9</b>
        <span style={{ flex: '1 1 300px' }}>{m || '— nothing on record to cite —'}</span>
        {m && <CopyButton text={m} label="Copy" />}
      </div>
      <div style={{
        display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', marginTop: 6,
      }}>
        <b style={{ fontSize: 11, color: S.muted, width: 44 }}>APA 7</b>
        <span style={{ flex: '1 1 300px' }}>{a || '— nothing on record to cite —'}</span>
        {a && <CopyButton text={a} label="Copy" />}
      </div>
      {flags.length > 0 && (
        <div style={{ color: S.warn, marginTop: 6 }}>
          {flags.join(' · ')} — shown as stored, nothing filled in
        </div>
      )}
    </div>
  );
}

const EVENT_SORTS: Record<string, (e: BrowseEvent) => string> = {
  origin: (e) => e.origin,
  operator: (e) => (e.operator_normalized || e.operator || '').toLowerCase(),
  type: (e) => e.event_type || '',
  date: (e) => e.event_date || '',
  venue: (e) => (e.venue_name_as_written || e.institution || '').toLowerCase(),
};

export function DataTab() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [section, setSection] = useState<SectionKey>('events');
  const [filter, setFilter] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [sortAsc, setSortAsc] = useState(false);
  const [citing, setCiting] = useState<string | null>(null);

  const load = () =>
    jsonFetch('/api/admin/browse').then(setData).catch((e) => setError(String(e.message || e)));
  useEffect(() => { load(); }, []);

  const q = filter.trim().toLowerCase();

  const events: BrowseEvent[] = useMemo(() => {
    let rows: BrowseEvent[] = data?.events || [];
    if (q) rows = rows.filter((r) => rowText(r as any).includes(q));
    const key = EVENT_SORTS[sortBy] || EVENT_SORTS.date;
    rows = [...rows].sort((a, b) => key(a).localeCompare(key(b)) || a.event_id.localeCompare(b.event_id));
    if (!sortAsc) rows.reverse();
    return rows;
  }, [data, q, sortBy, sortAsc]);

  const filtered = useMemo(() => {
    const all: Record<SectionKey, Record<string, unknown>[]> = {
      events: events as any,
      batches: data?.batches || [],
      exclusions: data?.exclusions || [],
      rejected: data?.rejected || [],
    };
    if (!q) return all;
    return {
      ...all,
      batches: all.batches.filter((r) => rowText(r).includes(q)),
      exclusions: all.exclusions.filter((r) => rowText(r).includes(q)),
      rejected: all.rejected.filter((r) => rowText(r).includes(q)),
    };
  }, [data, events, q]);

  if (error) return <div style={{ color: S.error, padding: 20 }}>{error}</div>;
  if (!data) return <div style={{ color: S.muted, padding: 20 }}>Loading the store…</div>;

  const counts = data.counts || {};
  const sections: [SectionKey, string, number][] = [
    ['events', 'Published events', (data.events || []).length],
    ['batches', 'Batches', (data.batches || []).length],
    ['exclusions', 'Exclusions', (data.exclusions || []).length],
    ['rejected', 'Rejected', (data.rejected || []).length],
  ];

  const sortHeader = (label: string, key: string) => (
    <th style={th} onClick={() => {
      if (sortBy === key) setSortAsc(!sortAsc);
      else { setSortBy(key); setSortAsc(true); }
    }}>
      {label}{sortBy === key ? (sortAsc ? ' ↑' : ' ↓') : ''}
    </th>
  );

  const exportCsv = () => {
    const cols: Record<SectionKey, string[]> = {
      events: ['event_id', 'origin', 'operator', 'operator_normalized', 'event_type',
        'event_date', 'date_precision', 'venue_id', 'venue_name_as_written', 'institution',
        'needs_review', 'source_publication', 'source_date', 'source_title', 'source_file',
        'citation', 'notes'],
      batches: ['id', 'created_at', 'state', 'note', 'approved_content', 'published_at',
        'excluded', 'error'],
      exclusions: ['batch', 'event_id', 'reason', 'at', 'operator',
        'venue_name_as_written', 'event_type', 'event_date', 'source_title'],
      rejected: ['batch', 'kind', 'file', 'row', 'venue', 'operator', 'problems'],
    };
    download(`snzmap-${section}.csv`, toCsv(filtered[section], cols[section]), 'text/csv');
  };

  return (
    <div>
      <div style={{ ...box, marginBottom: 12, fontSize: 13, lineHeight: 1.7 }}>
        <b>{counts.events}</b> published events on the map's canonical file —{' '}
        <b>{counts.baseline}</b> baseline + <b>{counts.from_batches}</b> from published
        batches{counts.untracked > 0 && (
          <span style={{ color: S.error }}> + {counts.untracked} untracked (should not
            happen — tell Zo)</span>
        )}; {counts.mapped} name a spine venue. Read-only: publishing and excluding stay
        in the per-batch review flow.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {sections.map(([key, label, n]) => (
          <button key={key} onClick={() => setSection(key)}
            style={{ ...ghost, borderColor: section === key ? S.accent : S.border,
              background: section === key ? S.accentSoft : S.surface }}>
            {label} <b>{n}</b>
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <input style={{ ...input, width: 220 }} placeholder="Filter this table…"
          value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button style={ghost} onClick={exportCsv}>Export CSV</button>
        {section === 'events' && (
          <>
            <button style={ghost}
              onClick={() => download('snzmap-bibliography-mla.txt', bibliography(events, 'mla'))}>
              Bibliography (MLA)
            </button>
            <button style={ghost}
              onClick={() => download('snzmap-bibliography-apa.txt', bibliography(events, 'apa'))}>
              Bibliography (APA)
            </button>
          </>
        )}
      </div>

      {section === 'events' && (
        <div style={{ ...box, overflowX: 'auto', padding: 8 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr>
              {sortHeader('Origin', 'origin')}
              {sortHeader('Operator', 'operator')}
              {sortHeader('Type', 'type')}
              {sortHeader('Date', 'date')}
              {sortHeader('Venue / institution', 'venue')}
              <th style={{ ...th, cursor: 'default' }}>Source</th>
              <th style={{ ...th, cursor: 'default' }}>Cite</th>
            </tr></thead>
            <tbody>
              {events.map((e) => (
                <React.Fragment key={e.event_id}>
                  <tr style={{ borderTop: `1px solid ${S.border}` }}>
                    <td style={td}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '1px 8px',
                        color: e.origin === 'baseline' ? S.muted : e.origin === 'untracked' ? S.error : S.accent,
                        border: `1px solid ${e.origin === 'baseline' ? S.border : e.origin === 'untracked' ? S.error : S.accent}`,
                        whiteSpace: 'nowrap',
                      }}>{e.origin}</span>
                    </td>
                    <td style={{ ...td, fontWeight: 600 }}>
                      {e.operator_normalized || e.operator || '—'}
                      {e.sub_brand && <span style={{ color: S.muted }}> ({e.sub_brand})</span>}
                    </td>
                    <td style={{ ...td, color: S.accent, fontWeight: 700, textTransform: 'uppercase', fontSize: 11 }}>
                      {e.event_type}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {e.event_date || 'no date'}
                      {e.date_precision && <span style={{ color: S.muted }}> ({e.date_precision})</span>}
                    </td>
                    <td style={td}>
                      {e.venue_name_as_written || e.institution || '—'}
                      <div style={{ color: e.venue_id ? S.ok : S.muted, fontSize: 11 }}>
                        {e.venue_id ? `spine: ${e.venue_id}` : 'no spine venue'}
                        {e.needs_review && <span style={{ color: S.warn }}> · needs review</span>}
                      </div>
                    </td>
                    <td style={{ ...td, color: S.muted, maxWidth: 260 }}>
                      {[cleanPub(e.source_publication), e.source_date].filter(Boolean).join(' · ')}
                      <div style={{ fontSize: 11 }}>{e.source_title}</div>
                    </td>
                    <td style={td}>
                      <button style={ghost}
                        onClick={() => setCiting(citing === e.event_id ? null : e.event_id)}>
                        {citing === e.event_id ? 'Close' : 'Cite'}
                      </button>
                    </td>
                  </tr>
                  {citing === e.event_id && (
                    <tr><td style={{ ...td, paddingTop: 0 }} colSpan={7}><CiteBox ev={e} /></td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {events.length === 0 && (
            <div style={{ color: S.muted, fontSize: 13, padding: 12 }}>
              Nothing matches “{filter}”.
            </div>
          )}
        </div>
      )}

      {section === 'batches' && (
        <div style={{ ...box, padding: 8 }}>
          {(filtered.batches as any[]).map((b) => (
            <div key={b.id} style={{
              borderTop: `1px solid ${S.border}`, padding: '8px 6px', fontSize: 13,
              display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline',
            }}>
              <b>{b.id}</b>
              <span style={{
                fontSize: 11, fontWeight: 700,
                color: (STATE_BADGE[b.state] || { color: S.muted }).color,
              }}>{(STATE_BADGE[b.state] || { label: b.state }).label}</span>
              <span style={{ color: S.muted, fontSize: 12 }}>
                {b.parse ? `${b.parse.articles} articles` : ''}
                {b.quote?.estimate_usd != null ? ` · quoted ${fmtUsd(b.quote.estimate_usd)}` : ''}
                {b.extract?.billed_usd != null
                  ? ` · billed ${fmtUsd(b.extract.billed_usd)} for ${b.extract.billed_articles} article${b.extract.billed_articles === 1 ? '' : 's'}`
                  : ' · nothing billed'}
                {b.extract?.events != null ? ` · ${b.extract.events} events` : ''}
                {b.excluded ? ` · ${b.excluded} excluded` : ''}
                {b.published_at ? ` · published ${b.published_at}` : ''}
              </span>
              {b.note && <span style={{ color: S.muted, fontSize: 12 }}>“{b.note}”</span>}
              {b.error && <span style={{ color: S.error, fontSize: 12, fontFamily: mono }}>{b.error}</span>}
            </div>
          ))}
          {(filtered.batches as any[]).length === 0 && (
            <div style={{ color: S.muted, fontSize: 13, padding: 12 }}>
              No batches yet — they appear when Yash drops something on his link.
            </div>
          )}
        </div>
      )}

      {section === 'exclusions' && (
        <div style={{ ...box, padding: 8 }}>
          <div style={{ color: S.muted, fontSize: 12, padding: '4px 6px 8px' }}>
            Rows Katey excluded at Gate 2 — tagged with her reason and kept in the batch
            files, never deleted.
          </div>
          {(filtered.exclusions as any[]).map((x, i) => (
            <div key={`${x.batch}-${x.event_id}-${i}`} style={{
              borderTop: `1px solid ${S.border}`, padding: '8px 6px', fontSize: 13,
            }}>
              <b>{x.operator || x.event_id}</b>
              {x.event_type && <span style={{ color: S.accent, fontSize: 11, fontWeight: 700, marginLeft: 8, textTransform: 'uppercase' }}>{x.event_type}</span>}
              {x.venue_name_as_written && <span style={{ marginLeft: 8 }}>{x.venue_name_as_written}</span>}
              {x.event_date && <span style={{ color: S.muted, marginLeft: 8 }}>{x.event_date}</span>}
              <div style={{ color: S.error, fontSize: 12, marginTop: 2 }}>
                excluded: {x.reason || 'no reason recorded'}
              </div>
              <div style={{ color: S.muted, fontSize: 11 }}>
                batch {x.batch} · {x.at} · <span style={{ fontFamily: mono }}>{x.event_id}</span>
              </div>
            </div>
          ))}
          {(filtered.exclusions as any[]).length === 0 && (
            <div style={{ color: S.muted, fontSize: 13, padding: 12 }}>
              No reviewer exclusions on record.
            </div>
          )}
        </div>
      )}

      {section === 'rejected' && (
        <div style={{ ...box, padding: 8 }}>
          <div style={{ color: S.muted, fontSize: 12, padding: '4px 6px 8px' }}>
            Rows that failed schema validation — kept and browsable, never publishable,
            never silently dropped.
          </div>
          {(filtered.rejected as any[]).map((r, i) => (
            <div key={i} style={{
              borderTop: `1px solid ${S.border}`, padding: '8px 6px', fontSize: 12,
            }}>
              <b>{r.kind === 'csv' ? `${r.file} row ${r.row}` : 'extraction'}</b>
              {r.venue && <span style={{ marginLeft: 8 }}>{r.venue}</span>}
              {r.operator && <span style={{ color: S.muted, marginLeft: 8 }}>{r.operator}</span>}
              <div style={{ color: S.warn, marginTop: 2 }}>
                {(r.problems || []).join('; ') || 'no problem recorded'}
              </div>
              <div style={{ color: S.muted, fontSize: 11 }}>batch {r.batch}</div>
            </div>
          ))}
          {(filtered.rejected as any[]).length === 0 && (
            <div style={{ color: S.muted, fontSize: 13, padding: 12 }}>
              No schema rejections on record.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
