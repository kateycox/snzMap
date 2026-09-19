/** MLA 9 and APA 7 citations rendered from stored fields only.
 *
 * The honesty rule (CONSOLE_UX_SPEC.md item 4): a missing field is omitted and flagged,
 * never guessed. No case transformation on titles — "GRUEL & UNUSUAL" is what the store
 * holds, so it is what the citation prints. The single cleanup is stripping the `|...|`
 * bars ProQuest's RTF conversion wraps around publication names: table furniture, not
 * content. APA's "(n.d.)" for a missing date is that style's own convention for exactly
 * this case, not an invention of ours.
 */

export interface BrowseEvent {
  event_id: string;
  origin: string;
  operator: string | null;
  operator_normalized: string | null;
  sub_brand: string | null;
  venue_id: string | null;
  venue_name_as_written: string | null;
  institution: string | null;
  event_type: string;
  event_date: string | null;
  date_precision: string | null;
  contract_value_usd: number | null;
  extraction_confidence: number | null;
  needs_review: boolean;
  notes: string | null;
  source_publication: string | null;
  source_date: string | null;
  source_title: string | null;
  source_file: string | null;
  citation: { author?: string; url?: string; database?: string; accessed?: string } | null;
}

/** Strip the RTF table bars off a stored publication name. Nothing else. */
export function cleanPub(p: string | null): string | null {
  if (!p) return null;
  const t = p.replace(/^\s*\|/, '').replace(/\|\s*$/, '').trim();
  return t || null;
}

// MLA's own month abbreviations — May, June and July are not abbreviated.
const MLA_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July',
  'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
const APA_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

function isoParts(iso: string | null): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function mlaDate(iso: string | null): string | null {
  const p = isoParts(iso);
  return p ? `${p[2]} ${MLA_MONTHS[p[1] - 1]} ${p[0]}` : null;
}

export function apaDate(iso: string | null): string | null {
  const p = isoParts(iso);
  return p ? `${p[0]}, ${APA_MONTHS[p[1] - 1]} ${p[2]}` : null;
}

/** End a fragment with a period unless it already ends in terminal punctuation. */
function dot(s: string): string {
  return /[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`;
}

/** What the store does not hold for this row, said out loud. */
export function citeFlags(ev: BrowseEvent): string[] {
  const c = ev.citation || {};
  const flags: string[] = [];
  if (!c.author) flags.push('no author on record');
  if (!ev.source_title) flags.push('no headline on record');
  if (!cleanPub(ev.source_publication)) flags.push('no publication on record');
  if (!ev.source_date) flags.push('no publication date on record');
  if (!c.url) flags.push('no URL on record');
  if (!c.database) flags.push('no database on record');
  return flags;
}

/** MLA 9, newspaper article (via a database when one is on record):
 *  Author. "Title." Publication, D Mon. YYYY. Database, URL. Accessed D Mon. YYYY. */
export function mla(ev: BrowseEvent): string {
  const c = ev.citation || {};
  const parts: string[] = [];
  if (c.author) parts.push(dot(c.author));
  if (ev.source_title) parts.push(`"${dot(ev.source_title)}"`);
  const pub = cleanPub(ev.source_publication);
  const d = mlaDate(ev.source_date);
  const container = [pub, d].filter(Boolean).join(', ');
  if (container) parts.push(dot(container));
  const via = [c.database, c.url].filter(Boolean).join(', ');
  if (via) parts.push(dot(via));
  if (c.accessed && mlaDate(c.accessed)) parts.push(`Accessed ${mlaDate(c.accessed)}.`);
  return parts.join(' ');
}

/** APA 7, newspaper article: Author. (YYYY, Month D). Title. Publication. URL
 *  APA 7 cites the newspaper itself, not the database, so `database` is unused here. */
export function apa(ev: BrowseEvent): string {
  const c = ev.citation || {};
  const parts: string[] = [];
  if (c.author) parts.push(dot(c.author));
  parts.push(`(${apaDate(ev.source_date) || 'n.d.'}).`);
  if (ev.source_title) parts.push(dot(ev.source_title));
  const pub = cleanPub(ev.source_publication);
  if (pub) parts.push(dot(pub));
  if (c.url) parts.push(c.url);
  return parts.join(' ');
}

/** One bibliography, one style, current filtered view. Sorted the way a works-cited
 *  list is: by author, else title. Rows missing fields carry their flags in brackets —
 *  removable by hand, but never silently absent. */
export function bibliography(rows: BrowseEvent[], style: 'mla' | 'apa'): string {
  const render = style === 'mla' ? mla : apa;
  const seen = new Set<string>();
  const lines: { key: string; text: string }[] = [];
  for (const ev of rows) {
    const text = render(ev);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const flags = citeFlags(ev).filter((f) =>
      style === 'apa' ? !f.includes('database') : true);
    lines.push({
      key: ((ev.citation || {}).author || ev.source_title || '').toLowerCase(),
      text: flags.length ? `${text} [${flags.join('; ')}]` : text,
    });
  }
  lines.sort((a, b) => a.key.localeCompare(b.key));
  return lines.map((l) => l.text).join('\n');
}
