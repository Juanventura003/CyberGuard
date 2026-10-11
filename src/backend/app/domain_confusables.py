"""Brand lookalikes using a bundled Unicode confusables snapshot.

This compares character skeletons, not ownership or malicious intent. It is not
an implementation of all Unicode security checks.
"""

from functools import lru_cache
from pathlib import Path
import unicodedata

DATA = Path(__file__).resolve().parent / "data" / "confusables.txt"


@lru_cache(maxsize=1)
def _mapping():
    table = {}
    for line in DATA.read_text(encoding="utf-8").splitlines():
        fields = line.split("#", 1)[0].split(";")
        if len(fields) < 2:
            continue
        source = fields[0].strip().split()
        if len(source) == 1:
            table[chr(int(source[0], 16))] = "".join(
                chr(int(code, 16)) for code in fields[1].split()
            )
    return table


def skeleton(value):
    decomposed = unicodedata.normalize("NFD", value)
    return unicodedata.normalize(
        "NFD", "".join(_mapping().get(char, char) for char in decomposed)
    )


def brand_lookalikes(ascii_host, brands):
    found = set()
    for label in ascii_host.split(".")[:-1]:
        if not label.startswith("xn--"):
            continue
        try:
            decoded = label.encode("ascii").decode("idna").lower()
        except UnicodeError:
            continue
        for piece in decoded.split("-"):
            for brand, official in brands.items():
                if any(
                    ascii_host == domain or ascii_host.endswith("." + domain)
                    for domain in official
                ):
                    continue
                if piece != brand and skeleton(piece) == skeleton(brand):
                    found.add(brand)
    return sorted(found)
