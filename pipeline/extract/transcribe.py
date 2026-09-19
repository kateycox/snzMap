"""Paid fallback for scans local OCR could not read: Claude-vision transcription.

This is the system's second paid stage (the first is `extract.run`), and it follows the
same rules: it exists only behind Gate-1 approval, it is quoted before it runs, it uses
the one existing API key, and its responses are cached by payload hash (`raw/transcribe/`)
so re-running a paid transcription is free. It is never automatic — the review screen
offers it per file, priced per page, and a person clicks.

The transcription is stored as `text_source: "vision"` — honest provenance, distinct
from `"ocr"` (local tesseract) and `"native"` (the file carried its own text). The model
is the same one extraction uses; introducing a second model id for this would add a
config knob without a measured reason.

The quote is an estimate and says so: input tokens are the API's documented
pixels/750 rule against the rasterized page (capped at the ~1.15-megapixel resize the
API applies), output is assumed at 1,000 tokens/page — roughly a full newspaper-column
page of text. Actual cost is measured from the response usage and reported next to the
estimate, same as extraction.
"""

from __future__ import annotations

import base64
import io
import json
import sys
from pathlib import Path
from typing import Any

from ..common.http import PoliteSession
from ..ingest.ocr import _pages_of
from .prompt import MODEL
from .run import ENDPOINT, PRICE_PER_MTOK, _auth_headers

MAX_IMAGE_PX = 1_150_000          # the API downscales past ~1.15 MP; tokens cap there
TOKENS_PER_PX = 1 / 750           # documented vision pricing rule
EST_OUTPUT_TOKENS_PER_PAGE = 1000  # assumption, stated in the quote basis
MAX_TOKENS = 8000

INSTRUCTION = (
    "Transcribe every word of this scanned newspaper/document page, exactly as printed, "
    "in reading order. Keep headlines, bylines, and paragraph breaks. Do not summarize, "
    "do not correct spelling, do not add anything that is not printed on the page. If a "
    "region is illegible, write [illegible] rather than guessing."
)


def quote_pages(pages_px: list[int]) -> dict[str, Any]:
    """Deterministic per-page estimate from page pixel counts (measured at OCR time)."""
    est = 0.0
    for px in pages_px:
        tokens_in = min(px, MAX_IMAGE_PX) * TOKENS_PER_PX
        est += (tokens_in * PRICE_PER_MTOK["input"]
                + EST_OUTPUT_TOKENS_PER_PAGE * PRICE_PER_MTOK["output"]) / 1_000_000
    return {
        "pages": len(pages_px),
        "est_usd": round(est, 2),
        "basis": f"pixels/750 input + {EST_OUTPUT_TOKENS_PER_PAGE} output tokens/page "
                 f"at the {MODEL} rates — an estimate, not a bill",
    }


def _png_b64(img) -> str:
    if img.mode not in ("L", "RGB"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _check(text: str) -> None:
    resp = json.loads(text)
    if resp.get("type") == "error":
        raise ValueError(f"api error: {resp.get('error', {}).get('message')}")
    if resp.get("stop_reason") == "max_tokens":
        raise ValueError(f"truncated at max_tokens={MAX_TOKENS}")
    if not any(b.get("type") == "text" for b in resp.get("content", [])):
        raise ValueError("no text block in response")


def usd(usage: dict[str, int]) -> float:
    p = PRICE_PER_MTOK
    return (usage.get("input_tokens", 0) * p["input"]
            + usage.get("output_tokens", 0) * p["output"]
            + usage.get("cache_creation_input_tokens", 0) * p["cache_write"]
            + usage.get("cache_read_input_tokens", 0) * p["cache_read"]) / 1_000_000


def transcribe_scan(path: Path, label: str) -> dict[str, Any]:
    """Every page of `path` through the model. Requires ANTHROPIC_API_KEY; responses are
    cached under raw/transcribe/, so a re-run after a crash pays only for what is new."""
    headers = _auth_headers(required=True)
    session = PoliteSession("transcribe", min_interval_s=0.25)

    texts: list[str] = []
    total = {"input_tokens": 0, "output_tokens": 0,
             "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}
    pages = _pages_of(path)
    for i, img in enumerate(pages, 1):
        payload = {
            "model": MODEL,
            "max_tokens": MAX_TOKENS,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png",
                                                 "data": _png_b64(img)}},
                    {"type": "text", "text": INSTRUCTION},
                ],
            }],
        }
        # Progress to stderr: stdout is the JSON protocol when run via pipeline.webqueue.
        print(f"  transcribing page {i}/{len(pages)} of {path.name}…",
              file=sys.stderr, flush=True)
        body = session.post_json(ENDPOINT, payload=payload, headers=headers,
                                 label=f"{label}-p{i}", validate=_check)
        resp = json.loads(body)
        for k in total:
            total[k] += resp.get("usage", {}).get(k, 0) or 0
        texts.append("\n".join(b["text"] for b in resp["content"]
                               if b.get("type") == "text").strip())

    return {
        "text": "\n\n".join(t for t in texts if t),
        "pages": len(pages),
        "usage": total,
        "usd": round(usd(total), 4),
    }
