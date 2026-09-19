import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { S, font, mono, fmtUsd, fmtPct, jsonFetch, OUTCOME_BADGE } from '../upload/shared';
import { UnlockScreen, useUnlock } from '../upload/Unlock';

/** The upload page. Everything here is free: files are parsed, OCR'd if scanned, and
 * priced — never extracted. The page cannot spend money — the server routes it talks to
 * never hold the API key. One passphrase (shared with /review) unlocks it per device. */

type Pasted = {
  title: string; publication: string; date: string;
  author: string; url: string; text: string;
};

const EVENT_TYPES = ['won', 'lost', 'renewed', 'expired', 'self_op', 'strike', 'violation', 'initiative'];

const box: React.CSSProperties = {
  background: S.panel, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16,
};
const label: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: S.heading, marginBottom: 4,
};
const input: React.CSSProperties = {
  width: '100%', padding: '7px 9px', fontSize: 13, fontFamily: font, color: S.text,
  border: `1px solid ${S.borderStrong}`, borderRadius: 6, background: S.surface,
};
const button: React.CSSProperties = {
  padding: '9px 16px', fontSize: 13, fontWeight: 600, fontFamily: font, cursor: 'pointer',
  background: S.accent, color: '#fff', border: 'none', borderRadius: 6,
};
const ghostButton: React.CSSProperties = {
  ...button, background: S.surface, color: S.accent, border: `1px solid ${S.borderStrong}`,
};

function Badge({ kind }: { kind: string }) {
  const b = OUTCOME_BADGE[kind] || { label: kind, color: S.muted };
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, color: b.color, border: `1px solid ${b.color}`,
      borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap',
    }}>{b.label}</span>
  );
}

