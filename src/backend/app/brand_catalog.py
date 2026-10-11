"""Reviewed subset of the attributed local brand dataset; no runtime downloads."""

import json
import re
from pathlib import Path


def load_catalog(path: Path) -> tuple[dict, dict]:
    catalog = json.loads(path.read_text(encoding="utf-8"))
    if catalog.get("version") != 1:
        raise ValueError("Unsupported brand catalog version")
    brands, spelling = {}, {}
    for entry in catalog["brands"]:
        if not entry.get("enabled"):
            continue
        identifier = entry["identifier"]
        domains = tuple(entry["domains"])
        if (
            not re.fullmatch(r"[a-z][a-z0-9]{3,39}", identifier)
            or identifier in brands
            or not domains
            or any(
                not re.fullmatch(r"(?:[a-z0-9]+(?:-[a-z0-9]+)*\.)+[a-z]{2,}", d)
                for d in domains
            )
        ):
            raise ValueError("Invalid active brand catalog entry")
        brands[identifier] = domains
        if entry.get("ascii_lookalikes"):
            spelling[identifier] = domains
    if not brands:
        raise ValueError("Brand catalog has no active entries")
    return brands, spelling


BRANDS, ASCII_LOOKALIKE_BRANDS = load_catalog(
    Path(__file__).with_name("data") / "brands.json"
)
