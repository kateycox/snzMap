import { useEffect, useMemo, useRef, useState } from 'react';
import { ACCENT_SOFT, BORDER_STRONG, MUTED, MUTED_DIM, SURFACE, TEXT, WARN } from '../theme';
import type { LoadedEvidence, VenueEvidence } from '../utils/evidenceTransform';
import type { OperatorRow } from '../utils/operatorLens';
import type { VenueProperties } from '../utils/spineTransform';
import {
  hitSubtitle,
  searchEvents,
  searchOperators,
  searchVenues,
  type EventSearchHit,
  type OperatorSearchHit,
  type VenueHit,
} from '../utils/venueSearch';

interface VenueSearchProps {
  spine: GeoJSON.FeatureCollection<GeoJSON.Point, VenueProperties> | null;
  year: number;
  onPick: (hit: VenueHit) => void;
  operatorRows: OperatorRow[];
  evidence: LoadedEvidence | null;
  onPickOperator: (operator: string | null) => void;
  onPickEvidence: (v: VenueEvidence) => void;
}

/**
 * Type-to-find over everything the console can navigate to: the venue spine, the
 * operators, and the contract events. One box, grouped results — before this, typing
 * "Aramark" here returned nothing, which made search feel absent when it was only
 * narrow.
 *
 * Searching everything on every keystroke is ~7k venue comparisons plus a few hundred
 * operator/event ones — still well under a millisecond, so there is still no debounce
 * and no index.
 *
 * The venue rows keep their old promise: venues *not currently on the map* are shown
 * rather than hidden, and picking one moves the year slider. Operators apply the
 * existing lens; events focus their venue and open its panel.
 */
export function VenueSearch({
  spine, year, onPick, operatorRows, evidence, onPickOperator, onPickEvidence,
}: VenueSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const venueHits = useMemo(() => searchVenues(spine, query, 6), [spine, query]);
  const operatorHits = useMemo(
    () => searchOperators(operatorRows, evidence, query),
    [operatorRows, evidence, query]
  );
  const eventHits = useMemo(() => searchEvents(evidence, query), [evidence, query]);

  // One flat list under the grouped headings, so arrow keys walk through all three
  // groups in display order without caring where one ends.
  type Entry =
    | { kind: 'venue'; venue: VenueHit }
    | { kind: 'operator'; operator: OperatorSearchHit }
    | { kind: 'event'; event: EventSearchHit };
  const entries = useMemo<Entry[]>(
    () => [
      ...venueHits.map((venue) => ({ kind: 'venue' as const, venue })),
      ...operatorHits.map((operator) => ({ kind: 'operator' as const, operator })),
      ...eventHits.map((event) => ({ kind: 'event' as const, event })),
    ],
    [venueHits, operatorHits, eventHits]
  );

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const choose = (entry: Entry) => {
    if (entry.kind === 'venue') {
      onPick(entry.venue);
      setQuery(entry.venue.venue.canonical_name);
    } else if (entry.kind === 'operator') {
      onPickOperator(entry.operator.name);
      setQuery(entry.operator.name);
    } else {
      onPickEvidence(entry.event.venueEvidence);
      setQuery(entry.event.venueEvidence.venueName);
    }
    setOpen(false);
  };

  // Index of each entry in the flat list, per group, so rendering grouped headings and
  // the flat cursor agree about which row is highlighted.
  let flat = -1;
  const row = (entry: Entry, name: string, sub: React.ReactNode) => {
    flat += 1;
    const i = flat;
    return (
      <li key={`${entry.kind}-${i}`}>
        <button
          onMouseEnter={() => setCursor(i)}
          onClick={() => choose(entry)}
          style={{ ...hitStyle, background: i === cursor ? ACCENT_SOFT : 'transparent' }}
        >
          <span style={hitNameStyle}>{name}</span>
          <span style={hitSubStyle}>{sub}</span>
        </button>
      </li>
    );
  };

  return (
    <div ref={boxRef} style={wrapStyle}>
      <input
        value={query}
        placeholder={'Search venues, operators, events…'}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCursor((c) => Math.min(c + 1, entries.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
          } else if (e.key === 'Enter' && entries[cursor]) {
            choose(entries[cursor]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        style={inputStyle}
        aria-label="Search venues, operators, and contract events"
      />

      {open && query.trim().length >= 2 && (
        <ul style={dropStyle}>
          {entries.length === 0 && (
            <li style={{ ...emptyStyle }}>
              Nothing matches &ldquo;{query}&rdquo; — no venue (old names are searched
              too), no operator, no contract event. A real absence, not a renamed thing
              hiding.
            </li>
          )}

          {venueHits.length > 0 && <li style={groupStyle}>Venues</li>}
          {venueHits.map((hit) => {
            const closed = hit.venue.closed_year !== null && hit.venue.closed_year < year;
            const unopened =
              hit.venue.opened_year !== null && hit.venue.opened_year > year;
            return row(
              { kind: 'venue', venue: hit },
              hit.venue.canonical_name,
              <>
                {hitSubtitle(hit, year)}
                {/* Said out loud rather than filtered away: the venue is in the spine,
                    it is simply not drawn at this slider year. Picking it moves the
                    slider, so the dot the user was promised actually appears. */}
                {(closed || unopened) && (
                  <span style={offMapStyle}>
                    {closed ? ' · not on the map in ' : ' · not built yet in '}
                    {year}
                  </span>
                )}
              </>
            );
          })}

          {operatorHits.length > 0 && <li style={groupStyle}>Operators</li>}
          {operatorHits.map((op) =>
            row({ kind: 'operator', operator: op }, op.name, op.note)
          )}

          {eventHits.length > 0 && <li style={groupStyle}>Contract events</li>}
          {eventHits.map((ev) =>
            row({ kind: 'event', event: ev }, ev.label, ev.sub)
          )}
        </ul>
      )}
    </div>
  );
}

const wrapStyle: React.CSSProperties = { position: 'relative', marginBottom: 16 };

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  background: SURFACE,
  border: `1px solid ${BORDER_STRONG}`,
  borderRadius: 6,
  color: TEXT,
  fontSize: 12.5,
  outline: 'none',
};

const dropStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  right: 0,
  marginTop: 4,
  listStyle: 'none',
  padding: 4,
  background: SURFACE,
  border: `1px solid ${BORDER_STRONG}`,
  borderRadius: 6,
  maxHeight: 380,
  overflowY: 'auto',
  zIndex: 20,
  boxShadow: '0 10px 24px rgba(15,23,42,0.14)',
};

const groupStyle: React.CSSProperties = {
  padding: '6px 8px 2px',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: MUTED_DIM,
};

const hitStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '6px 8px',
  border: 'none',
  borderRadius: 4,
  color: TEXT,
  cursor: 'pointer',
  font: 'inherit',
};

const hitNameStyle: React.CSSProperties = { display: 'block', fontSize: 12.5 };
const hitSubStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: MUTED,
  marginTop: 1,
};
const offMapStyle: React.CSSProperties = { color: WARN };
const emptyStyle: React.CSSProperties = {
  padding: '8px 8px',
  fontSize: 11,
  color: MUTED,
  lineHeight: 1.5,
};
