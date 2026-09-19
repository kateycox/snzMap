"""Free local OCR for scans: image files, and PDFs with no text layer.

The rule this module exists to serve (ACCESS_OCR_SPEC.md): **never refuse a scan.**
`formats.from_pdf` still raises on a textless PDF and images still have no `to_text`
adapter — that refusal-at-the-door is correct for the laptop parse path, where a scan
appearing as "processed" with an empty body would hide a third of the corpus. The web
queue instead routes those files here, so every scan is stored and read (or honestly
reported unreadable) instead of bounced.

Tesseract is the engine (apt `tesseract-ocr`, driven through pytesseract; `ocrmypdf`
is also installed in the venv for hand-run repair jobs). PDFs are rasterized with
`pdftoppm` at 300 dpi and OCR'd page by page, same as images, so both paths produce
identical measurements. Two tesseract passes per page on purpose: `image_to_string`
for text with real line structure, `image_to_data` for per-word confidence — the
reconstructed-from-TSV text loses paragraph shape, and a body a person cannot read is
much harder to check.

The usable rule — one deterministic gate, stated here and surfaced (not just
pass/fail) in the review row:

    usable   =  mean word confidence >= 55   AND   >= 40 recognized words

55 is below tesseract's typical 80-95 on a clean scan and above the 0-30 noise floor
it produces on photographs and halftone images; 40 words is the floor under which a
"read" of a newspaper page cannot be an article (a headline alone is ~10). A usable
result with mean confidence under 75 is additionally flagged `low_confidence` — kept,
never dropped, but marked so the extracted rows get checked against the image.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path
from typing import Any

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp"}

USABLE_MEAN_CONF = 55.0
USABLE_MIN_WORDS = 40
FLAG_MEAN_CONF = 75.0
RASTER_DPI = 300


class OcrUnavailable(Exception):
    """Tesseract or its Python driver is missing — an environment problem, named."""


def _tesseract():
    try:
        import pytesseract
        return pytesseract
    except ImportError as exc:  # pragma: no cover - environment problem, not data
        raise OcrUnavailable("pytesseract is not installed in the pipeline venv") from exc


def _ocr_one(img) -> dict[str, Any]:
    """One page: text with layout, plus measured per-word confidence."""
    pytesseract = _tesseract()
    if img.mode not in ("L", "RGB"):
        img = img.convert("RGB")
    text = pytesseract.image_to_string(img)
    data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
    confs = [float(c) for c, w in zip(data["conf"], data["text"])
             if (w or "").strip() and float(c) >= 0]
    return {
        "text": text.strip(),
        "words": len(confs),
        "mean_conf": round(sum(confs) / len(confs), 1) if confs else 0.0,
        "px": img.width * img.height,
    }


def _pages_of(path: Path) -> list[Any]:
    """PIL images for every page of `path` — frames of a TIFF, pages of a PDF via
    pdftoppm, or the single image. Caller must keep the returned context usable; images
    are loaded into memory before temp files vanish."""
    from PIL import Image, ImageSequence

    suffix = path.suffix.lower()
    if suffix == ".pdf":
        pages = []
        with tempfile.TemporaryDirectory() as td:
            subprocess.run(
                ["pdftoppm", "-r", str(RASTER_DPI), "-png", str(path), f"{td}/page"],
                check=True, capture_output=True, timeout=600)
            for p in sorted(Path(td).glob("page*.png")):
                with Image.open(p) as img:
                    pages.append(img.copy())
        return pages
    with Image.open(path) as img:
        return [frame.copy() for frame in ImageSequence.Iterator(img)]


def run_ocr(path: Path) -> dict[str, Any]:
    """OCR every page of a scan and measure the result against the usable rule.

    Never raises on bad content — an unreadable page is a result, not an error. Raises
    only on real environment/tooling failures, which the caller records as such.
    """
    pages = _pages_of(path)
    per_page = [_ocr_one(img) for img in pages]

    words = sum(p["words"] for p in per_page)
    # Weighted by words, so a blank second page cannot drag a clean front page under.
    mean_conf = (round(sum(p["mean_conf"] * p["words"] for p in per_page) / words, 1)
                 if words else 0.0)
    text = "\n\n".join(p["text"] for p in per_page if p["text"])

    usable = mean_conf >= USABLE_MEAN_CONF and words >= USABLE_MIN_WORDS
    return {
        "text": text,
        "page_count": len(per_page),
        "pages": [{"page": i, "mean_conf": p["mean_conf"], "words": p["words"],
                   "px": p["px"]} for i, p in enumerate(per_page, 1)],
        "words": words,
        "mean_conf": mean_conf,
        "usable": usable,
        "low_confidence": usable and mean_conf < FLAG_MEAN_CONF,
    }
