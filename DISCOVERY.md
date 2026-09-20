# Discovery pass — findings (2026-09-19/20)

The corpus-first read NEXT_STEPS.md queued ("pattern discovery pass"). Everything below
was measured locally — **$0 against the pipeline key**. Sources: `pipeline/output/articles.json`
(602 articles: 366 text + 236 scans), `contract_events.json` (178 events), `tenure_records.json`
(102 tenures), plus a full local-tesseract OCR of the page scans (finished 2026-09-20 01:05 UTC).

**OCR yield:** 224 scan-articles with page images (12 are citation-only stubs) → 202 usable
text (90%), 47 of those low-confidence (<75). Raw OCR: 229 pages, ~5,800s runtime.
Per-page text lives in the discovery chat workspace (`scans_ocr.jsonl`, 2.9MB) — copy into
the repo if it should persist beyond conversation retention.

**Citations:** all 602 articles carry APA + MLA in `pipeline/output/article_citations.json`.
19 scans were upgraded from page-level fallback titles to real headlines (hand-curated from
OCR, flagged `title_source: "ocr-curated"`, original fallback kept in `title_page_fallback`).
The other scans keep the accurate page-level title (e.g. "January 21, 2017, Page 3A") —
a wrong headline in a paper is worse than a vague-but-true one.

---

## The patterns (counts = text-corpus articles + scan articles)

### 1. Job postings are contract-in-force evidence — CONFIRMED, scans only
The classifieds signal Katey spotted by eye is real and machine-findable.
**20 scan pages are classifieds-like** (≥3 hiring signatures); on **6 of them an operator
sits inside the ad itself**:

- *Standard Times* (San Angelo, TX) — the **same Aramark ad ran Aug 5, 7, 8 2016**
  ("EQUAL EMPLOYMENT OPPORTUNITY/AFFIRMATIVE ACTION employer… apply online") — Aramark
  hiring at Angelo State: three timestamps pinning the contract in force.
- *Asbury Park Press* 2016-08-14 — **Sodexo at Lakewood Public Schools**, 855 Somerset
  Ave, Lakewood NJ ("JOIN OUR TEAM! Apply Online Now… sodexo.balancetrak…").
- *The Tennessean* 2016-09-18 — **ARAMARK Dining Services at Tennessee State University**,
  "now hiring qualified candidates for all positions", incl. CASHIER.
- *Home News Tribune* (East Brunswick, NJ) 2016-09-11 — Aramark EOE ad.
- Plus the eyeballed seed: Sodexo Clinical Dietitian, **Andalusia Health, AL, Dec 2016**.

Each ad = (operator, venue, date) — exactly a tenure-corroboration record. **The schema
has no home for evidence that isn't a contract *event*** (nothing was won/lost/renewed
on the ad date; the ad proves *presence*).

### 2. Succession chains — who replaces whom: 21 + 1 = 22 articles
Temple: Aramark replaces Sodexo after 28 years, 15-year deal. El Paso jail: Trinity ←
Aramark after 18 years. Brandeis: Sodexo ← Aramark 2013. Scan add: *Lansing State
Journal* 2016-09-07 — "Trinity replaced Aramark Correctional Services… in September 2015."
Extras pressure agrees: the model invented `incumbent` 16×, `named_incumbent` 5×,
`successor` 3× because it kept seeing this and had nowhere to put it.

### 3. Incumbency-duration assertions: 25 + 1 = 26 articles
"Clemson… since 1969, when it was ARA Services"; "Aramark Canada healthcare since 1942";
Edmonton scan: "working with major dining contractor Aramark since 2012." Extras:
`incumbent_tenure_years` 7×, `tenure_years` 6×. These are **tenure records asserted in
prose** — currently only derivable indirectly from event pairs.

### 4. Union identity: 27 + 16 = 43 articles
UNITE HERE Local 217 (850 CT cafeteria workers), CUPE 543 Windsor ($24/hr municipal vs
$13/hr privatized — the wage math itself), UNITE HERE ratification at Disney (Orlando
scan). Extras: `union` 6×. Labor conflict clusters on exactly the operators/venues the
map tracks, and the union local is the stable join key.

