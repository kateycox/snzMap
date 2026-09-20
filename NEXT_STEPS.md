# Next steps

Two builds were scoped on 2026-08-14 and deliberately **not started**, because neither could
be finished and verified before the handoff. Both are written up here with the measurements
that justify them, so the next person inherits the reasoning and not just the conclusion.

Everything below is a number this repo can reproduce. Commands to re-derive them are given.

---

## Queued — the USB batch (added 2026-09-19, directed by Katey)

**Update 2026-09-19 (evening): SPEND CANCELLED — the batch is a re-delivery, not new data.**
Katey approved the $12.85 and the spend run was started, but a pre-spend hash check stopped
it: all 4 usable text files in `inbox/usb-sept-2026/` are **byte-identical (sha256) to
`usb1`** — the corpus that already produced the 178 live events (same filenames, same
July-29-2026 export dates; `output/ingest_manifest_usb1.json` vs
`ingest_manifest_usb-sept-2026.json`). The $12.85 quote appears only because the extraction
cache keys on the article's *path* (`article_key` = sha256 of `source_file|source_offset`,
`extract/run.py`) and the raw folder was relabeled usb1 → usb-sept-2026 — and because the
original run's responses aren't in `raw/extract/` (1 file there, from the web queue).
Spending would re-bill the same 366 articles, re-produce ~the same 178 events with
model-nondeterminism churn against the audited set, and add ~0 new events. **$0 spent.**
Still genuinely new in the batch: the 236 page scans (separate OCR/webqueue track) and the
3 skipped `.xls` investment-analysis files (tabular track, never quoted).

The dry-run measurements, kept for reference (now understood as re-measuring usb1):

```
602  articles, from 4 usable files
     (two ProQuest RTF exports split cleanly — 497 Aramark, 99 Sodexho —
      plus 2 EBSCO .docx; 3 .xls skipped as non-article formats)
366  have a real text layer  -> quoted $12.85 (3.5¢/article) — AWAITING KATEY'S GO
236  are page scans, no text -> not quoted, not billable yet
```

The one scan sampled by eye was a classified-ad page — a Sodexo Clinical Dietitian
posting that pins Sodexo to Andalusia Health, AL in Dec 2016. Katey's read, adopted:
**job postings are contract-in-force evidence** (who held a contract, where, when), so
the scans are not junk. OCR is free (local tesseract; money only moves at extraction
after OCR) — expected second quote ~$8 for the 236 at the measured rate. Measured yield
from the prior corpus: 178 events from 366 articles (~0.49/article, ≈7¢/event).

The original decisions, kept for reference:

**The drop point.** Katey uploads the folder through the Zo file browser to
`snzMap/inbox/<label>/` — create `inbox/` on first use, pick a batch label
(`usb-sept-2026` or similar). Nothing watches this folder; files landing there cost
nothing and change nothing until a person runs the pipeline.

**The run.** Two routes, chosen by what the batch turns out to contain:

- **Text-layer docs** (`.txt` `.html` `.rtf` `.docx`, PDFs with real text):
  `pipeline.add inbox/<label>` — free stages run (copy, hash, parse), the extraction
  cost is quoted, and it stops. Katey approves, re-run with `--spend`.
- **Scans:** `pipeline.add` has **no OCR step, on purpose** (see the note in
  `pipeline/ingest/collect.py`) — it records scans as skipped. Scans must instead go
  through the web-queue path, which stores, OCRs (tesseract, free) and quotes — never
  refuses (ACCESS_OCR_SPEC.md). Either re-upload just the scans via `/add`, or run the
  webqueue machinery against the inbox folder server-side — verified 2026-09-19: create
  a batch (`pipeline.webqueue create`), copy the scans into its `incoming/files/` dir,
  then `pipeline.webqueue ingest` OCRs them (tesseract) and quotes as normal. Decide
  after the dry run shows the mix.

