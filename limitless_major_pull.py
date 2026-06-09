"""Pull major-event decklists from the main Limitless TCG site.

This complements limitless_pull.py, which pulls Play Limitless online events.
Major events live on www.limitlesstcg.com and expose decklists as HTML pages.
The rows written here match outputs/players.csv so extract_cards.py can process
online and major events together.
"""

from __future__ import annotations

import argparse
import json
import re
import time
from html import unescape
from pathlib import Path
from typing import Any

import pandas as pd
import requests


BASE_URL = "https://www.limitlesstcg.com"
OUTPUTS_DIR = Path("outputs")
MAJOR_TOURNAMENTS_CSV = OUTPUTS_DIR / "major_tournaments.csv"
MAJOR_PLAYERS_CSV = OUTPUTS_DIR / "major_players.csv"


def main() -> None:
    parser = argparse.ArgumentParser(description="Pull major-event decklists from Limitless.")
    parser.add_argument("--format", default="standard", help="Format to keep, such as standard.")
    parser.add_argument("--min-players", type=int, default=64, help="Skip tournaments with fewer players.")
    parser.add_argument("--since", help="Skip tournaments before this date. Example: 2026-05-01")
    parser.add_argument("--days", type=int, default=31, help="Skip tournaments older than this many days.")
    parser.add_argument("--name-contains", help="Only keep tournaments whose name contains this text.")
    parser.add_argument("--max-events", type=int, help="Stop after this many matching major events.")
    parser.add_argument("--delay", type=float, default=0.5, help="Seconds to pause between event page requests.")
    args = parser.parse_args()

    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    tournaments = fetch_major_tournaments(
        format_id=args.format,
        min_players=args.min_players,
        since=args.since,
        days=args.days,
        name_contains=args.name_contains,
        max_events=args.max_events,
    )
    players = fetch_major_players(tournaments, delay=args.delay)

    pd.DataFrame(tournaments).to_csv(MAJOR_TOURNAMENTS_CSV, index=False)
    pd.DataFrame(players).to_csv(MAJOR_PLAYERS_CSV, index=False)

    print(f"Wrote {MAJOR_TOURNAMENTS_CSV} with {len(tournaments)} major events.")
    print(f"Wrote {MAJOR_PLAYERS_CSV} with {len(players)} major decklists.")


def fetch_major_tournaments(
    format_id: str = "standard",
    min_players: int = 64,
    since: str | None = None,
    days: int | None = 31,
    name_contains: str | None = None,
    max_events: int | None = None,
) -> list[dict[str, Any]]:
    """Read the main Limitless tournament listing and filter major events."""

    html = _get_html(f"{BASE_URL}/tournaments")
    since_date = _since_date_from_args(since=since, days=days)
    tournaments: list[dict[str, Any]] = []

    for match in re.finditer(r"<tr\s+([^>]*data-date=.*?)</tr>", html, flags=re.DOTALL | re.IGNORECASE):
        attrs = _parse_attrs(match.group(1))
        href_match = re.search(r'href="(/tournaments/\d+)"', match.group(0))
        if not href_match:
            continue

        tournament = {
            "source": "major",
            "id": href_match.group(1).rsplit("/", 1)[-1],
            "name": attrs.get("data-name", ""),
            "date": attrs.get("data-date", ""),
            "country": attrs.get("data-country", ""),
            "format": attrs.get("data-format", ""),
            "players": _safe_int(attrs.get("data-players", 0)),
            "url": f"{BASE_URL}{href_match.group(1)}",
        }

        if not _tournament_matches_filters(
            tournament,
            format_id=format_id,
            min_players=min_players,
            since_date=since_date,
            name_contains=name_contains,
        ):
            continue

        tournaments.append(tournament)
        print(f"Kept major event: {tournament['date']} - {tournament['name']} ({tournament['players']} players)")

        if max_events and len(tournaments) >= max_events:
            break

    return tournaments


