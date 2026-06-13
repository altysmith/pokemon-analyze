"""Pull Pokemon tournament data from the Limitless API.

The script writes:
- outputs/tournaments.csv
- outputs/players.csv

Limitless API shapes can change over time, so this script stores the useful
top-level fields it finds and keeps nested values as JSON text.
"""

from __future__ import annotations

import argparse
import math
import json
import time
from pathlib import Path
from typing import Any

import pandas as pd
import requests


API_BASE = "https://play.limitlesstcg.com/api"
OUTPUTS_DIR = Path("outputs")


def main() -> None:
    parser = argparse.ArgumentParser(description="Pull Pokemon data from Limitless.")
    parser.add_argument("--game", default="PTCG", help="Limitless game code.")
    parser.add_argument("--format", dest="format_id", help="Limitless format ID, such as STANDARD.")
    parser.add_argument("--limit", type=int, default=50, help="Tournaments to pull per page.")
    parser.add_argument("--pages", type=int, default=1, help="Number of tournament pages to pull.")
    parser.add_argument("--all-pages", action="store_true", help="Keep pulling pages until Limitless returns no more tournaments.")
    parser.add_argument("--delay", type=float, default=0.2, help="Seconds to pause between standings requests.")
    parser.add_argument("--pairings-delay", type=float, default=1.0, help="Seconds to pause between pairings requests.")
    parser.add_argument("--min-players", type=int, default=0, help="Skip tournaments with fewer players.")
    parser.add_argument("--since", help="Skip tournaments before this date. Example: 2026-05-01")
    parser.add_argument("--days", type=int, help="Skip tournaments older than this many days. Example: 31")
    parser.add_argument("--has-decklists", action="store_true", help="Only keep player rows that include a decklist.")
    parser.add_argument(
        "--top-percent",
        type=float,
        default=100,
        help="Only keep this top percent of online standings. Example: 50 keeps the top half.",
    )
    args = parser.parse_args()

    if args.top_percent <= 0 or args.top_percent > 100:
        raise ValueError("--top-percent must be greater than 0 and no more than 100.")

    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    tournaments = fetch_tournaments(
        game=args.game,
        format_id=args.format_id,
        limit=args.limit,
        pages=args.pages,
        all_pages=args.all_pages,
        min_players=args.min_players,
        since=args.since,
        days=args.days,
    )
    players = fetch_players_for_tournaments(
        tournaments,
        delay=args.delay,
        require_decklists=args.has_decklists,
        top_percent=args.top_percent,
    )
    matches = fetch_matches_for_tournaments(tournaments, delay=args.pairings_delay)

    pd.DataFrame(tournaments).to_csv(OUTPUTS_DIR / "tournaments.csv", index=False)
    pd.DataFrame(players).to_csv(OUTPUTS_DIR / "players.csv", index=False)
    pd.DataFrame(players).to_csv(OUTPUTS_DIR / "online_players.csv", index=False)
    pd.DataFrame(matches).to_csv(OUTPUTS_DIR / "matches.csv", index=False)
    pd.DataFrame(matches).to_csv(OUTPUTS_DIR / "online_matches.csv", index=False)

    print(f"Wrote outputs/tournaments.csv with {len(tournaments)} tournaments.")
    print(f"Wrote outputs/players.csv with {len(players)} player rows.")
    print(f"Wrote outputs/online_players.csv with {len(players)} online player rows.")
    print(f"Wrote outputs/matches.csv with {len(matches)} online match rows.")


def fetch_tournaments(
    game: str = "PTCG",
    format_id: str | None = None,
    limit: int = 50,
    pages: int = 1,
    all_pages: bool = False,
    min_players: int = 0,
    since: str | None = None,
    days: int | None = None,
) -> list[dict[str, Any]]:
    """Fetch one or more pages of tournament summaries."""

    tournaments: list[dict[str, Any]] = []
    page = 1
    since_date = _since_date_from_args(since=since, days=days)

    while all_pages or page <= pages:
        params: dict[str, Any] = {"game": game, "limit": limit, "page": page}
        if format_id:
            params["format"] = format_id

        data = _get_json(f"{API_BASE}/tournaments", params=params)

        page_tournaments = data if isinstance(data, list) else data.get("tournaments", [])
        if not page_tournaments:
            break

        filtered_tournaments = [
            tournament
            for tournament in page_tournaments
            if _tournament_matches_filters(tournament, min_players=min_players, since_date=since_date)
        ]
        tournaments.extend(_flatten_record(tournament) for tournament in filtered_tournaments)
        print(
            f"Fetched tournament page {page}: "
            f"{len(page_tournaments)} found, {len(filtered_tournaments)} kept."
        )

        if len(page_tournaments) < limit:
            break

        page += 1

    return tournaments


def _since_date_from_args(since: str | None = None, days: int | None = None) -> pd.Timestamp | None:
    """Choose the date cutoff for tournament filtering."""

    if since:
        return pd.to_datetime(since, errors="raise", utc=True)

    if days:
        today = pd.Timestamp.today(tz="UTC").normalize()
        return today - pd.Timedelta(days=days)

    return None