**Cost.** Copy, hash, parse and OCR are free. Extraction is the paid stage:
~3.5¢/article against the Anthropic key in `console/.env` — **not** Zo chat credits.
The response cache means re-running the same batch never pays twice.

**Decided 2026-09-19: this IS the recurring intake path, not an experiment.** Once the
spend run confirms end-to-end: (1) write it into ADDING_DATA.md as the Zo-folder variant
of Path A, and (2) make the scan detour first-class — teach `pipeline.add` to route the
scans it currently records as skipped into the webqueue OCR machinery itself, so a mixed
batch is one command instead of a command plus a manual copy. Until (2) is built, the
webqueue copy steps above are the documented workaround.

---

## Queued — pattern discovery pass (added 2026-09-19, directed by Katey; run in its own chat)

**Update 2026-09-20: DONE — findings in `snzMap/DISCOVERY.md`.** OCR finished (202/224
scans usable), job-posting classifier confirmed the classifieds signal (6 operator ads),
19 scan citations upgraded to real headlines, per-page OCR text preserved at
`pipeline/output/scans_ocr.jsonl`. Schema-extension verdicts at the end of DISCOVERY.md —
four fields justify batching with build C; the rest are free post-hoc passes.

Katey's framing, verbatim in spirit: *"what patterns am I not thinking about or
uncovering? I don't know what I don't know."*

This is a **different job from ingestion** and must not be bolted onto it. The extractor
is schema-first — it finds only what the prompt asks for (contract events against the
venue spine), which is exactly why its numbers can be trusted and exactly why it will
never surface a pattern nobody thought to ask about. Discovery is corpus-first: read
*across* `pipeline/output/articles.json`, `contract_events.json` and the tenure records
looking for recurring structure the schema has no field for. Candidate directions, none
yet checked:

- Job postings as contract-in-force timestamps (already spotted by eye — the Andalusia
  Health scan above; there may be hundreds more in the classifieds pages)
- Operator transitions: who replaces whom, and whether losses cluster before rebids
- Timing structure — RFP/renewal cycles, seasonal announcement patterns
- Geographic clustering by operator, sector bleed (the 83% finding below is itself a
  discovered pattern of this kind)
- Recurring co-mentions: named execs, union locals, foodservice consultants

**Cost shape.** Starting costs nothing from the pipeline's API key — the discovery chat
reads and reasons on Katey's Zo/subscription credit, and the corpus is parsed, local
text. Money enters the *pipeline's* key only if discovery justifies *extending the
extraction schema*, and that has the same economics as build C: a changed prompt misses
the entire response cache, so a full re-extraction (~$13). **Therefore: batch any schema
extension with C**, never ship it alone.

**How the discovery chat should work** (decided with Katey 2026-09-19):

1. **Read the parsed corpus, not the raw inbox.** `snzMap/inbox/usb-sept-2026/` is
   953MB of RTF image bloat; the same 602 articles exist as clean text in
   `pipeline/output/articles.json`. Same content, readable, free.
2. **OCR the 236 scans first — free, local tesseract** — so discovery mines the whole
   corpus including the classifieds pages (the job-posting signal lives there). This is
   independent of any extraction spend decision.
3. **Findings land as a file**, `snzMap/DISCOVERY.md` (or similar), so the console work
   inherits a document, not a chat memory. The console chat then decides what becomes a
   schema extension (→ batch with C), a map layer, or a note.

**Recommended prompt for the discovery chat:**

> Read the "pattern discovery pass" section of `snzMap/NEXT_STEPS.md` and follow its
> three-step shape. Explore the corpus in `pipeline/output/` — articles, events, tenure
> records — as raw material, not through the extraction schema. OCR the page scans
> locally (free) so they're included. Surface 5–10 candidate patterns the current
> schema cannot express, with counts and concrete examples from the data for each.
> Spend nothing against the pipeline's API key; local analysis only. Write the findings
> to `snzMap/DISCOVERY.md`, ending with: which patterns would justify a schema
> extension, and what each would add to the map.