def fetch_major_players(tournaments: list[dict[str, Any]], delay: float = 0.5) -> list[dict[str, Any]]:
    """Fetch decklists for each major event."""

    rows: list[dict[str, Any]] = []
    total = len(tournaments)

    for index, tournament in enumerate(tournaments, start=1):
        decklists_url = f"{BASE_URL}/tournaments/{tournament['id']}/decklists"
        print(f"Fetching major decklists {index}/{total}: {tournament['name']}")
        html = _get_html(decklists_url)
        decklists = parse_major_decklists(html)

        if not decklists:
            print(f"  No published decklists found for {tournament['name']}.")

        for decklist in decklists:
            row = {
                "source": "major",
                "name": decklist["player"],
                "player": decklist["player"],
                "player_id": f"major-{tournament['id']}-{decklist['placement']}-{decklist['player']}",
                "country": tournament.get("country", ""),
                "deck": decklist["deck"],
                "decklist": json.dumps(decklist["cards"]),
                "placing": decklist["placement"],
                "tournament_id": f"major-{tournament['id']}",
                "tournament_name": tournament["name"],
                "date": tournament["date"],
                "format": tournament.get("format", ""),
                "players": tournament.get("players", ""),
            }
            rows.append(row)

        if delay > 0:
            time.sleep(delay)

    return rows


def parse_major_decklists(html: str) -> list[dict[str, Any]]:
    """Parse decklist blocks from a Limitless major-event decklists page."""

    blocks = _split_decklist_blocks(html)
    decklists: list[dict[str, Any]] = []

    for block in blocks:
        heading = _text_from_first_match(block, r'<div class="decklist-toggle"[^>]*>(.*?)</div>')
        placement, player = _parse_placing_and_player(heading)
        deck = _text_from_first_match(block, r'<div class="decklist-title">\s*(.*?)\s*(?:<a|<span|</div>)')
        cards = _parse_cards(block)

        if not player or not deck or not cards:
            continue

        decklists.append(
            {
                "placement": placement,
                "player": player,
                "deck": deck,
                "cards": cards,
            }
        )

    return decklists


def _split_decklist_blocks(html: str) -> list[str]:
    starts = [match.start() for match in re.finditer(r'<div class="tournament-decklist">', html)]
    blocks: list[str] = []
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else html.find("</section>", start)
        if end == -1:
            end = len(html)
        blocks.append(html[start:end])
    return blocks


def _parse_cards(block: str) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    pattern = re.compile(
        r'<span class="card-count">(?P<count>\d+)</span>\s*'
        r'<span class="card-name">(?P<name>.*?)</span>',
        flags=re.DOTALL | re.IGNORECASE,
    )

    for match in pattern.finditer(block):
        cards.append(
            {
                "count": _safe_int(match.group("count"), default=1),
                "name": _clean_text(match.group("name")),
            }
        )
    return cards


def _parse_placing_and_player(text: str) -> tuple[int, str]:
    match = re.match(r"\s*(\d+)(?:st|nd|rd|th)?\s+(.+?)\s*$", text)
    if not match:
        return 0, text.strip()
    return int(match.group(1)), match.group(2).strip()


def _tournament_matches_filters(
    tournament: dict[str, Any],
    format_id: str | None = None,
    min_players: int = 0,
    since_date: pd.Timestamp | None = None,
    name_contains: str | None = None,
) -> bool:
    if format_id and tournament.get("format", "").lower() != format_id.lower():
        return False

    if min_players and _safe_int(tournament.get("players", 0)) < min_players:
        return False

    if since_date is not None:
        tournament_date = pd.to_datetime(tournament.get("date"), errors="coerce", utc=True)
        if pd.isna(tournament_date) or tournament_date < since_date:
            return False

    if name_contains and name_contains.lower() not in tournament.get("name", "").lower():
        return False

    return True


def _since_date_from_args(since: str | None = None, days: int | None = 31) -> pd.Timestamp | None:
    if since:
        return pd.to_datetime(since, errors="raise", utc=True)
    if days:
        return pd.Timestamp.today(tz="UTC").normalize() - pd.Timedelta(days=days)
    return None


def _get_html(url: str) -> str:
    response = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
    response.raise_for_status()
    return response.text


def _parse_attrs(raw_attrs: str) -> dict[str, str]:
    attrs: dict[str, str] = {}
    for key, value in re.findall(r'([\w-]+)="(.*?)"', raw_attrs, flags=re.DOTALL):
        attrs[key] = unescape(value)
    return attrs


def _text_from_first_match(raw: str, pattern: str) -> str:
    match = re.search(pattern, raw, flags=re.DOTALL | re.IGNORECASE)
    if not match:
        return ""
    return _clean_text(match.group(1))


def _clean_text(raw: str) -> str:
    no_tags = re.sub(r"<[^>]+>", "", raw)
    return unescape(no_tags).strip()


def _safe_int(value: object, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


if __name__ == "__main__":
    main()
