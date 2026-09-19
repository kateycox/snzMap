"""Copy article files off the USB into `articles/raw/`, hash them, log every one.

The USB is treated as read-only evidence. Nothing here opens a file for writing on the
source volume, and nothing deletes or renames. If a later stage corrupts something, the
recovery path is to re-run this against a drive that was never touched.

Files land under `articles/raw/<source_label>/` keeping their original relative path, so
`source_file` in a contract event points at a real file a person can open and read. That is
the whole point of the field: an event nobody can trace back is not evidence.

    .venv/bin/python -m pipeline.ingest.collect /Volumes/USB/articles --label usb1
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "articles" / "raw"
OUT = ROOT / "output"

# Extensions worth copying. Everything else is listed in the manifest as skipped rather than
# silently ignored — a .doc full of articles that nobody noticed is a hole in the corpus.
ARTICLE_SUFFIXES = {".txt", ".text", ".htm", ".html", ".rtf", ".pdf", ".docx"}

# Scan formats the web queue also collects (stored + hashed first, then OCR — see
# ingest/ocr.py). The laptop path deliberately does NOT pass these: pipeline.add has no
# OCR step, so a copied-but-unparsed image would be a silent skip. There they stay in
# the manifest's skipped list, which is the honest outcome for a path that cannot read
# them.
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp"}

# Volume noise. These are not articles and clutter the skipped list.
IGNORE_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini", ".Spotlight-V100", ".Trashes"}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def collect(source: Path, label: str, dry_run: bool = False,
            extra_suffixes: set[str] | None = None) -> dict:
    """Walk `source`, copy article files under `articles/raw/<label>/`.

    `extra_suffixes` lets the web queue also collect scan images (IMAGE_SUFFIXES) —
    stored and hashed exactly like articles, read later by OCR."""
    if not source.exists():
        raise SystemExit(f"source not found: {source}")

    wanted = ARTICLE_SUFFIXES | (extra_suffixes or set())
    dest_root = RAW / label
    copied, skipped, duplicates = [], [], []
    seen: dict[str, str] = {}

    for path in sorted(p for p in source.rglob("*") if p.is_file()):
        if path.name in IGNORE_NAMES or path.name.startswith("._"):
            continue
        rel = path.relative_to(source)
        if path.suffix.lower() not in wanted:
            skipped.append({"path": str(rel), "reason": f"unhandled suffix {path.suffix!r}"})
            continue

        digest = sha256(path)
        if digest in seen:
            # Exports get re-run and re-saved. Same bytes = same file, whatever it is named.
            duplicates.append({"path": str(rel), "same_as": seen[digest], "sha256": digest})
            continue
        seen[digest] = str(rel)

        dest = dest_root / rel
        if not dry_run:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dest)
        copied.append(
            {
                "source_file": str(dest.relative_to(ROOT)),
                "original_path": str(path),
                "sha256": digest,
                "bytes": path.stat().st_size,
                "suffix": path.suffix.lower(),
            }
        )

    manifest = {
        "label": label,
        "source": str(source),
        "collected_at": dt.datetime.now().isoformat(timespec="seconds"),
        "dry_run": dry_run,
        "copied": copied,
        "duplicates": duplicates,
        "skipped": skipped,
    }
    if not dry_run:
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / f"ingest_manifest_{label}.json").write_text(json.dumps(manifest, indent=2))
    return manifest


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("source", type=Path, help="directory on the USB to walk")
    ap.add_argument("--label", default="usb1", help="subfolder under articles/raw/")
    ap.add_argument("--dry-run", action="store_true", help="report without copying")
    args = ap.parse_args()

    m = collect(args.source, args.label, args.dry_run)
    by_suffix: dict[str, int] = {}
    for f in m["copied"]:
        by_suffix[f["suffix"]] = by_suffix.get(f["suffix"], 0) + 1

    print(f"\nINGEST {m['source']} -> articles/raw/{args.label}/")
    print(f"  copied     {len(m['copied'])}  {by_suffix or ''}")
    print(f"  duplicates {len(m['duplicates'])} (identical bytes)")
    print(f"  skipped    {len(m['skipped'])}")
    for s in m["skipped"][:10]:
        print(f"    - {s['path']}  ({s['reason']})")
    if len(m["skipped"]) > 10:
        print(f"    ... {len(m['skipped']) - 10} more")
    if m["dry_run"]:
        print("\n  dry run — nothing was written")


if __name__ == "__main__":
    main()