### 5. Fines & penalties with dollar amounts: 4 + 4 = 8 articles (Michigan cluster)
Trinity "$2 million in penalties" (Battle Creek Enquirer + Lansing State Journal, Jan
2017); **scan-only find: Aramark "could have been subject to an additional $3.1 million
in fines" which the prior administration never imposed** (LSJ 2017-01-21) — unimposed
penalties are invisible to an event schema keyed on things that happened. `violation`
event_type exists (14 events) but there is no penalty-amount field; extras invented
`violation_type` 4×.

### 6. Line-of-business is being lost in operator names: 53 text articles non-food
NW Missouri dropped Aramark for **facilities**; NRG Stadium facilities partner; Aramark
Uniform in customer lists. Meanwhile `operator_normalized` fragments: Aramark 87 /
Aramark Correctional Services 9 / Aramark Healthcare 2 / Aramark Food Services 1 / ACS
LLC 1; Trinity Services Group 5 vs Trinity Food Services 4. The division suffix IS the
line-of-business signal, stored inconsistently. Extras: `service_type` 6×, `scope` 5×.

### 7. K-12 is a real sector the venue spine barely sees: 29 + 28 = 57 articles
CPS split between Aramark and SodexoMagic (custodial mega-deal + dispute); Lakewood NJ
(the Sodexo ad above); Michigan school-closure pages. Tenure `venue_type` is "other" for
**96 of 102** records — the vocabulary can't say "school district", "jail", "hospital".

### 8. RFP / rebid windows — the forward-looking layer: 20 + 7 = 27 articles
"Expires in July 2018, opening the door…"; El Paso rebid policy; Georgetown's 30-person
RFP committee; Windsor Huron Lodge RFP ($604k/yr savings claim). These are **dated
future windows** — a watch-list layer, not historical events.

### 9. Meal-plan economics: 11 text articles
$749–1,780/semester; $2,726/15-week standard 18-meal plan; soda-tax pass-through.
Price points at venues the map already knows — a small pricing table.

### 10. Sustainability commitments tied to operators: 42 text articles
Laurier Fair Trade designation; Temple transition explicitly preserving "composting,
locally sourced" under the new provider; BSU $18k energy rebate. **The SNZ angle** —
sustainability language concentrates in exactly the transition moments the map tracks.

Supporting texture: multi-operator co-mentions 107 articles (aramark+sodexo 56);
name evolution (ARA Services era, SodexoMagic JV); 53 near-duplicate articles in 26
wire-reprint groups; event dates cluster Jul/Sep/Dec (contract-cycle seasonality).

---

## Schema-extension verdicts

Ground rule from `cite.py` / NEXT_STEPS.md: **widening `EVENT_FIELDS` changes every
request-payload hash and invalidates all 366 cached extractions (~$13 re-run). Any
schema extension ships batched with build C or not at all.**

**Justify extension (batch with C):**
- `incumbent` + `incumbent_since` (patterns 2+3) — highest extras pressure, 48 articles,
  turns isolated events into venue timelines. Map: operator-succession edges.
- `penalty_usd` (+ `penalty_imposed` bool) (pattern 5) — small field, unique layer;
  captures the $3.1M-unimposed case. Map: enforcement dollars.
- `union_local` (pattern 4) — 43 articles, stable join key. Map: labor overlay.
- `service_scope` (food / facilities / uniforms / custodial) (pattern 6) — one enum.

**No schema change needed (post-hoc, free, do anytime):**
- Operator division normalization → parent + division two-level (pattern 6's other half).
- `venue_type` vocabulary fix (pattern 7) — output-side normalization of the 96 "other".
- RFP watch list (pattern 8) — own small table, harvested by regex from parsed text.
- Meal-plan price table (pattern 9) — same.
- Sustainability keyword layer (pattern 10) — article-level tags, no extraction.

**New track, not an event field (pattern 1):** job-posting evidence wants its own
`posting_evidence` records (operator, venue, date, source) feeding tenure corroboration —
postings are *presence proofs*, not events; forcing them into the event schema would
blur what `event_type` means. 6 confirmed now; the 20 classifieds pages suggest more
once the low-confidence OCR is eyeballed.

**Not justified yet:** prison-disruption as event_type (7 text, 0 scans — existing
`violation`/`lost` combo covers observed cases); meal-plan fields on events.

---

*Produced 2026-09-20. OCR + classifier scripts and per-page text in the discovery chat
workspace; title curation list in `apply_curated_titles.py` there. Next: console chat
decides which extensions ride with build C; the 3 `.xls` files remain unprocessed
(tabular track); scan extraction (~$8) still awaits a separate go.*
