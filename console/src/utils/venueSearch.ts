/**
 * Find a venue by the name someone actually types.
 *
 * The spine has 6,884 dots and no way to reach a specific one except by zooming to the right
 * city and clicking. That makes "is Madison Square Garden in here?" an unanswerable question
 * from the UI even though the answer is yes, three times over.
 *
 * Searching aliases rather than only `canonical_name` is the whole point. The spine stores
 * the *current* name, so a search for "Staples Center" against canonical names alone returns
 * nothing while Crypto.com Arena sits right there — and a reader would reasonably conclude
 * the venue is missing. Every alias is a match key, and the hit reports which name matched
 * so a surprising result explains itself.
 */

import type { LoadedEvidence, VenueEvidence } from './evidenceTransform';
import type { OperatorRow } from './operatorLens';
import { nameAtYear, type VenueProperties } from './spineTransform';

export interface VenueHit {
  venue: VenueProperties;
  lngLat: [number, number];
  /** The name that matched, which may be an old one the venue no longer uses. */
  matched: string;
  /** True when `matched` is not the venue's current name, so the UI can say why. */
  viaAlias: boolean;
}

/** Case- and accent-insensitive, punctuation-stripped.
 *
 *  Folding is not cosmetic here: the spine spells it "Henry B. González Convention Center"
 *  and nobody types the accent. Apostrophes go the same way, so "Levis Stadium" finds
 *  "Levi's Stadium" — the two spellings are equally likely from a keyboard. */
function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Common shorthands that are not in the spine's alias list because no source publishes
 *  them as names. They are initialisms a person types, not names a venue has. */
const SHORTHAND: Record<string, string> = {
  msg: 'madison square garden',
  sofi: 'sofi stadium',
  'the garden': 'madison square garden',
};

/**
 * Ranked matches, best first.
 *
 * Ranking is prefix > word-boundary > substring, then capacity as the tiebreak. Capacity is
 * the tiebreak for the same reason `candidates.py` uses it: 30 venues own "memorial stadium",
 * and alphabetical truncation drops the 56,000-seat one while keeping a 6,516-seat one. A
 * person typing a bare name almost always means the big one.
 */
export function searchVenues(
  spine: GeoJSON.FeatureCollection<GeoJSON.Point, VenueProperties> | null,
  query: string,
  limit = 8
): VenueHit[] {
  const q = SHORTHAND[fold(query)] ?? fold(query);
  if (!spine || q.length < 2) return [];

  const scored: { hit: VenueHit; score: number }[] = [];
  for (const f of spine.features) {
    const v = f.properties;
    let best: { score: number; matched: string; viaAlias: boolean } | null = null;

    const names: [string, boolean][] = [[v.canonical_name, false]];
    for (const a of v.aliases) if (a.name) names.push([a.name, true]);

    for (const [name, viaAlias] of names) {
      const folded = fold(name);
      let score: number;
      if (folded === q) score = 0;
      else if (folded.startsWith(q)) score = 1;
      else if (folded.includes(` ${q}`)) score = 2;
      else if (folded.includes(q)) score = 3;
      else continue;
      // A canonical-name hit outranks an alias hit at the same quality, so searching
      // "Wrigley Field" surfaces the venue itself before another venue that once
      // carried the name as an alias.
      score = score * 2 + (viaAlias ? 1 : 0);
      if (!best || score < best.score) best = { score, matched: name, viaAlias };
    }

    if (best) {
      scored.push({
        hit: {
          venue: v,
          lngLat: f.geometry.coordinates as [number, number],
          matched: best.matched,
          viaAlias: best.viaAlias,
        },
        score: best.score,
      });
    }
  }

  scored.sort(
    (a, b) =>
      a.score - b.score ||
      (b.hit.venue.capacity ?? 0) - (a.hit.venue.capacity ?? 0) ||
      a.hit.venue.canonical_name.localeCompare(b.hit.venue.canonical_name)
  );
  return scored.slice(0, limit).map((s) => s.hit);
}

/**
 * The other two things a person types into the one search box: an operator, or something
 * they remember about a contract event. Both were invisible before — typing "Aramark"
 * into a venue-only search returned nothing, which read as "Aramark is not in here"
 * when the honest answer is "Aramark is a different kind of thing, here it is".
 */

export interface OperatorSearchHit {
  name: string;
  /** Where the console knows this operator from — stated so an empty-looking lens
   *  (an operator with no venue-level awards) does not read as a broken pick. */
  note: string;
}

export interface EventSearchHit {
  venueEvidence: VenueEvidence;
  /** Display line: operator — event type at venue. */
  label: string;
  sub: string;
}

