# Access Simplification + Scanned-Article OCR — Build Spec

**Status:** directed by Katey 2026-09-19 after testing the console UX build.
**Supersedes:** the "Access model" section of UPLOAD_BUILD_SPEC.md (tokened
`/add?k=` link + per-session admin password) and the Yash-link card from
CONSOLE_UX_SPEC.md item 1. Everything else in those docs still stands.

**Read first:** README.md, HANDOFF.md, UPLOAD_BUILD_SPEC.md, CONSOLE_UX_SPEC.md,
then `console/server.ts`, `pipeline/webqueue/`, `pipeline/ingest/formats.py`.

---

## Work item A — one door, no ceremony

Katey's words: "I just envision Yash and I being able to use this and having a
simple 'add data' button that takes us to the upload data page. I don't need
these in-between Yash-only links or the admin password."

### Target UX
- `/console` gets a clear **"Add data"** button (not a discreet footer link)
  → goes to `/add`. Plain URL, no token.
- `/add` and `/review` share **one unlock**: a single shared passphrase,
  entered **once per device**, remembered by a long-lived cookie (~1 year,
  httpOnly, signed). After that first entry, both Katey and Yash just see the
  pages — no login screens, no session expiry in practice.
- No more Yash-only token, no separate admin password, no link card in
  /review. Remove the card, the `/api/review/upload-link` route, and the
  `UPLOAD_TOKEN` checks. Old `/add?k=…` links redirect to `/add` (ignore the
  param) so nothing Yash bookmarked breaks.

### Why one passphrase survives (decided, Katey can veto)
The service URL is public — Katey ships it to prospects. Gate 1 (approve
extraction) spends the Anthropic key; publish writes to the live map. With
zero gate, any stranger who finds the URL can spend money and alter the map.
The once-per-device unlock is the minimum that prevents that while feeling
gate-free day to day.

### Mechanics
- Replace `ADMIN_PASSWORD` session flow with the device-unlock cookie. One new
  secret `SHARED_PASSPHRASE` in `console/.env` (choose something memorable —
  Katey will say it out loud to Yash). Keep it out of git like the rest of .env.
- Both gates (spend approval, publish) sit behind the same unlock. The
  structural guarantee stays: **the upload path must remain unable to trigger
  paid API calls** — moving the gate must not merge the routes.
- The unlocked cookie grants /review too. Katey accepted that Yash can see
  the review area; approval actions are still deliberate button clicks with
  cost shown.
- Acceptance: built public bundle contains neither the passphrase nor any
  legacy token string; a fresh browser hits the passphrase screen once, then
  never again on that device.

## Work item B — scanned articles must not be turned away

Katey's words: "A lot of old data I want to use is scanned publications. If
that agent is going to skip them that's fine, but the overall system shouldn't
skip them. This is a big piece of the value prop — having that old data saved
and cited."

Today `pipeline/ingest/formats.py` raises `UnsupportedFormat` on a PDF with no
text layer, and image files aren't accepted at all. That refusal-at-the-door is
what changes.

### Principles
1. **Never refuse a scan.** Every upload is stored, hashed, deduped, and
   visible in its batch from the moment it lands — readable or not.
2. **Free OCR first.** Local tesseract, no API cost.
3. **Paid help only behind Gate 1.** If local OCR fails, Claude-vision
   transcription is offered as a quoted per-page cost that Katey approves like
   any extraction spend. Never automatic.
4. **Honest provenance.** OCR'd text is marked `text_source: "ocr"` (vs
   `"native"`), with per-page confidence kept. Low confidence is flagged, not
   hidden and not dropped.

### Mechanics
- Install on server: `tesseract-ocr` (apt) + `ocrmypdf` and `pytesseract`
  (pip, into the pipeline venv). `pdftoppm` already present for rasterizing.
- Accept new extensions at `/add`: `.png .jpg .jpeg .tif .tiff .webp`
  (single images and multi-page TIFF), alongside existing formats.
- Ingest flow for a scan (image file, or PDF whose text layer is empty):
  1. Store + hash as usual; state `needs_ocr` instead of rejected.
  2. Run tesseract (via ocrmypdf for PDFs, pytesseract for images).
  3. Usable text → normalize, join the standard parse → quote → extraction
     path like any article. Body-share and quote math unchanged.
  4. Unusable/failed → article stays in the batch as **"stored — OCR could
     not read this scan"** with the file kept. Batch review shows it; it is
     never silently skipped. Optional escalation button: "Transcribe with AI
     (~$X.XX for N pages)" → goes through the normal Gate-1 spend approval,
     uses the existing Anthropic key, stores the transcription as
     `text_source: "vision"`.
- "Usable" threshold: define one deterministic rule (e.g. mean word
  confidence + minimum text density), write it down in code comments, and
  surface the measured value in the review row rather than a bare pass/fail.
- Citations: scans carry no parseable ProQuest-style metadata — the uploader's
  typed Author/URL/publication fields (already built) are the citation source.
  Access date stamps as usual.

## Out of scope
- The baseline citation backfill (178 ProQuest events) is a separate pending
  task — waiting on the original export files from Elian's USB. Don't touch it.
- No model change for extraction (`claude-opus-4-6` stays; prompt is tuned).

## Non-negotiables (unchanged from prior builds)
- Build into the existing `snzmap` service — slots are 5/5, no new service.
- Do not touch the baseline-merge/publish logic protecting the 178 events.
- Elian's data-honesty rules apply everywhere: real provenance, absences
  stated, nothing synthesized, excluded/failed rows kept with reasons.
- No `edit_file_llm` / fuzzy bulk edits on large files in this repo —
  surgical edits only (server.ts and big routes have been corrupted before).
- Uploaded article text and scan images stay out of git (licensed content).
- Secrets live only in `console/.env`; grep the built bundle to prove absence.

## Done means
- Katey or Yash: open map → "Add data" → (first time on a device: one
  passphrase) → drop a scanned JPEG of a 1990s article → see it parsed via
  OCR with a cost quote, or held as "stored — OCR could not read this scan"
  with a priced AI-transcribe option. Nothing bounced.
- Old tokened link redirects; no token or passphrase in any public bundle.
- Map still shows all existing events (compare pin/run counts before/after).
- Commit + push to github.com/kateycox/snzMap (main), update HANDOFF.md,
  text Katey it's live.