function TableMapper({ batchId, file, inspect, onMapped }: {
  batchId: string; file: string;
  inspect: { headers: string[]; sample_rows: string[][]; total_rows: number };
  onMapped: (r: any) => void;
}) {
  const [m, setM] = useState<Record<string, string>>({
    venue_col: '', operator_col: '', date_col: '', event_type_col: '', state_col: '',
    author_col: '', url_col: '',
    default_event_type: '', source_citation: '', source_date: new Date().toISOString().slice(0, 10),
    dataset_title: '', source_url: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);
  const [showRows, setShowRows] = useState<string | null>(null);

  const colSelect = (key: string, required = false) => (
    <select
      style={{ ...input, width: 'auto', minWidth: 160 }}
      value={m[key]}
      onChange={(e) => setM({ ...m, [key]: e.target.value })}
    >
      <option value="">{required ? '— pick a column —' : '— none —'}</option>
      {inspect.headers.map((h) => <option key={h} value={h}>{h}</option>)}
    </select>
  );

  async function run() {
    setBusy(true); setError('');
    try {
      const mapping: Record<string, string> = {};
      for (const [k, v] of Object.entries(m)) if (v) mapping[k] = v;
      const r = await jsonFetch(`/api/upload/${batchId}/map`, {
        method: 'POST', body: JSON.stringify({ file, mapping }),
      });
      setResult(r);
      onMapped(r);
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  const rows = result?.results || [];
  const shown = showRows ? rows.filter((r: any) => r.outcome === showRows) : rows;

  return (
    <div style={{ ...box, marginTop: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: S.heading }}>
        Spreadsheet: {file} <span style={{ color: S.muted, fontWeight: 400 }}>
          ({inspect.total_rows} rows)</span>
      </div>
      <div style={{ fontSize: 12, color: S.muted, margin: '6px 0 12px' }}>
        Tell the pipeline which column is which. No AI reads this — mapping is exact, free,
        and you can re-run it as many times as you like. A row joins the map only when the
        venue name <em>and</em> a second fact (state or year) both match.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <div><span style={label}>Venue column (required)</span>{colSelect('venue_col', true)}</div>
        <div><span style={label}>Operator column (required)</span>{colSelect('operator_col', true)}</div>
        <div><span style={label}>Date / year column</span>{colSelect('date_col')}</div>
        <div><span style={label}>State column</span>{colSelect('state_col')}</div>
        <div><span style={label}>Event-type column</span>{colSelect('event_type_col')}</div>
        <div><span style={label}>Author column (optional)</span>{colSelect('author_col')}</div>
        <div><span style={label}>URL column (optional)</span>{colSelect('url_col')}</div>
        <div>
          <span style={label}>…or one event type for every row</span>
          <select style={{ ...input, width: 'auto' }} value={m.default_event_type}
            onChange={(e) => setM({ ...m, default_event_type: e.target.value })}>
            <option value="">— pick —</option>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
        <div style={{ flex: '1 1 340px' }}>
          <span style={label}>Where is this data from? (required — becomes every row's source)</span>
          <input style={input} placeholder="e.g. VenuesNow concession survey 2019, collected by Yash"
            value={m.source_citation}
            onChange={(e) => setM({ ...m, source_citation: e.target.value })} />
        </div>
        <div>
          <span style={label}>Source date</span>
          <input style={{ ...input, width: 140 }} value={m.source_date}
            onChange={(e) => setM({ ...m, source_date: e.target.value })} />
        </div>
        <div>
          <span style={label}>Dataset title (optional)</span>
          <input style={{ ...input, width: 220 }} value={m.dataset_title}
            onChange={(e) => setM({ ...m, dataset_title: e.target.value })} />
        </div>
        <div style={{ flex: '1 1 280px' }}>
          <span style={label}>Dataset URL (optional — used when no URL column is mapped)</span>
          <input style={input} placeholder="https://…"
            value={m.source_url} onChange={(e) => setM({ ...m, source_url: e.target.value })} />
        </div>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
        <button style={busy ? { ...button, opacity: 0.6 } : button} disabled={busy} onClick={run}>
          {busy ? 'Checking…' : result ? 'Re-run mapping' : 'Check the mapping (free)'}
        </button>
        {error && <span style={{ color: S.error, fontSize: 12 }}>{error}</span>}
      </div>

      {result && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(result.counts).map(([k, v]) => (
              <button key={k} onClick={() => setShowRows(showRows === k ? null : k)}
                style={{
                  ...ghostButton, padding: '4px 10px', fontSize: 12,
                  borderColor: showRows === k ? S.accent : S.border,
                }}>
                {OUTCOME_BADGE[k]?.label || k}: <b>{v as number}</b>
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: S.muted, marginTop: 6 }}>
            Every row is kept and tagged — nothing is silently dropped. Click a count to browse.
          </div>
          <div style={{ maxHeight: 300, overflow: 'auto', marginTop: 8 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
              <tbody>
                {shown.slice(0, 200).map((r: any) => (
                  <tr key={r.row} style={{ borderTop: `1px solid ${S.border}` }}>
                    <td style={{ padding: '4px 6px', color: S.muted }}>row {r.row}</td>
                    <td style={{ padding: '4px 6px' }}><Badge kind={r.outcome} /></td>
                    <td style={{ padding: '4px 6px', fontWeight: 600 }}>{r.venue}</td>
                    <td style={{ padding: '4px 6px' }}>{r.operator}</td>
                    <td style={{ padding: '4px 6px', color: S.muted }}>
                      {r.outcome === 'matched'
                        ? `→ ${r.venue_matched} (${(r.gates || []).join('+')})`
                        : r.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState<Pasted[]>([]);
  const emptyPaste: Pasted = { title: '', publication: '', date: '', author: '', url: '', text: '' };
  const [paste, setPaste] = useState<Pasted>(emptyPaste);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [batch, setBatch] = useState<any>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const tables = useMemo(
    () => Object.entries(batch?.tables || {}).filter(([, t]: any) => t.inspect),
    [batch],
  );

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((cur) => [...cur, ...Array.from(list)]);
  }

  function addPaste() {
    if (!paste.text.trim()) return;
    setPasted((cur) => [...cur, paste]);
    setPaste(emptyPaste);
  }

  async function submit() {
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      if (pasted.length) fd.append('pasted', JSON.stringify(pasted));
      if (note) fd.append('note', note);
      const r = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      setBatch(data);
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  const quote = batch?.quote;
  const parse = batch?.parse;

  return (
    <div style={{
      fontFamily: font, color: S.text, background: S.surface, minHeight: '100vh',
      padding: '32px 16px',
    }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: S.heading }}>
            SNZ Map — add research
          </div>
          <a href="/console" style={{ fontSize: 13, color: S.accent }}>← back to map</a>
        </div>
        <div style={{ fontSize: 13, color: S.muted, margin: '6px 0 20px', lineHeight: 1.5 }}>
          Drop article exports (<code style={{ fontFamily: mono }}>.txt .html .rtf .pdf .docx</code>),
          scans (<code style={{ fontFamily: mono }}>.png .jpg .tif .webp</code> or scanned PDFs),
          spreadsheets (<code style={{ fontFamily: mono }}>.csv .xlsx</code>), or paste article
          text. Everything on this page is <b>free</b>: files are parsed — scans go through
          local OCR — and priced, and then the batch waits for Katey to approve the paid
          extraction step. Nothing you do here spends money or changes the live map.
        </div>

        {!batch && (
          <>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
              onClick={() => fileRef.current?.click()}
              style={{
                ...box, textAlign: 'center', padding: 36, cursor: 'pointer',
                borderStyle: 'dashed', borderColor: dragOver ? S.accent : S.borderStrong,
                background: dragOver ? S.accentSoft : S.panel,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: S.heading }}>
                Drop files here, or click to choose
              </div>
              <div style={{ fontSize: 12, color: S.muted, marginTop: 4 }}>
                Scanned pages are welcome — they're stored and read by local OCR. A scan the
                OCR can't read is kept and listed, never turned away.
              </div>
              <input ref={fileRef} type="file" multiple style={{ display: 'none' }}
                onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            </div>

            {files.length > 0 && (
              <div style={{ ...box, marginTop: 12 }}>
                {files.map((f, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', fontSize: 13,
                    padding: '3px 0',
                  }}>
                    <span>{f.name} <span style={{ color: S.muted }}>
                      ({(f.size / 1024).toFixed(0)} KB)</span></span>
                    <button style={{ ...ghostButton, padding: '1px 8px', fontSize: 12 }}
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}>remove</button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ ...box, marginTop: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: S.heading, marginBottom: 8 }}>
                Or paste article text
              </div>
              <div style={{ fontSize: 12, color: S.muted, marginBottom: 10 }}>
                Title, publication and date are typed by you and recorded exactly as typed —
                the pipeline never guesses provenance.
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                <input style={{ ...input, flex: '2 1 240px' }} placeholder="Headline"
                  value={paste.title} onChange={(e) => setPaste({ ...paste, title: e.target.value })} />
                <input style={{ ...input, flex: '1 1 160px' }} placeholder="Publication"
                  value={paste.publication}
                  onChange={(e) => setPaste({ ...paste, publication: e.target.value })} />
                <input style={{ ...input, flex: '0 1 150px' }} placeholder="Date (e.g. June 4, 2013)"
                  value={paste.date} onChange={(e) => setPaste({ ...paste, date: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                <input style={{ ...input, flex: '1 1 200px' }}
                  placeholder="Author (optional, e.g. Reilly, M.)"
                  value={paste.author}
                  onChange={(e) => setPaste({ ...paste, author: e.target.value })} />
                <input style={{ ...input, flex: '2 1 280px' }}
                  placeholder="URL (optional — where this article lives)"
                  value={paste.url} onChange={(e) => setPaste({ ...paste, url: e.target.value })} />
              </div>
              <textarea style={{ ...input, minHeight: 120, fontFamily: font }}
                placeholder="Paste the article text here"
                value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} />
              <div style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
                <button style={ghostButton} onClick={addPaste}
                  disabled={!paste.text.trim()}>Add this article</button>
                {pasted.length > 0 && (
                  <span style={{ fontSize: 12, color: S.muted }}>
                    {pasted.length} pasted article{pasted.length > 1 ? 's' : ''} ready
                  </span>
                )}
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <input style={input} placeholder="Note for Katey (optional) — where this came from, what to look for"
                value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
              <button
                style={busy || (!files.length && !pasted.length) ? { ...button, opacity: 0.5 } : button}
                disabled={busy || (!files.length && !pasted.length)}
                onClick={submit}
              >
                {busy ? 'Uploading & parsing…' : 'Upload — parse & price (free)'}
              </button>
              {error && <span style={{ color: S.error, fontSize: 13 }}>{error}</span>}
            </div>
          </>
        )}

        {batch && (
          <>
            <div style={{ ...box, borderLeft: `4px solid ${S.accent}` }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: S.heading }}>
                Batch {batch.id} is in — waiting for Katey
              </div>
              {parse && (
                <div style={{ fontSize: 13, marginTop: 8, lineHeight: 1.7 }}>
                  <b>{parse.articles}</b> article{parse.articles === 1 ? '' : 's'} parsed,{' '}
                  <b>{parse.usable}</b> usable (full provenance + readable text), body share{' '}
                  <b>{fmtPct(parse.body_share)}</b>.
                  {quote && quote.billable > 0 && quote.estimate_usd != null && (
                    <> Extraction of {quote.billable} article{quote.billable === 1 ? '' : 's'} would
                      cost about <b>{fmtUsd(quote.estimate_usd)}</b>{' '}
                      <span style={{ color: S.muted }}>
                        ({fmtUsd(quote.rate_per_article)}/article, measured over the last{' '}
                        {quote.rate_basis_articles}-article run)
                      </span> — Katey approves that on her side before anything is spent.</>
                  )}
                  {quote && quote.billable === 0 && (
                    <> Nothing here needs the paid extraction step.</>
                  )}
                </div>
              )}
              {(batch.files || []).length > 0 && (
                <div style={{ marginTop: 10, fontSize: 12, color: S.muted }}>
                  {(batch.files || []).map((f: any, i: number) => (
                    <div key={i}>
                      {f.name} — {f.kind}{f.note ? ` (${f.note})` : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {tables.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {tables.map(([name, t]: any) => (
                  <TableMapper key={name} batchId={batch.id} file={name} inspect={t.inspect}
                    onMapped={() => {}} />
                ))}
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <button style={ghostButton} onClick={() => {
                setBatch(null); setFiles([]); setPasted([]); setNote('');
              }}>Add another batch</button>
            </div>
          </>
        )}

        <div style={{ marginTop: 28, fontSize: 11, color: S.muted }}>
          Uploaded text stays on the SNZ research server and out of the public repository.
        </div>
      </div>
    </div>
  );
}

function Gate() {
  const [unlocked, letIn] = useUnlock();
  if (unlocked === null) return null;
  if (!unlocked) return <UnlockScreen title="SNZ Map — add research" onIn={letIn} />;
  return <App />;
}

createRoot(document.getElementById('root')!).render(<Gate />);
