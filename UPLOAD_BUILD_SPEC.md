# snzMap Data-Ingestion Interface — Build Spec

**Status:** approved by Katey 2026-09-19. This is the contract for the build. Planned in a prior chat; everything the builder needs is in this file plus the three docs below.

**Read first:** `README.md`, `ADDING_DATA.md`, `HANDOFF.md` (repo root), then skim `pipeline/add.py`, `pipeline/schema.py`, `pipeline/extract/run.py`, `console/server.ts`.

---

## Goal

A hosted front door so Yash (research partner, non-technical, no server access) can drop raw research — articles, PDFs, spreadsheets, pasted text — and it flows onto the live map after Katey approves it. The existing Python pipeline stays the engine; do NOT rebuild extraction.

## Where it lives

Inside the **existing snzmap service** (Katey's Zo service slots are 5/5 — no new service). The live service runs `bun run prod` from `console/`. Add:

- API routes in `console/server.ts`
- Two new lightweight pages, `/add` and `/review`, as separate Vite entries so the map bundle is untouched
- `pipeline/webqueue/` — a thin Python CLI that **imports** existing stages (`ingest.collect`, `ingest.run`, `extract.run`, `spans.pair`, `emit.records`, and add.py's quote logic) and speaks JSON to the Bun server
- `pipeline/tabular/` — the generic CSV/spreadsheet loader (the genuinely new module; ADDING_DATA.md scopes it)

Bun orchestrates and serves UI only. All pipeline logic stays in Python.

## Access model (decided)

- **/add (Yash):** secret link, no login. The route carries an unguessable token (e.g. `/add?k=<token>` or a token path segment). Anyone with the link can upload; nobody can find it by guessing. Yash just gets the link.
- **/review (Katey):** separate admin password, entered once per session.
- Generate both secrets at build time, store them server-side (env var or gitignored config file — NOT committed), and **text Katey** the Yash link and her admin password when live.

## The flow — two gates, both Katey's

1. **Drop (`/add`):** drag files (`.txt .html .rtf .pdf .docx .csv .xlsx`) or paste article text with title/publication/date fields (typed provenance, never guessed). Free stages run immediately: collect (hashed, deduped), parse, cost quote at the measured ~3.5¢/article rate. Yash sees e.g. "12 articles parsed, 10 usable, body share 74%, extraction ~$0.42 — waiting for Katey." **The upload path must be structurally unable to trigger paid API calls** — the server route that calls Anthropic must not exist on the upload path.
2. **Gate 1 — spend (`/review`):** batch shows exact quote; Katey clicks Approve & extract. Extraction runs in the background (UI polls). Events land in a **per-batch file**, never the canonical file directly.
3. **Gate 2 — content (`/review`):** extracted/mapped rows shown with operator, event type, date, venue match, `needs_review` flags, source snippet. Katey can tag rows *excluded by reviewer, with reason* — kept in the batch file, never deleted (Elian's rule). Then **Publish**: canonical events = committed 178-event baseline + all approved batches → existing pair → emit → copy exactly the two files `--publish` copies. Publishing is free, no API key needed.

## CSV path (decided: same layer as articles)

Upload spreadsheet → server returns headers + sample rows → mapping UI with **dropdowns** (venue / operator / date / event type / state columns, plus a required dataset-level source citation). NO LLM in the CSV path — mapping is human dropdowns, zero cost. Dry-run shows per-row results: spine-matched via existing `find_candidates` **plus a second corroborating gate** (state or year must also match; name alone never joins), ambiguous, out-of-scope — every exclusion tagged with a reason, browsable, none dropped. Rows failing `schema.py` validation land in the batch's visible rejected list. Mapped rows become contract events feeding the same tenure/pair path as articles (source = the dataset citation) — NOT a separate map layer.

## Critical hazard — do not wipe the map

The server clone is missing everything gitignored: no `.venv`, no `.env`/API key, no `pipeline/articles/raw/` corpus, no `pipeline/raw/` response cache, no `articles.json`. The 178 events and geojson are committed, so the map works — but **a naive `pipeline.add --spend` run would rewrite `contract_events.json` from an `articles.json` containing only new uploads, wiping the 178 existing events.** The merge design above (committed baseline + approved batch files) exists to prevent this. Never let any code path regenerate the canonical file from `articles.json` alone.

## Elian's data-honesty rules (non-negotiable)

- Multi-gate joins only — a name match alone never joins a row to the venue spine
- Excluded/rejected rows are tagged with a reason and kept, never silently dropped
- Cost quotes use the measured rate and say so
- Publish copies only the two files `--publish` copies; `audit_summary.json` is never auto-copied
- The sidebar's "extracted-but-ungraded" labelling stays untouched
- Uploaded article text stays out of git (already gitignored — licensed prose)

## LLM & key (decided)

- One LLM in the system: article extraction, `MODEL = "claude-opus-4-6"` in `pipeline/extract/prompt.py`. **Do not change the model** — the prompt is tuned against Elian's gold set. (Future option, not this build: test Haiku 4.5 against the gold set if volume grows; ~5x cheaper.)
- API key: use the existing Zo secret `Anthropic_Demo_API_Key` (env var), read only by the extraction step behind Gate 1. The map UI has zero API calls (verified — panel text is template code, not a model).

## Setup work bundled into the build

- Create `.venv` on the server with `requests openpyxl striprtf pdfplumber`
- A run-lock so two batches can't interleave pipeline stages
- Commit everything to the GitHub repo (github.com/kateycox/snzMap) except uploaded article text and secrets
- After first publish from the server, the server becomes canonical — note in HANDOFF.md that Elian should `git pull` before rebuilding locally

## Done means

- Yash opens his link, drops a PDF or CSV, sees a parse result and (for articles) a cost quote — and cannot spend money
- Katey opens /review, sees the batch, approves spend, reviews rows, publishes — and the map at https://snzmap-kikib.zocomputer.io/console shows the new events with the 178 originals intact
- Katey gets a text with the Yash link + her admin password
