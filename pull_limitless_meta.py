"""Pull the Limitless front-page metagame deck ranking.

The dashboard uses this list as the target meta when asking, "What decks beat
the most top decks?" Keeping it in outputs/ lets Streamlit Cloud use the same
ranking without making a live request on every page load.
"""

from __future__ import annotations

import argparse
import re
from html import unescape
from pathlib import Path
from typing import Any

import pandas as pd
import requests


BASE_URL = "https://limitlesstcg.com"
OUTPUTS_DIR = Path("outputs")
META_CSV = OUTPUTS_DIR / "limitless_meta_decks.csv"


def main() -> None:
    parser = argparse.ArgumentParser(description="Pull Limitless metagame deck rankings.")
    parser.add_argument("--format", default="TEF-CRI", help="Limitless format code, such as TEF-CRI.")
    parser.add_argument("--limit", type=int, default=50, help="Maximum deck rows to keep.")
    parser.add_argument(
        "--combined-decks",
        action="store_true",
        help="Use Limitless's combined archetype ranking instead of split variants.",
    )
    args = parser.parse_args()

    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    rows = fetch_meta_decks(format_id=args.format, limit=args.limit, split_variants=not args.combined_decks)
    pd.DataFrame(rows).to_csv(META_CSV, index=False)
    print(f"Wrote {META_CSV} with {len(rows)} Limitless meta deck rows.")


def fetch_meta_decks(format_id: str = "TEF-CRI", limit: int = 50, split_variants: bool = True) -> list[dict[str, Any]]:
    """Fetch and parse the Limitless deck ranking page."""

    params: dict[str, str] = {"format": format_id}
    if split_variants:
        params["variants"] = "on"

    response = requests.get(
        f"{BASE_URL}/decks",
        params=params,
        timeout=30,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    response.raise_for_status()
    rows = parse_meta_decks(response.text)
    return rows[:limit]


def parse_meta_decks(html: str) -> list[dict[str, Any]]:
    """Parse rank, deck, points, and share from the Limitless ranking table."""

    rows: list[dict[str, Any]] = []
    for table_row in re.findall(r"<tr\b.*?</tr>", html, flags=re.DOTALL | re.IGNORECASE):
        text = _clean_text(table_row)
        match = re.match(r"^\s*(?P<rank>\d+)\s+(?P<deck>.+?)\s+(?P<points>\d+)\s+(?P<share>[\d.]+)%\s*$", text)
        if not match:
            continue

        rows.append(
            {
                "rank": int(match.group("rank")),
                "deck": match.group("deck").strip(),
                "points": int(match.group("points")),
                "share": float(match.group("share")) / 100,
            }
        )
    return rows


def _clean_text(raw: str) -> str:
    no_images = re.sub(r"<img\b[^>]*>", " ", raw, flags=re.DOTALL | re.IGNORECASE)
    no_tags = re.sub(r"<[^>]+>", " ", no_images)
    return re.sub(r"\s+", " ", unescape(no_tags)).strip()


if __name__ == "__main__":
    main()