const score = (folded: string, q: string): number | null =>
  folded === q ? 0
    : folded.startsWith(q) ? 1
      : folded.includes(` ${q}`) ? 2
        : folded.includes(q) ? 3
          : null;

/**
 * Operators from both places the console knows them: the federal/labor profiles (the
 * operator lens rows) and the article evidence. Union, not intersection — an operator
 * only the articles name is still a real pick, it just lights no federal rings.
 */
export function searchOperators(
  operatorRows: OperatorRow[],
  evidence: LoadedEvidence | null,
  query: string,
  limit = 4
): OperatorSearchHit[] {
  const q = fold(query);
  if (q.length < 2) return [];

  const known = new Map<string, string>();
  for (const r of operatorRows) {
    const bits = [];
    if (r.federalAwards) bits.push(`${r.federalAwards.toLocaleString()} federal awards`);
    if (r.cases) bits.push(`${r.cases.toLocaleString()} wage & hour cases`);
    known.set(r.operator, bits.length ? bits.join(' · ') : 'in the operator records');
  }
  for (const v of evidence?.venues ?? []) {
    for (const op of v.operators) {
      if (!known.has(op)) known.set(op, 'named in the articles');
    }
  }

  const scored: { hit: OperatorSearchHit; s: number }[] = [];
  for (const [name, note] of known) {
    const s = score(fold(name), q);
    if (s !== null) scored.push({ hit: { name, note }, s });
  }
  scored.sort((a, b) => a.s - b.s || a.hit.name.localeCompare(b.hit.name));
  return scored.slice(0, limit).map((x) => x.hit);
}

/**
 * Contract events, matched on the text a person might remember: operator, venue name
 * (canonical or as the article wrote it), headline, event type. Only events that landed
 * on a spine venue are searchable — an event with no venue has nowhere to focus, and it
 * is reachable through the data browser instead.
 */
export function searchEvents(
  evidence: LoadedEvidence | null,
  query: string,
  limit = 6
): EventSearchHit[] {
  const q = fold(query);
  if (!evidence || q.length < 2) return [];

  const scored: { hit: EventSearchHit; s: number; year: number }[] = [];
  for (const v of evidence.venues) {
    for (const c of v.claims) {
      const haystacks = [
        c.operator_normalized, c.operator, v.venueName, c.venue_name_as_written,
        c.source_title, c.event_type,
      ];
      let best: number | null = null;
      for (const h of haystacks) {
        if (!h) continue;
        const s = score(fold(h), q);
        if (s !== null && (best === null || s < best)) best = s;
      }
      if (best === null) continue;
      const op = c.operator_normalized || c.operator || 'operator unknown';
      scored.push({
        s: best,
        year: c.event_year ?? -Infinity,
        hit: {
          venueEvidence: v,
          label: `${op} — ${c.event_type} — ${v.venueName}`,
          sub: [
            c.event_year ?? 'undated',
            `${c.mentions ?? 1} mention${(c.mentions ?? 1) === 1 ? '' : 's'}`,
            c.source_title || null,
          ].filter(Boolean).join(' · '),
        },
      });
    }
  }
  scored.sort((a, b) => a.s - b.s || b.year - a.year);
  return scored.slice(0, limit).map((x) => x.hit);
}

/** What to show under a hit so two venues with the same name are distinguishable.
 *
 *  This matters more than it looks: there are three Madison Square Gardens and two Wrigley
 *  Fields, and a result list that prints the name alone makes the user pick blind. */
export function hitSubtitle(hit: VenueHit, year: number): string {
  const v = hit.venue;
  const place = [v.city, v.state].filter(Boolean).join(', ');
  const span = v.opened_date
    ? `${v.opened_date.slice(0, 4)}\u2013${v.closed_date ? v.closed_date.slice(0, 4) : ''}`
    : v.closed_date
      ? `closed ${v.closed_date.slice(0, 4)}`
      : '';
  // Compared against the name the row actually prints — `canonical_name` — not against the
  // name in use at `year`. Searching "Staples Center" at 2015 returns a row titled
  // "Crypto.com Arena", and comparing against nameAtYear suppressed the explanation in
  // exactly that case, because the venue really was called Staples Center in 2015. The
  // reader is left to guess why their query matched.
  const via =
    hit.viaAlias && fold(hit.matched) !== fold(v.canonical_name)
      ? `matched \u201c${hit.matched}\u201d`
      : '';
  // Only worth saying when it disagrees with the title; otherwise it is the title again.
  const nameNow = nameAtYear(v, year);
  const thenName =
    fold(nameNow) !== fold(v.canonical_name) && fold(nameNow) !== fold(hit.matched)
      ? `${nameNow} in ${year}`
      : '';
  return [place, span, via, thenName].filter(Boolean).join(' \u00b7 ');
}
