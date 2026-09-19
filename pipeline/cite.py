"""Citation metadata — capture and backfill, deterministic, nothing invented.

Katey cites this data in papers. Every event already carries source_publication,
source_date, source_title and source_file, but a citation also wants the author, the
database the article came through, and a URL — fields ProQuest prints in every export's
per-document citation block and the pipeline never previously kept.

Three rules, all Elian's:

  * **Deterministic text scan only.** Labelled lines (`Author:`, `Database:`,
    `Document URL:`, `ProQuest document link`) read straight off the export. No model
    reads anything here and nothing costs money.
  * **Only what is actually found is written.** An export with no Author line produces
    no author field — the UI says "no author on record" rather than guessing one.
  * **Recorded exactly as printed.** The single cleanup is stripping the `|...|` bars
    ProQuest's RTF-to-text conversion wraps around every table cell — furniture, not
    content (the same bars sit in every baseline `source_publication`).

Where the fields live: `event["extras"]["citation"]` — never new top-level columns.
`schema.py` rejects unknown event fields by design, and EVENT_FIELDS also generates the
extraction tool schema, so widening it would change every request payload hash and
invalidate the 366 paid, cached extractions (the documented $12.67 trap in NEXT_STEPS.md).

The backfill needs `pipeline/articles/raw/` — the gitignored corpus that lives with
Elian, not on the hosted server. Run where the files are; files absent are reported as
absent, and the events they back simply keep no citation fields.

CLI:
    .venv/bin/python -m pipeline.cite --backfill        # baseline <- articles/raw/
    .venv/bin/python -m pipeline.cite --backfill --dry  # report only, write nothing
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

PIPE = Path(__file__).resolve().parent
BASELINE = PIPE / "webqueue" / "baseline_contract_events.json"

# One labelled line per field. ProQuest's own citation block prints these below the full
# text; the txt layout writes `Author: Reilly, M.` and the RTF-table layout writes
# `Author: |Reilly, M. |`. Both are the same line to this regex.
_LABEL = re.compile(
    r"^[ \t]*\|?[ \t]*(author|byline|database|document url|url|proquest document link)"
    r"[ \t]*:[ \t]*(.*)$",
    re.I,
)
# The RTF layout also prints the link label bare, URL on a following line.
_BARE_LINK = re.compile(r"^[ \t]*\|?[ \t]*proquest document link[ \t]*\|?[ \t]*$", re.I)
_URL = re.compile(r"https?://[^\s|]+")


def _clean(value: str) -> str:
    """Strip whitespace and the RTF table bars. Nothing else — the value is the record."""
    return value.strip().strip("|").strip()


def scan_citation(block: str) -> dict[str, str]:
    """Author / database / url actually printed in one document's text. Absent stays absent.

    First occurrence of each field wins: ProQuest prints the citation block once per
    document, and a second "Author:" deeper in is prose quoting someone, not metadata.
    """
    found: dict[str, str] = {}
    lines = block.split("\n")
    for i, line in enumerate(lines):
        m = _LABEL.match(line)
        if m:
            name, raw = m.group(1).lower(), _clean(m.group(2))
            if name == "author" and raw and "author" not in found:
                found["author"] = raw
            elif name == "byline" and raw:
                found.setdefault("_byline", raw)
            elif name == "database" and raw and "database" not in found:
                found["database"] = raw
            elif name in ("document url", "url", "proquest document link") and "url" not in found:
                u = _URL.search(raw)
                if u:
                    found["url"] = u.group(0)
            continue
        if "url" not in found and _BARE_LINK.match(line):
            # URL on the next line or two — the RTF layout wraps it.
            for j in range(i + 1, min(i + 3, len(lines))):
                u = _URL.search(lines[j])
                if u:
                    found["url"] = u.group(0)
                    break
    # A byline is only used when no Author line exists, and recorded exactly as printed.
    byline = found.pop("_byline", None)
    if byline and "author" not in found:
        found["author"] = byline
    return found


def _fold(s: str | None) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", (s or "").lower()).strip()


def _blocks_with_meta(path: Path, rel: str) -> list[dict[str, Any]]:
    """Each document in one export file: its parsed title, offset, and scanned citation."""
    from .ingest.formats import to_text
    from .ingest.parse import parse_block, split_documents

    text = to_text(path)
    out = []
    for offset, block in split_documents(text)[0]:
        rec = parse_block(block, offset, rel)
        out.append({
            "offset": offset,
            "title": rec.get("source_title"),
            "meta": scan_citation(block),
        })
    return out


def attach_citations(articles: list[dict[str, Any]], root: Path = PIPE) -> int:
    """Scan each parsed article's own source document and record what it prints.

    Fills `source_author` / `source_url` / `source_database` on the article records —
    never overwriting a value already present (a pasted article's typed author is
    authoritative over anything a scan could say). Returns how many records gained at
    least one field. Files that cannot be read are skipped silently here: ingest already
    reported them as unreadable, and a citation scan has nothing to add to that.
    """
    by_file: dict[str, list[dict[str, Any]]] = {}
    for a in articles:
        by_file.setdefault(a.get("source_file") or "", []).append(a)

    gained = 0
    for rel, group in by_file.items():
        path = root / rel
        if not rel or not path.exists():
            continue
        try:
            blocks = _blocks_with_meta(path, rel)
        except Exception:
            continue
        by_offset = {b["offset"]: b["meta"] for b in blocks}
        for a in group:
            meta = by_offset.get(a.get("source_offset"))
            if meta is None and len(blocks) == 1:
                meta = blocks[0]["meta"]
            if not meta:
                continue
            before = (a.get("source_author"), a.get("source_url"), a.get("source_database"))
            if meta.get("author") and not a.get("source_author"):
                a["source_author"] = meta["author"]
            if meta.get("url") and not a.get("source_url"):
                a["source_url"] = meta["url"]
            if meta.get("database") and not a.get("source_database"):
                a["source_database"] = meta["database"]
            after = (a.get("source_author"), a.get("source_url"), a.get("source_database"))
            gained += before != after
    return gained


def citation_from_article(article: dict[str, Any]) -> dict[str, str]:
    """The `extras.citation` dict for an event, from its article record. Found keys only."""
    out = {}
    for key, field in (("author", "source_author"), ("url", "source_url"),
                       ("database", "source_database"), ("accessed", "source_accessed")):
        v = article.get(field)
        if v:
            out[key] = v
    return out


def backfill_baseline(*, dry: bool = False) -> dict[str, Any]:
    """Fill `extras.citation` on the 178 committed baseline events from the raw exports.

    Matching is by source_file, then by folded title within the file (one export holds
    many documents). A file with exactly one document needs no title match. An event
    whose title matches no document is reported unmatched and left untouched — the one
    failure mode this must not have is crediting one article's author to another's event.
    """
    events = json.loads(BASELINE.read_text())
    by_file: dict[str, list[dict[str, Any]]] = {}
    for ev in events:
        by_file.setdefault(ev.get("source_file") or "", []).append(ev)

    report = {
        "baseline_events": len(events),
        "source_files": len(by_file),
        "files_found": 0,
        "files_missing": [],
        "events_updated": 0,
        "events_unmatched": [],
        "fields_written": {"author": 0, "url": 0, "database": 0},
    }

    changed = False
    for rel, group in sorted(by_file.items()):
        path = PIPE / rel
        if not rel or not path.exists():
            report["files_missing"].append(rel)
            continue
        report["files_found"] += 1
        try:
            blocks = _blocks_with_meta(path, rel)
        except Exception as exc:
            report["files_missing"].append(f"{rel} (unreadable: {type(exc).__name__})")
            continue
        by_title: dict[str, dict[str, str]] = {}
        for b in blocks:
            t = _fold(b["title"])
            if t and t not in by_title:
                by_title[t] = b["meta"]

        for ev in group:
            meta = by_title.get(_fold(ev.get("source_title")))
            if meta is None and len(blocks) == 1:
                meta = blocks[0]["meta"]
            if meta is None:
                report["events_unmatched"].append(
                    {"event_id": ev["event_id"], "source_title": ev.get("source_title")})
                continue
            if not meta:
                continue
            extras = ev.get("extras") or {}
            cit = dict(extras.get("citation") or {})
            wrote = False
            for k in ("author", "url", "database"):
                if meta.get(k) and not cit.get(k):
                    cit[k] = meta[k]
                    report["fields_written"][k] += 1
                    wrote = True
            if wrote:
                extras["citation"] = cit
                ev["extras"] = extras
                report["events_updated"] += 1
                changed = True

    if changed and not dry:
        BASELINE.write_text(json.dumps(events, indent=2))
    report["written"] = changed and not dry
    return report


def main() -> None:
    ap = argparse.ArgumentParser(prog="pipeline.cite", description=__doc__)
    ap.add_argument("--backfill", action="store_true",
                    help="fill extras.citation on the committed baseline from articles/raw/")
    ap.add_argument("--dry", action="store_true", help="report what would be written, write nothing")
    args = ap.parse_args()
    if not args.backfill:
        ap.error("nothing to do — pass --backfill")
    json.dump(backfill_baseline(dry=args.dry), sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