def fetch_players_for_tournaments(
    tournaments: list[dict[str, Any]],
    delay: float = 0.2,
    require_decklists: bool = False,
    top_percent: float = 100,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    total = len(tournaments)
    for index, tournament in enumerate(tournaments, start=1):
        tournament_id = tournament.get("id") or tournament.get("tournament_id")
        if not tournament_id:
            continue

        print(f"Fetching standings {index}/{total}: {tournament.get('name', tournament_id)}")
        try:
            standings_data = _get_json(f"{API_BASE}/tournaments/{tournament_id}/standings")
        except requests.HTTPError as error:
            print(f"  Skipping standings for {tournament_id}: {error}")
            continue

        # The /details endpoint has a numeric "players" count. The /standings
        # endpoint has the actual player rows and decklists we need.
        players = standings_data if isinstance(standings_data, list) else standings_data.get("standings", [])
        players = _top_percent_players(players, top_percent)
        for player in players:
            if not isinstance(player, dict):
                continue
            if require_decklists and not player.get("decklist"):
                continue
            row = _flatten_record(player)
            row["source"] = "online"
            row["tournament_id"] = tournament_id
            row["tournament_name"] = tournament.get("name", "")
            row["date"] = tournament.get("date") or tournament.get("start_date") or ""
            rows.append(row)

        if delay > 0:
            time.sleep(delay)
    return rows


def _top_percent_players(players: Any, top_percent: float) -> list[dict[str, Any]]:
    """Return only the top placement slice from standings rows.

    Play Limitless standings are normally already sorted by finish, but we sort
    by placement/rank fields when they are present. This keeps the "top 50%"
    rule tied to tournament performance instead of CSV row order.
    """

    player_rows = [player for player in players if isinstance(player, dict)]
    if top_percent >= 100 or not player_rows:
        return player_rows

    keep_count = max(1, math.ceil(len(player_rows) * (top_percent / 100)))
    return sorted(player_rows, key=_player_placement_value)[:keep_count]


def _player_placement_value(player: dict[str, Any]) -> float:
    """Find the best available placement number for a standings row."""

    for key in ("placing", "placement", "place", "rank", "standing"):
        value = player.get(key)
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    return float("inf")


def fetch_matches_for_tournaments(tournaments: list[dict[str, Any]], delay: float = 1.0) -> list[dict[str, Any]]:
    """Fetch match pairings for online Play Limitless tournaments."""

    rows: list[dict[str, Any]] = []
    total = len(tournaments)
    for index, tournament in enumerate(tournaments, start=1):
        tournament_id = tournament.get("id") or tournament.get("tournament_id")
        if not tournament_id:
            continue

        print(f"Fetching pairings {index}/{total}: {tournament.get('name', tournament_id)}")
        try:
            pairings_data = _get_json(f"{API_BASE}/tournaments/{tournament_id}/pairings")
        except requests.HTTPError as error:
            print(f"  Skipping pairings for {tournament_id}: {error}")
            continue

        matches = pairings_data if isinstance(pairings_data, list) else pairings_data.get("pairings", [])
        for match in matches:
            if not isinstance(match, dict):
                continue
            row = _flatten_record(match)
            row["source"] = "online"
            row["tournament_id"] = tournament_id
            row["tournament_name"] = tournament.get("name", "")
            row["date"] = tournament.get("date") or tournament.get("start_date") or ""
            rows.append(row)

        if delay > 0:
            time.sleep(delay)

    return rows


def _get_json(url: str, params: dict[str, Any] | None = None, retries: int = 4) -> Any:
    """Get JSON with simple retry/backoff for temporary rate limits."""

    for attempt in range(retries + 1):
        response = requests.get(url, params=params, timeout=30)
        if response.status_code != 429:
            response.raise_for_status()
            return response.json()

        retry_after = response.headers.get("Retry-After")
        if retry_after and retry_after.isdigit():
            wait_seconds = int(retry_after)
        else:
            wait_seconds = min(60, 5 * (attempt + 1))

        if attempt == retries:
            response.raise_for_status()

        print(f"  Rate limited. Waiting {wait_seconds} seconds before retrying...")
        time.sleep(wait_seconds)

    raise RuntimeError("Unexpected retry loop exit.")


def _tournament_matches_filters(
    tournament: dict[str, Any],
    min_players: int = 0,
    since_date: pd.Timestamp | None = None,
) -> bool:
    """Return True when a tournament should be kept."""

    players = tournament.get("players", 0)
    try:
        player_count = int(players)
    except (TypeError, ValueError):
        player_count = 0

    if min_players and player_count < min_players:
        return False

    if since_date is not None:
        tournament_date = pd.to_datetime(tournament.get("date"), errors="coerce", utc=True)
        if pd.isna(tournament_date) or tournament_date < since_date:
            return False

    return True


def _flatten_record(record: dict[str, Any]) -> dict[str, Any]:
    flat: dict[str, Any] = {}
    for key, value in record.items():
        if isinstance(value, (dict, list)):
            flat[key] = json.dumps(value)
        else:
            flat[key] = value
    return flat


if __name__ == "__main__":
    main()
