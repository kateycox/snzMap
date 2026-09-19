# Console UX Spec — cross-links, data browser, unified search

Approved by Katey 2026-09-19. Builds on the upload queue shipped the same day
(see UPLOAD_BUILD_SPEC.md and HANDOFF.md). No code has been written yet.

## Context

The upload queue works, but the three surfaces don't know about each other and
the backend store is invisible:

1. `/console` (PUBLIC map) has no path to `/add` or `/review`.
2. Batches, exclusions, and rejected rows in `pipeline/webqueue/data` have no UI
   beyond the per-batch review screen. Published events have no table view at all.
3. The sidebar search box only searches the venue spine (6,884 venues). Typing an
   operator ("Aramark") or anything about a contract event returns nothing, which
   makes search feel absent.

## Work items

### 1. Cross-linking (smallest)
- `/console`: add a discreet footer/header link "Review queue →" pointing at
  `/review`. Safe on the public page — the password gate is on the other side.
- `/review` (after admin auth only): a copyable card showing Yash's tokened
  `/add?k=…` link, so Katey can re-send it without asking Zo.
- `/add`: small "← back to map" link.
- HARD RULE: Yash's token must never be rendered on, or embedded in the bundle
  of, any public route. It may only be returned by an API call that has passed
  the admin session gate.

### 2. Data browser (gated, read-only)
A "Data" tab inside the authed `/review` area showing the backend store:
- **Published events** — every contract event on the map (baseline 178 +
  published batches), as a sortable/filterable table: operator, venue, event
  type, dates, provenance/source, which batch it came from (baseline rows say
  baseline).
- **Batches** — history with status (pending quote / awaiting approval /
  extracted / published / discarded), cost actually billed, row counts.
- **Exclusions** — rows excluded at Gate 2, with Katey's stated reason.
- **Rejected** — schema-failure rows from CSV ingest.
- Text filter across the table + CSV export of the current view.
- Strictly read-only: no edit/delete actions in this view. Publishing and
  excluding stay in the existing per-batch review flow.

### 3. Unified map search
- Extend the existing sidebar search (`VenueSearch.tsx` + `utils/venueSearch.ts`)
  to also match:
  - **Operators** — picking one applies the existing operator lens/highlight.
  - **Contract events** — match on operator/venue/event text; picking one
    focuses its venue and opens the venue panel.
- Group results under headings (Venues / Operators / Events) in one dropdown.
- Relabel so it reads as the search: "Search venues, operators, events…".
- Keep the current behavior that off-year venues are shown and picking them
  moves the year slider.

### 4. Citations (MLA / APA)
Katey will cite this data in papers. Every event already stores
source_publication, source_date, source_title, source_file — but not author,
URL/database, or access date.
- **Capture**: add optional Author and URL fields to the `/add` paste form
  (recorded exactly as typed) and to the CSV column mapping. Store an
  ingest/access date automatically on every new upload.
- **Backfill**: for the 178 baseline events, parse author + database name +
  URL out of the ProQuest RTF metadata headers in `articles/raw/` (structured
  text — deterministic parse, no LLM, no cost). Only write fields actually
  found; leave absent ones null.
- **Format**: in the data browser (item 2), each event row gets a "Cite"
  action rendering the citation in MLA 9 and APA 7 from stored fields only,
  with copy button; plus "export bibliography" for the current filtered view.
- Honesty rule: missing fields are omitted and flagged ("no author on
  record"), never guessed or synthesized. The citation shows exactly what the
  store holds.

## Constraints (all non-negotiable)
- Build into the existing `snzmap` service — service slots are 5/5, do not
  create a new service.
- Do not touch the baseline-merge/publish logic; the 178-event baseline
  protection stays exactly as shipped.
- Elian's data-honesty rules apply to everything the data browser displays:
  show real provenance, never synthesize or prettify missing fields, absences
  stated rather than hidden.
- `edit_file_llm` / bulk LLM edits are banned on large files in this repo;
  use surgical edits (see repo memory: server.ts and the big route files have
  been corrupted by fuzzy merges before).
- Commit and push to github.com/kateycox/snzMap (branch main) when done;
  update HANDOFF.md.

## Acceptance checks
- Public `/console` bundle contains no token string (grep the built JS).
- Map still renders all existing events after deploy (compare pin/run counts).
- Data browser row count for published events == count in the canonical map
  file; baseline rows labelled as baseline.
- Searching an operator name in the sidebar returns results and highlights.
- Yash's link visible in `/review` only after password.
- A baseline event with full RTF metadata renders a complete MLA and APA
  citation; one with missing author renders without it and says so.