---

## The finding that motivates both

**83% of what the pipeline extracted names a place this map is not a census of.**

```
178 extracted events
 31  name a venue in the spine   <- what is on the map
147  do not                      <- 83%
```

Broken down by what kind of institution the 147 name:

| Kind | Events | Examples |
| --- | --- | --- |
| University / college | 57 across 15 names (+7 more as bare "Temple") | Temple University (19), U of L, SMSU, University of Maine System |
| Corrections | 24 | Michigan DOC (6), Tennessee DOC (5) |
| Healthcare | 12 | Mayo Clinic (6) |
| Other | 54 | |

The spine is 7,494 venues — stadiums, arenas, ballparks, convention centers, golf courses,
ski resorts. The article corpus is overwhelmingly about **universities, prisons and
hospitals.** The two were assembled against different definitions of "institutional food
service", and that mismatch, not extraction quality, is what bounds the map.

The console states this rather than hiding it, and the contract layers are labelled a sample
rather than a census. **That labelling is doing real work — do not remove it without doing
one of the two builds below.**

```bash
# reproduce
.venv/bin/python -c "
import json,collections
ev=json.loads(open('pipeline/output/contract_events.json').read())
un=[e for e in ev if not e.get('venue_id')]
print(len(un),'of',len(ev),'unmapped')
print(collections.Counter((e.get('venue_name_as_written') or '?').strip() for e in un).most_common(15))"
```

---

## C — Universities into the spine

**What it buys.** Roughly **64 of the 147 unmapped events** become mappable — mapped events
go from 31 to about 95, tripling the contract layer. It is the single largest coverage gain
available, and it targets the exact institutions the corpus is actually about.

**What it costs.**

| | |
| --- | --- |
| Wikidata pull + spine rebuild | A few hours. `pipeline/spine/wikidata.py` already implements this exact pattern for venues — US colleges and universities are a well-populated Wikidata class with coordinates. |
| **Re-running extraction** | **$12.85 and ~2 hours.** Unavoidable — see below. |
| Re-running the precision audit | ~1 hour of a person's time. Also unavoidable — see below. |

**Why extraction must be re-run.** Candidate venues are offered to the model *at extraction
time*; `venue_id` is chosen from that offered list and validated against it, precisely so the
model cannot invent an identity. A larger spine changes the candidate list, which changes
every payload, which misses the response cache. There is no cheap post-hoc join that
preserves the existing safety property. **Do not be tempted to bolt on a name-matching pass
over `venue_name_as_written`** — that reintroduces exactly the trust the prompt is built to
withhold.

**The risk, which is measured and not hypothetical.** A bigger spine means more candidates
per article and more chances to match the wrong one. The precision audit already caught this
failure mode in its mildest form: `"Temple"` loosely matched `"temple terrace golf and
country club"`. Adding thousands of universities makes near-miss names far more common.
Precision is currently 70% (14/20, 48–86% CI). **Re-run `pipeline/audit` after this change
and compare.** If precision drops, the coverage gain is not a gain — a wrong big number is
worse than a missing right small one.

**The decision that comes first, and it is not an engineering one.** This changes what the
map claims to be. Today it is a map of stadiums and arenas that happens to hold some
university contracts. After this it is a map of institutional food service generally, and
the 7,494-venue spine becomes a partial census of a much larger universe — which means the
denominator in the sidebar ("6,469 of 6,884") has to be rewritten to mean something else.
**That is Kiki's call, not the next engineer's.**

---

## D — OCR the page scans

**What it buys.** **236 of 602 articles (39%) have no text at all** — the export declared a
full-text section and supplied a page image instead. Nothing has ever read them. At the
observed rate of 0.49 events per usable article, they plausibly hold **~115 more events**.

