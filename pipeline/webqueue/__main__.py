"""The web upload queue: a thin CLI between console/server.ts and the existing pipeline.

Bun orchestrates and serves UI; every pipeline decision stays in Python, made by the same
modules the laptop path uses — `ingest.collect`, `ingest.parse`, `extract.run`,
`spans.pair`, `emit.records`, and `add.py`'s quote logic are imported, not reimplemented.
Each subcommand prints one JSON object to stdout, which is the whole protocol.

The two structural guarantees the routes rely on:

  * **`ingest` cannot spend money.** It imports no network path with a key; the only
    paid call in the system lives in `extract`, which the server exposes only behind the
    admin gate. The upload route calling `ingest` has no code path to the API.
  * **`publish` cannot wipe the map.** The canonical `output/contract_events.json` is
    always rebuilt as committed baseline + approved batch files — never from
    `articles.json`, which on this server holds only whatever was last uploaded.

    .venv/bin/python -m pipeline.webqueue create        # stdin: {note, pasted:[...]}
    .venv/bin/python -m pipeline.webqueue ingest --batch <id>
    .venv/bin/python -m pipeline.webqueue map-table --batch <id> --file <name>  # stdin: mapping
    .venv/bin/python -m pipeline.webqueue extract --batch <id>   # the paid stage
    .venv/bin/python -m pipeline.webqueue publish --batch <id>   # free, rebuilds the map
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import sys
from pathlib import Path
from typing import Any

from . import store
from .store import (ARTICLE_SUFFIXES, TABLE_SUFFIXES, RunLock, batch_dir,
                    kept_events, list_batches, load_baseline, load_batch, save_batch)

PIPE = Path(__file__).resolve().parent.parent           # pipeline/
RAW = PIPE / "articles" / "raw"
OUT = PIPE / "output"
CONSOLE = PIPE.parent / "console"

# The two files --publish copies, and only these two (add.py PUBLISH, same rule, same
# reason: the glob is a trap that rolls unrelated layers backwards).
PUBLISH_FILES = ["tenure_records.geojson", "contract_events.geojson"]

REQUIRED_PROVENANCE = ("source_publication", "source_date", "source_title")


def _out(obj: Any) -> None:
    json.dump(obj, sys.stdout, indent=2)
    print()


def _fail_batch(batch: dict[str, Any], msg: str) -> None:
    batch["state"] = "failed"
    batch["error"] = msg
    save_batch(batch)


# ── create ─────────────────────────────────────────────────────────────────────

def cmd_create(args: argparse.Namespace) -> None:
    req = json.load(sys.stdin) if not sys.stdin.isatty() else {}
    pasted_in = req.get("pasted") or []
    pasted = []
    for p in pasted_in:
        text = (p.get("text") or "").strip()
        if not text:
            continue
        pasted.append({
            "title": (p.get("title") or "").strip(),
            "publication": (p.get("publication") or "").strip(),
            "date": (p.get("date") or "").strip(),
            # Optional citation fields, recorded exactly as typed — never derived.
            "author": (p.get("author") or "").strip(),
            "url": (p.get("url") or "").strip(),
            "chars": len(text),
        })
    batch = store.create_batch(note=(req.get("note") or "").strip(), pasted=pasted)
    inc = batch_dir(batch["id"]) / "incoming"
    (inc / "files").mkdir(parents=True, exist_ok=True)
    pdir = inc / "pasted"
    for n, p in enumerate(pasted_in, 1):
        text = (p.get("text") or "").strip()
        if text:
            pdir.mkdir(parents=True, exist_ok=True)
            (pdir / f"pasted-{n:03d}.txt").write_text(text)
    _out(batch)


# ── ingest: every free stage, then the quote ───────────────────────────────────

def _pasted_records(batch: dict[str, Any], label: str) -> list[dict[str, Any]]:
    """Pasted text becomes an article record with **typed** provenance, never guessed.

    The text is written under `articles/raw/<label>/pasted/` so `source_file` points at a
    real file someone can open, but the header scanner never runs on it: the uploader
    typed the publication, date and title, and those fields are authoritative. A date
    that does not parse stays null with the problem named — same rule as the parser.
    """
    from ..ingest.parse import parse_date

    src = batch_dir(batch["id"]) / "incoming" / "pasted"
    dest = RAW / label / "pasted"
    records = []
    for n, meta in enumerate(batch.get("pasted") or [], 1):
        f = src / f"pasted-{n:03d}.txt"
        if not f.exists():
            continue
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dest / f.name)
        text = f.read_text()
        problems = []
        date = parse_date(meta.get("date") or "")
        if not date:
            problems.append(f"no publication date (typed {meta.get('date')!r})")
        if not meta.get("publication"):
            problems.append("no publication name typed")
        if not meta.get("title"):
            problems.append("no headline typed")
        records.append({
            "source_file": str((dest / f.name).relative_to(PIPE)),
            "source_offset": 0,
            "source_publication": meta.get("publication") or None,
            "source_date": date,
            "source_date_raw": meta.get("date") or None,
            "source_title": meta.get("title") or None,
            # Typed citation fields, authoritative over anything a scan could find.
            "source_author": meta.get("author") or None,
            "source_url": meta.get("url") or None,
            "body_text": text,
            "problems": problems,
        })
    return records


def cmd_ingest(args: argparse.Namespace) -> None:
    from ..add import measured_rate, uncached
    from ..extract.prompt import MODEL
    from ..ingest.collect import collect
    from ..ingest.parse import coverage, parse_file
    from ..tabular.load import inspect

    batch = load_batch(args.batch)
    batch["state"] = "ingesting"
    batch["error"] = None
    save_batch(batch)
    try:
        label = f"web-{batch['id']}"
        staged = batch_dir(batch["id"]) / "incoming" / "files"

        files: list[dict[str, Any]] = []
        manifest = {"copied": [], "duplicates": [], "skipped": []}
        if staged.exists() and any(staged.iterdir()):
            manifest = collect(staged, label)

        for item in manifest["copied"]:
            files.append({"name": item["source_file"].split("/")[-1], "kind": "article",
                          "bytes": item["bytes"]})
        for item in manifest["duplicates"]:
            files.append({"name": item["path"], "kind": "duplicate",
                          "note": f"identical bytes to {item['same_as']} — parsed once"})
        for item in manifest["skipped"]:
            name = item["path"]
            if Path(name).suffix.lower() in TABLE_SUFFIXES:
                files.append({"name": name, "kind": "table"})
            else:
                files.append({"name": name, "kind": "skipped", "note": item["reason"]})

        # Parse this batch's article files only — never the whole raw/ tree. Pasted files
        # are excluded from the header scan; their records are built from typed fields.
        results = []
        label_dir = RAW / label
        if label_dir.exists():
            for p in sorted(label_dir.rglob("*")):
                if (p.is_file() and p.suffix.lower() in ARTICLE_SUFFIXES
                        and "pasted" not in p.relative_to(label_dir).parts):
                    results.append(parse_file(p, str(p.relative_to(PIPE))))
        articles = [a for r in results for a in r["articles"]]
        unreadable = [{"source_file": r["source_file"], "error": r["error"]}
                      for r in results if r["error"]]
        articles += _pasted_records(batch, label)

        # Citation capture: what the export itself prints (Author / Database / URL lines),
        # read deterministically — typed fields on pasted articles are never overwritten.
        # Every record gets the access date; it is the one field this run actually knows.
        from ..cite import attach_citations
        attach_citations(articles, PIPE)
        accessed = dt.datetime.now(dt.timezone.utc).date().isoformat()
        for a in articles:
            a.setdefault("source_accessed", accessed)

        usable = sum(1 for a in articles
                     if a.get("body_text") and all(a.get(f) for f in REQUIRED_PROVENANCE))
        cov = coverage(results) if results else {"text_retained": 1.0, "body_share": 1.0}

        (batch_dir(batch["id"]) / "articles.json").write_text(json.dumps(articles, indent=2))

        # Tables: headers + samples now, so the mapping UI has something to draw.
        for f in (sorted(staged.rglob("*")) if staged.exists() else []):
            if f.is_file() and f.suffix.lower() in TABLE_SUFFIXES:
                try:
                    batch["tables"][f.name] = {"inspect": inspect(f), "mapping": None,
                                               "summary": None}
                except SystemExit as exc:
                    batch["tables"][f.name] = {"error": str(exc)}

        # The quote, priced with add.py's own logic against the measured rate. Free: the
        # session is constructed for cache-path resolution and makes no request.
        withtext = [a for a in articles if a.get("body_text")]
        todo = uncached(withtext, MODEL) if withtext else []
        rate = measured_rate()
        quote = {
            "articles": len(articles),
            "no_body": len(articles) - len(withtext),
            "already_cached": len(withtext) - len(todo),
            "billable": len(todo),
            "rate_per_article": round(rate[0], 4) if rate else None,
            "rate_basis_articles": rate[1] if rate else None,
            "estimate_usd": round(rate[0] * len(todo), 2) if rate else None,
        }

        batch.update({
            "files": files,
            "parse": {
                "files_seen": len(results),
                "unreadable": unreadable,
                "articles": len(articles),
                "usable": usable,
                "text_retained": round(cov["text_retained"], 4),
                "body_share": round(cov["body_share"], 4),
            },
            "quote": quote,
            "state": "quoted",
        })
        save_batch(batch)
        _out(batch)
    except BaseException as exc:
        _fail_batch(batch, f"{type(exc).__name__}: {exc}")
        raise


# ── tables ─────────────────────────────────────────────────────────────────────

def cmd_map_table(args: argparse.Namespace) -> None:
    from ..tabular.load import map_rows

    batch = load_batch(args.batch)
    staged = batch_dir(batch["id"]) / "incoming" / "files"
    path = staged / args.file
    if not path.exists() or path.suffix.lower() not in TABLE_SUFFIXES:
        raise SystemExit(f"no such table in this batch: {args.file}")

    mapping = json.load(sys.stdin)
    result = map_rows(path, mapping, batch_id=batch["id"])

    (batch_dir(batch["id"]) / f"tabular_{args.file}.json").write_text(
        json.dumps(result, indent=2))
    batch["tables"].setdefault(args.file, {})
    batch["tables"][args.file]["mapping"] = mapping
    batch["tables"][args.file]["summary"] = {
        "counts": result["counts"], "total_rows": result["total_rows"]}

    # events_tabular.json is rebuilt from every mapped table in the batch, so re-mapping
    # a file replaces its rows instead of stacking them.
    events: list[dict[str, Any]] = []
    for name, t in batch["tables"].items():
        if t.get("mapping"):
            saved = batch_dir(batch["id"]) / f"tabular_{name}.json"
            if saved.exists():
                events += json.loads(saved.read_text())["events"]
    (batch_dir(batch["id"]) / "events_tabular.json").write_text(json.dumps(events, indent=2))

    save_batch(batch)
    _out({"batch": batch["id"], "file": args.file, "counts": result["counts"],
          "total_rows": result["total_rows"],
          "results": result["results"], "events": len(events)})


# ── extract: the ONLY paid stage ───────────────────────────────────────────────

def _snippet(body: str, needle: str | None, width: int = 160) -> str | None:
    if not body or not needle:
        return None
    at = body.lower().find(needle.lower())
    if at < 0:
        return None
    lo, hi = max(0, at - width), min(len(body), at + len(needle) + width)
    return ("…" if lo else "") + body[lo:hi].replace("\n", " ") + ("…" if hi < len(body) else "")


def cmd_extract(args: argparse.Namespace) -> None:
    import os

    from ..add import usd
    from ..common.http import PoliteSession
    from ..extract.prompt import MODEL
    from ..extract.run import run as extract_run

    if not (os.environ.get("ANTHROPIC_API_KEY") or "").strip():
        raise SystemExit("ANTHROPIC_API_KEY is not set — extraction is the paid stage and "
                         "cannot run without it")

    batch = load_batch(args.batch)
    art_path = batch_dir(batch["id"]) / "articles.json"
    if not art_path.exists():
        raise SystemExit(f"batch {batch['id']} has no parsed articles — run ingest first")
    articles = [a for a in json.loads(art_path.read_text()) if a.get("body_text")]
    if not articles:
        raise SystemExit(f"batch {batch['id']}: no articles with body text to extract")

    with RunLock():
        batch["state"] = "extracting"
        batch["error"] = None
        batch["extract"] = {"started_at": dt.datetime.now(dt.timezone.utc)
                            .isoformat(timespec="seconds")}
        save_batch(batch)
        try:
            r = extract_run(articles,
                            session=PoliteSession("extract", min_interval_s=0.25),
                            model=MODEL, progress_every=1)

            # Citation fields ride in extras.citation — the sanctioned open field, so the
            # event schema and the (cached, paid) extraction payloads stay byte-identical.
            from ..cite import citation_from_article
            for ev in r["events"]:
                art = next((a for a in articles
                            if a["source_file"] == ev["source_file"]
                            and (a.get("source_title") == ev.get("source_title")
                                 or len(articles) == 1)), None)
                cit = citation_from_article(art) if art else {}
                if cit:
                    ev["extras"] = {**(ev.get("extras") or {}), "citation": cit}

            bdir = batch_dir(batch["id"])
            (bdir / "events_articles.json").write_text(json.dumps(r["events"], indent=2))
            (bdir / "rejected.json").write_text(json.dumps(r["rejected"], indent=2))
            (bdir / "extract_report.json").write_text(json.dumps(
                {k: v for k, v in r.items() if k not in ("events", "rejected")}, indent=2))

            snippets = {}
            for ev in r["events"]:
                body = next((a["body_text"] for a in articles
                             if a["source_file"] == ev["source_file"]
                             and (a.get("source_title") == ev.get("source_title")
                                  or len(articles) == 1)), "")
                snip = (_snippet(body, ev.get("venue_name_as_written"))
                        or _snippet(body, ev.get("operator")))
                if snip:
                    snippets[ev["event_id"]] = snip
            (bdir / "snippets.json").write_text(json.dumps(snippets, indent=2))

            billed = [a for a in r["per_article"] if not a.get("cached") and not a.get("error")]
            failed = [a for a in r["per_article"] if a.get("error")]
            batch["extract"].update({
                "finished_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                "articles": len(articles),
                "events": len(r["events"]),
                "rejected": len(r["rejected"]),
                "needs_review": sum(1 for e in r["events"] if e.get("needs_review")),
                "venue_matched": sum(1 for e in r["events"] if e.get("venue_id")),
                "cache_hits": r["cache_hits"],
                "billed_articles": len(billed),
                "billed_usd": round(sum(usd(a.get("usage") or {}) for a in billed), 4),
                "failed": len(failed),
            })
            batch["state"] = "extracted"
            save_batch(batch)
            _out(batch)
        except BaseException as exc:
            _fail_batch(batch, f"{type(exc).__name__}: {exc}")
            raise


# ── review helpers ─────────────────────────────────────────────────────────────

def cmd_exclude(args: argparse.Namespace) -> None:
    batch = load_batch(args.batch)
    known = {e["event_id"] for e in store.load_events(batch["id"], "events_articles.json")}
    known |= {e["event_id"] for e in store.load_events(batch["id"], "events_tabular.json")}
    if args.event not in known:
        raise SystemExit(f"no event {args.event} in batch {batch['id']}")
    rows = batch["excluded_by_reviewer"]
    if args.undo:
        batch["excluded_by_reviewer"] = [x for x in rows if x["event_id"] != args.event]
    elif not any(x["event_id"] == args.event for x in rows):
        rows.append({"event_id": args.event,
                     "reason": args.reason or "excluded by reviewer",
                     "at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")})
    save_batch(batch)
    _out({"batch": batch["id"], "excluded": batch["excluded_by_reviewer"]})


def cmd_detail(args: argparse.Namespace) -> None:
    batch = load_batch(args.batch)
    bdir = batch_dir(batch["id"])
    tabular_results = {}
    for name in batch.get("tables", {}):
        saved = bdir / f"tabular_{name}.json"
        if saved.exists():
            d = json.loads(saved.read_text())
            tabular_results[name] = {"counts": d["counts"], "results": d["results"]}
    _out({
        "batch": batch,
        "events_articles": store.load_events(batch["id"], "events_articles.json"),
        "events_tabular": store.load_events(batch["id"], "events_tabular.json"),
        "rejected": store.load_events(batch["id"], "rejected.json"),
        "snippets": json.loads((bdir / "snippets.json").read_text())
        if (bdir / "snippets.json").exists() else {},
        "tabular_results": tabular_results,
    })


def cmd_list(args: argparse.Namespace) -> None:
    out = []
    for b in list_batches():
        out.append({k: b.get(k) for k in
                    ("id", "created_at", "note", "state", "parse", "quote", "extract",
                     "approved_content", "published_at", "error")}
                   | {"tables": {n: t.get("summary") for n, t in (b.get("tables") or {}).items()},
                      "excluded": len(b.get("excluded_by_reviewer") or []),
                      "files": len(b.get("files") or []), "pasted": len(b.get("pasted") or [])})
    _out(out)


def cmd_browse(args: argparse.Namespace) -> None:
    """Everything the store holds, read-only, for the /review data browser.

    Published events come from `output/contract_events.json` — the exact file the last
    publish built the map from, not a recomputation that could quietly disagree with it.
    Each row is labelled with where it came from: `baseline` (the committed pre-web
    corpus), the batch id that published it, or `untracked` if it is in neither — a state
    that should not exist and is therefore said out loud rather than papered over.
    """
    canonical_path = OUT / "contract_events.json"
    if not canonical_path.exists():
        raise SystemExit(f"no canonical event file at {canonical_path} — publish has "
                         "never run here")
    canonical = json.loads(canonical_path.read_text())
    baseline_ids = {e["event_id"] for e in load_baseline()}

    batches = list_batches()
    # event_id -> publishing batch, for provenance. Approved batches only: an event in a
    # discarded or unapproved batch is not on the map and must not be labelled as if it were.
    batch_of: dict[str, str] = {}
    for b in batches:
        if b.get("approved_content") and b.get("state") != "discarded":
            for e in kept_events(b):
                batch_of.setdefault(e["event_id"], b["id"])

    events = []
    for e in canonical:
        eid = e.get("event_id")
        extras = e.get("extras") or {}
        events.append({
            "event_id": eid,
            "origin": "baseline" if eid in baseline_ids else batch_of.get(eid, "untracked"),
            "operator": e.get("operator"),
            "operator_normalized": e.get("operator_normalized"),
            "sub_brand": e.get("sub_brand"),
            "venue_id": e.get("venue_id"),
            "venue_name_as_written": e.get("venue_name_as_written"),
            "institution": e.get("institution"),
            "event_type": e.get("event_type"),
            "event_date": e.get("event_date"),
            "date_precision": e.get("date_precision"),
            "contract_value_usd": e.get("contract_value_usd"),
            "extraction_confidence": e.get("extraction_confidence"),
            "needs_review": e.get("needs_review"),
            "notes": e.get("notes"),
            "source_publication": e.get("source_publication"),
            "source_date": e.get("source_date"),
            "source_title": e.get("source_title"),
            "source_file": e.get("source_file"),
            "citation": extras.get("citation") or None,
        })

    # Exclusions and rejected rows, joined back to their display fields per batch.
    exclusions, rejected = [], []
    for b in batches:
        if b.get("state") == "corrupt":
            continue
        rows = {e["event_id"]: e for e in store.load_events(b["id"], "events_articles.json")}
        rows |= {e["event_id"]: e for e in store.load_events(b["id"], "events_tabular.json")}
        for x in b.get("excluded_by_reviewer") or []:
            e = rows.get(x["event_id"], {})
            exclusions.append({
                "batch": b["id"], "event_id": x["event_id"], "reason": x.get("reason"),
                "at": x.get("at"), "operator": e.get("operator"),
                "venue_name_as_written": e.get("venue_name_as_written"),
                "event_type": e.get("event_type"), "event_date": e.get("event_date"),
                "source_title": e.get("source_title"),
            })
        for r in store.load_events(b["id"], "rejected.json"):
            rejected.append({
                "batch": b["id"], "kind": "extraction",
                "problems": r.get("problems") or [],
                "detail": (r.get("event") or {}),
            })
        bdir = batch_dir(b["id"])
        for name in (b.get("tables") or {}):
            saved = bdir / f"tabular_{name}.json"
            if not saved.exists():
                continue
            d = json.loads(saved.read_text())
            for r in d.get("results", []):
                if r.get("outcome") == "rejected":
                    rejected.append({
                        "batch": b["id"], "kind": "csv", "file": name,
                        "row": r.get("row"), "venue": r.get("venue"),
                        "operator": r.get("operator"),
                        "problems": [r.get("reason") or "failed schema validation"],
                    })

    batch_rows = []
    for b in batches:
        batch_rows.append({k: b.get(k) for k in
                           ("id", "created_at", "note", "state", "parse", "quote",
                            "extract", "approved_content", "published_at", "error")}
                          | {"excluded": len(b.get("excluded_by_reviewer") or []),
                             "tables": {n: (t or {}).get("summary")
                                        for n, t in (b.get("tables") or {}).items()}})

    _out({
        "events": events,
        "counts": {
            "events": len(events),
            "baseline": sum(1 for e in events if e["origin"] == "baseline"),
            "from_batches": sum(1 for e in events
                                if e["origin"] not in ("baseline", "untracked")),
            "untracked": sum(1 for e in events if e["origin"] == "untracked"),
            "mapped": sum(1 for e in events if e["venue_id"]),
        },
        "batches": batch_rows,
        "exclusions": exclusions,
        "rejected": rejected,
    })


def cmd_discard(args: argparse.Namespace) -> None:
    batch = load_batch(args.batch)
    batch["state"] = "discarded"
    batch["approved_content"] = False
    save_batch(batch)
    _out(batch)


# ── publish: baseline + approved batches -> the map ────────────────────────────

def cmd_publish(args: argparse.Namespace) -> None:
    from ..emit.records import emit
    from ..spans.pair import pair

    with RunLock():
        if args.batch:
            batch = load_batch(args.batch)
            if batch["state"] not in ("extracted", "quoted", "published"):
                raise SystemExit(f"batch {batch['id']} is {batch['state']} — nothing "
                                 "reviewed to publish")
            if not kept_events(batch):
                raise SystemExit(f"batch {batch['id']} has no kept events — extract or map "
                                 "something first, or discard it")
            batch["approved_content"] = True
            save_batch(batch)

        baseline = load_baseline()
        merged = list(baseline)
        seen = {e["event_id"] for e in baseline}
        included = []
        for b in list_batches():
            if not b.get("approved_content") or b.get("state") == "discarded":
                continue
            kept, dupes = [], 0
            for e in kept_events(b):
                if e["event_id"] in seen:
                    dupes += 1
                    continue
                seen.add(e["event_id"])
                kept.append(e)
            merged += kept
            included.append({"id": b["id"], "events": len(kept), "duplicates": dupes,
                             "excluded_by_reviewer": len(b.get("excluded_by_reviewer") or [])})

        # The canonical file: committed baseline + approved batches. NEVER derived from
        # articles.json — on this server that file holds only the latest upload, and
        # regenerating from it is the documented map-wiping hazard.
        (OUT / "contract_events.json").write_text(json.dumps(merged, indent=2))

        paired = pair(merged)
        (OUT / "tenure_records.json").write_text(json.dumps(paired["tenure"], indent=2))
        emitted = emit(None)

        published_to = []
        for dest in (CONSOLE / "public" / "data", CONSOLE / "dist" / "data"):
            if dest.parent.exists():
                dest.mkdir(parents=True, exist_ok=True)
                for name in PUBLISH_FILES:
                    shutil.copy2(OUT / name, dest / name)
                published_to.append(str(dest.relative_to(PIPE.parent)))

        now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        for meta in included:
            b = load_batch(meta["id"])
            b["published_at"] = now
            b["state"] = "published"
            save_batch(b)

        _out({
            "baseline_events": len(baseline),
            "batches": included,
            "merged_events": len(merged),
            "pair": paired["stats"],
            "tenure_features": emitted["tenure"]["features"],
            "event_features": emitted["events"]["features"],
            "published": PUBLISH_FILES,
            "published_to": published_to,
            "untouched": "venues, federal, ACS and the audit figure — this command does "
                         "not produce them",
        })


# ── entry ──────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(prog="pipeline.webqueue", description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("create").set_defaults(fn=cmd_create)

    p = sub.add_parser("ingest")
    p.add_argument("--batch", required=True)
    p.set_defaults(fn=cmd_ingest)

    p = sub.add_parser("map-table")
    p.add_argument("--batch", required=True)
    p.add_argument("--file", required=True)
    p.set_defaults(fn=cmd_map_table)

    p = sub.add_parser("extract")
    p.add_argument("--batch", required=True)
    p.set_defaults(fn=cmd_extract)

    p = sub.add_parser("exclude")
    p.add_argument("--batch", required=True)
    p.add_argument("--event", required=True)
    p.add_argument("--reason", default="")
    p.add_argument("--undo", action="store_true")
    p.set_defaults(fn=cmd_exclude)

    p = sub.add_parser("detail")
    p.add_argument("--batch", required=True)
    p.set_defaults(fn=cmd_detail)

    sub.add_parser("list").set_defaults(fn=cmd_list)

    sub.add_parser("browse").set_defaults(fn=cmd_browse)

    p = sub.add_parser("discard")
    p.add_argument("--batch", required=True)
    p.set_defaults(fn=cmd_discard)

    p = sub.add_parser("publish")
    p.add_argument("--batch", default=None,
                   help="approve this batch's content, then rebuild from baseline + all "
                        "approved batches")
    p.set_defaults(fn=cmd_publish)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
