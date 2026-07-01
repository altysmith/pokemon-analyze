"""Pull Day 1 and Day 2 archetype counts from Limitless Labs.

The main major-event pull provides successful decklists and match pairings.
Limitless Labs also publishes the full Day 1 field, which lets the dashboard
calculate Day 2 conversion without rewarding an archetype just for popularity.
"""

from __future__ import annotations

import argparse
from io import StringIO
from pathlib import Path
import re
import time

import pandas as pd
import requests


OUTPUTS_DIR = Path("outputs")
MAJOR_TOURNAMENTS_CSV = OUTPUTS_DIR / "major_tournaments.csv"
LABS_CONVERSION_CSV = OUTPUTS_DIR / "labs_conversion.csv"
USER_AGENT = "Mozilla/5.0"


def main() -> None:
    parser = argparse.ArgumentParser(description="Pull major-event conversion data from Limitless Labs.")
    parser.add_argument("--delay", type=float, default=0.5, help="Seconds to pause between requests.")
    args = parser.parse_args()

    if not MAJOR_TOURNAMENTS_CSV.exists():
        raise FileNotFoundError(f"Could not find {MAJOR_TOURNAMENTS_CSV}. Run limitless_major_pull.py first.")

    tournaments = pd.read_csv(MAJOR_TOURNAMENTS_CSV, dtype={"id": str, "labs_id": str}).fillna("")
    rows: list[dict[str, object]] = []

    for index, tournament in tournaments.iterrows():
        labs_id = str(tournament.get("labs_id", "")).strip() or find_labs_id(str(tournament.get("url", "")))
        if not labs_id:
            print(f"No Limitless Labs event found for {tournament.get('name', 'Unknown event')}.")
            continue

        tournaments.at[index, "labs_id"] = labs_id
        print(f"Fetching conversion data: {tournament.get('name')} ({labs_id})")
        rows.extend(fetch_conversion_rows(tournament, labs_id))
        if args.delay > 0:
            time.sleep(args.delay)

    tournaments.to_csv(MAJOR_TOURNAMENTS_CSV, index=False)
    pd.DataFrame(
        rows,
        columns=[
            "source",
            "tournament_id",
            "labs_id",
            "tournament_name",
            "date",
            "deck",
            "day1",
            "day2",
            "conversion_rate",
            "wins",
            "losses",
            "ties",
            "tie_adjusted_win_rate",
        ],
    ).to_csv(LABS_CONVERSION_CSV, index=False)
    print(f"Wrote {LABS_CONVERSION_CSV} with {len(rows)} event-archetype rows.")


def find_labs_id(tournament_url: str) -> str:
    """Find the Labs event identifier linked from a Limitless event page."""

    if not tournament_url:
        return ""
    html = get_html(tournament_url)
    match = re.search(r"https://labs\.limitlesstcg\.com/([^/\"<>]+)", html)
    return match.group(1) if match else ""


def fetch_conversion_rows(tournament: pd.Series, labs_id: str) -> list[dict[str, object]]:
    """Parse the public conversion table for one major event."""

    html = get_html(f"https://labs.limitlesstcg.com/{labs_id}/decks?conversion=")
    tables = pd.read_html(StringIO(html))
    if not tables:
        return []

    conversion = tables[0].copy()
    required = {"Deck", "Day 1", "Day 2"}
    if not required.issubset(conversion.columns):
        print(f"  Conversion table was not available for {tournament.get('name')}.")
        return []

    overall_html = get_html(f"https://labs.limitlesstcg.com/{labs_id}/decks")
    overall_tables = pd.read_html(StringIO(overall_html))
    records: dict[str, tuple[int, int, int]] = {}
    if overall_tables and {"Deck", "Record"}.issubset(overall_tables[0].columns):
        for overall in overall_tables[0].to_dict("records"):
            record_match = re.match(r"\s*(\d+)\s*-\s*(\d+)\s*-\s*(\d+)\s*", str(overall.get("Record", "")))
            if record_match:
                records[str(overall.get("Deck", "")).strip()] = tuple(
                    int(value) for value in record_match.groups()
                )

    rows: list[dict[str, object]] = []
    for record in conversion.to_dict("records"):
        day1 = safe_int(record.get("Day 1"))
        day2 = safe_int(record.get("Day 2"))
        deck = str(record.get("Deck", "")).strip()
        if not deck or day1 <= 0:
            continue
        wins, losses, ties = records.get(deck, (0, 0, 0))
        matches = wins + losses + ties
        rows.append(
            {
                "source": "major",
                "tournament_id": f"major-{tournament.get('id')}",
                "labs_id": labs_id,
                "tournament_name": tournament.get("name", ""),
                "date": tournament.get("date", ""),
                "deck": deck,
                "day1": day1,
                "day2": day2,
                "conversion_rate": day2 / day1,
                "wins": wins,
                "losses": losses,
                "ties": ties,
                "tie_adjusted_win_rate": (wins + (ties / 3)) / matches if matches else 0,
            }
        )
    return rows


def get_html(url: str) -> str:
    response = requests.get(url, timeout=30, headers={"User-Agent": USER_AGENT})
    response.raise_for_status()
    return response.text


def safe_int(value: object) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


if __name__ == "__main__":
    main()