```
602  articles parsed
366  reached extraction
236  are page scans with no text layer   <- 39% of the corpus, never read
239  separately have no headline (overlapping set)
```

**What it costs.** An OCR pass (Tesseract locally, or a vision model), plus **~$8.30** to
extract the recovered text at the measured 3.5¢/article, plus the work of wiring OCR into
`pipeline/ingest/parse.py` behind the existing lazy-import pattern.

**The risk.** OCR errors do not fail loudly — they produce plausible-looking wrong strings.
A misread operator or venue name yields a confidently wrong row, which is worse than the
current honest gap. Mitigation, in order: put OCR'd articles behind a distinct
`source_label` so they can be excluded; audit them **separately** from the clean corpus so
one precision figure does not launder the other; treat a drop in `extraction_confidence` on
OCR'd articles as the signal to stop.

**Cheaper first move.** Before building any of this, check whether the articles can simply be
re-exported *with* their full text. 236 missing full-text sections looks like an export
setting, not a scanning problem. **An afternoon on the ProQuest/Nexis export options may be
worth more than a week on OCR.** Do this first.

```bash
# reproduce
.venv/bin/python -c "
import json
a=json.loads(open('pipeline/output/articles.json').read())
print(len(a),'articles;',sum(1 for x in a if not x.get('body_text')),'with no body text')"
```

---

### A cosmetic fix that should ride along with C

Every `source_publication` in the corpus reads `'|University Wire; Carlsbad |'`. The bars are
striprtf rendering a ProQuest table cell; 597 of 602 publications and 600 of 602 dates arrive
that way. It reaches `tenure_records.csv`, `contract_events.csv` and the review queue — every
file a person reads.

The fix is four lines in `pipeline/ingest/parse.py`: unwrap a value that is exactly one cell
(`^\|([^|]*)\|$`, no interior bars). Only that shape — article bodies genuinely contain
multi-cell table rows, 43 of them, and a blanket strip would mangle real text.

**It is not free, and the reason is worth understanding before touching it.** `prompt.py`
prints the article header into the payload — *"copy these into every event verbatim"* — and
the response cache is keyed on a hash of that payload. Cleaning the parser changes all 366
prompts:

```
cache hits today:              366/366
cache hits after the fix:        5/366     <- the 5 articles that never had bars
cost to re-extract the rest:    $12.67
```

There is no cheaper correct version. `extract/run.py:finalize` already treats the article
record as the authority and overwrites every source field the model echoes, so a clean parse
*would* clean every downstream file — but only through a re-extraction. Fixing it further
downstream instead leaves `articles.json` and `contract_events.json` wrong for the next
consumer. And fixing the parser *without* re-extracting is the worst of the three: the
deliverables keep the bars, and the next person's `pipeline.add --spend` silently costs $12.67
instead of $0.03 with no warning.

Renaming the 366 cached files to their new hashes was considered and rejected. The final rows
would be identical — `finalize` discards the model's echoed source fields anyway — but
`raw/extract/` would then claim a response was given to a payload that was never sent, which
breaks the audit trail the project rests on.

So: **do it as part of C**, which already pays for a full re-extraction. On its own it is
$12.67 for a cosmetic string.

---

## What to do before either

Both builds are expensive and neither is measurable without these, which cost no engineering
time at all:

1. **An independent precision judgment.** The current 70% was judged by the pipeline's own
   author; `audit_summary.json` records `"independent": false` and the console says so. A
   second person re-judging the same 20 rows turns it into a measurement. Tooling is built:
   `pipeline.audit.sample` then `pipeline.audit.score --auditor "name"`.
2. **The 24 seeded gold rows.** Recall has never been measured. The rows are seeded and
   waiting in `pipeline/output/gold_seed.csv`; see *Filling in the gold rows* in
   [ADDING_DATA.md](ADDING_DATA.md).

Without these, C and D can raise the numbers on the map with no way to tell whether they
raised the *true* ones.
