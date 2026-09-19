"""Per-batch working state for the web upload queue.

One directory per batch under `webqueue/data/`, holding everything about that batch and
nothing about any other: the uploaded bytes, the parsed articles, the extracted events,
and the reviewer's exclusions. The canonical `output/contract_events.json` is never one of
these files — it is rebuilt at publish time as baseline + approved batches, which is the
merge design that keeps a new upload from wiping the 178 committed events (see
UPLOAD_BUILD_SPEC.md, "Critical hazard").

Excluded rows are tagged and kept, never deleted. That is Elian's rule and it is enforced
here by construction: `exclude_event` appends to a list in batch.json; nothing in this
module removes an event from an events file.
"""

from __future__ import annotations

import datetime as dt
import fcntl
import json
import secrets
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent          # pipeline/
DATA = Path(__file__).resolve().parent / "data"        # pipeline/webqueue/data/
BASELINE = Path(__file__).resolve().parent / "baseline_contract_events.json"

# Article formats the ingest stage reads. Tables are handled by pipeline.tabular; anything
# else is listed as skipped with the reason, never silently ignored.
ARTICLE_SUFFIXES = {".txt", ".text", ".htm", ".html", ".rtf", ".pdf", ".docx"}
TABLE_SUFFIXES = {".csv", ".xlsx"}


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def new_batch_id() -> str:
    return dt.date.today().isoformat() + "-" + secrets.token_hex(3)


def batch_dir(batch_id: str) -> Path:
    # The id becomes a path segment; refuse anything that could escape data/.
    if not batch_id or "/" in batch_id or batch_id.startswith("."):
        raise SystemExit(f"bad batch id: {batch_id!r}")
    return DATA / batch_id


def batch_file(batch_id: str) -> Path:
    return batch_dir(batch_id) / "batch.json"


def load_batch(batch_id: str) -> dict[str, Any]:
    p = batch_file(batch_id)
    if not p.exists():
        raise SystemExit(f"no such batch: {batch_id}")
    return json.loads(p.read_text())


def save_batch(batch: dict[str, Any]) -> None:
    batch["updated_at"] = _now()
    p = batch_file(batch["id"])
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(batch, indent=2))
    tmp.replace(p)


def create_batch(note: str = "", pasted: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    batch = {
        "id": new_batch_id(),
        "created_at": _now(),
        "note": note,
        "state": "new",
        "files": [],
        "pasted": pasted or [],
        "parse": None,
        "quote": None,
        "tables": {},
        "extract": None,
        "excluded_by_reviewer": [],
        "approved_content": False,
        "published_at": None,
        "error": None,
    }
    (batch_dir(batch["id"]) / "incoming").mkdir(parents=True, exist_ok=True)
    save_batch(batch)
    return batch


def list_batches() -> list[dict[str, Any]]:
    if not DATA.exists():
        return []
    out = []
    for d in sorted(DATA.iterdir(), reverse=True):
        f = d / "batch.json"
        if f.exists():
            try:
                out.append(json.loads(f.read_text()))
            except json.JSONDecodeError:
                out.append({"id": d.name, "state": "corrupt", "error": "unreadable batch.json"})
    return out


def load_events(batch_id: str, name: str) -> list[dict[str, Any]]:
    p = batch_dir(batch_id) / name
    return json.loads(p.read_text()) if p.exists() else []


def kept_events(batch: dict[str, Any]) -> list[dict[str, Any]]:
    """Every extracted/mapped event in the batch minus the reviewer's exclusions.

    The excluded rows stay in the batch files with their reasons; they are simply not
    carried into the canonical merge.
    """
    excluded = {x["event_id"] for x in batch.get("excluded_by_reviewer", [])}
    rows = load_events(batch["id"], "events_articles.json") \
        + load_events(batch["id"], "events_tabular.json")
    return [e for e in rows if e["event_id"] not in excluded]


def load_baseline() -> list[dict[str, Any]]:
    """The committed pre-web corpus. If this file is missing something is badly wrong and
    publishing must stop — rebuilding from whatever articles.json holds is exactly the
    map-wiping path the merge design exists to prevent."""
    if not BASELINE.exists():
        raise SystemExit(
            f"baseline missing: {BASELINE}\n"
            "  Refusing to publish. The canonical event file is baseline + approved "
            "batches;\n  without the baseline a publish would wipe the pre-web corpus.")
    events = json.loads(BASELINE.read_text())
    if not isinstance(events, list) or not events:
        raise SystemExit(f"baseline unreadable or empty: {BASELINE} — refusing to publish")
    return events


class RunLock:
    """One pipeline mutation at a time. Extraction and publish both write shared files
    under output/, and two interleaved runs would corrupt both. flock, so a crashed
    process releases it on exit."""

    def __init__(self) -> None:
        DATA.mkdir(parents=True, exist_ok=True)
        self.path = DATA / ".lock"
        self.fh = None

    def __enter__(self) -> "RunLock":
        self.fh = self.path.open("w")
        try:
            fcntl.flock(self.fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit("another extraction or publish is already running — try again "
                             "when it finishes")
        self.fh.write(f"{dt.datetime.now().isoformat()}\n")
        self.fh.flush()
        return self

    def __exit__(self, *exc: Any) -> None:
        if self.fh:
            fcntl.flock(self.fh, fcntl.LOCK_UN)
            self.fh.close()
