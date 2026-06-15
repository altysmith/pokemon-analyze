"""Convert outputs/players.csv into outputs/cards.csv.

This script accepts a few beginner-friendly player CSV shapes:
- one row per deck with a card list column such as "cards" or "decklist"
- one row per card with columns such as "card" and optional "count"
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd


PLAYERS_CSV = Path("outputs/players.csv")
CARDS_CSV = Path("outputs/cards.csv")


def main() -> None:
    if not PLAYERS_CSV.exists():
        raise FileNotFoundError("Could not find outputs/players.csv. Run limitless_pull.py first.")

    players = pd.read_csv(PLAYERS_CSV)
    cards = extract_cards(players)
    CARDS_CSV.parent.mkdir(parents=True, exist_ok=True)
    cards.to_csv(CARDS_CSV, index=False)
    print(f"Wrote {CARDS_CSV} with {len(cards)} rows.")


def extract_cards(players: pd.DataFrame) -> pd.DataFrame:
    players = players.copy()
    players.columns = [_clean_column(column) for column in players.columns]
    players = _add_readable_deck_name(players)

    if "card" in players.columns:
        return players

    card_column = _first_existing(players, ["decklist", "cards", "deck_list", "list"])
    if card_column is None:
        raise ValueError("players.csv needs either a 'card' column or a card list column.")

    rows: list[dict[str, object]] = []
    for index, player in players.iterrows():
        for card in _parse_card_list(player.get(card_column, "")):
            row = player.drop(labels=[card_column]).to_dict()
            row["player_id"] = _first_non_empty(row.get("player_id"), row.get("player"), index)
            row["card"] = card["name"]
            row["count"] = card["count"]
            row["category"] = card.get("category", "")
            row["set"] = card.get("set", "")
            row["number"] = card.get("number", "")
            rows.append(row)

    return pd.DataFrame(rows)


def _parse_card_list(raw_cards: object) -> list[dict[str, object]]:
    parsed_json = _parse_json_card_list(raw_cards)
    if parsed_json:
        return parsed_json

    cards: list[dict[str, object]] = []
    for line in str(raw_cards).replace(";", "\n").splitlines():
        line = line.strip()
        if not line:
            continue

        parts = line.split(" ", 1)
        if parts and parts[0].isdigit() and len(parts) > 1:
            cards.append({"count": int(parts[0]), "name": parts[1].strip()})
        else:
            cards.append({"count": 1, "name": line})
    return cards


def _parse_json_card_list(raw_cards: object) -> list[dict[str, object]]:
    """Parse card lists stored as JSON by limitless_pull.py."""

    try:
        loaded = json.loads(str(raw_cards))
    except (TypeError, json.JSONDecodeError):
        return []

    cards: list[dict[str, object]] = []
    if isinstance(loaded, list):
        for item in loaded:
            cards.extend(_parse_json_card_item(item))
    elif isinstance(loaded, dict):
        for name, value in loaded.items():
            if isinstance(value, (list, dict)):
                cards.extend(_parse_json_card_item(value, category=name))
            else:
                cards.append({"count": _safe_count(value), "name": str(name), "category": ""})

    return cards


def _parse_json_card_item(item: object, category: str = "") -> list[dict[str, object]]:
    """Parse one item or nested section from a Limitless decklist."""

    if isinstance(item, str):
        return [{"count": 1, "name": item, "category": category}]

    if isinstance(item, list):
        cards: list[dict[str, object]] = []
        for nested_item in item:
            cards.extend(_parse_json_card_item(nested_item, category=category))
        return cards

    if isinstance(item, dict):
        name = item.get("card") or item.get("name") or item.get("card_name")
        count = item.get("count") or item.get("qty") or item.get("quantity") or 1
        if name:
            return [
                {
                    "count": _safe_count(count),
                    "name": str(name),
                    "category": str(item.get("category") or item.get("type") or category),
                    "set": str(item.get("set") or item.get("set_code") or ""),
                    "number": str(item.get("number") or item.get("card_number") or ""),
                }
            ]

        cards: list[dict[str, object]] = []
        for nested_name, nested_value in item.items():
            if isinstance(nested_value, (list, dict)):
                cards.extend(_parse_json_card_item(nested_value, category=str(nested_name)))
            else:
                cards.append({"count": _safe_count(nested_value), "name": str(nested_name), "category": category})
        return cards

    return []


def _safe_count(value: object) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 1


def _first_non_empty(*values: object) -> object:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        if pd.isna(value):
            continue
        return value
    return ""


def _add_readable_deck_name(players: pd.DataFrame) -> pd.DataFrame:
    """Turn Limitless deck JSON into a simple deck name column."""

    if "deck" not in players.columns:
        return players

    players = players.copy()
    players["deck"] = players["deck"].apply(_deck_name_from_value)
    return players


def _deck_name_from_value(value: object) -> str:
    try:
        loaded = json.loads(str(value))
    except (TypeError, json.JSONDecodeError):
        return "" if pd.isna(value) else str(value)

    if isinstance(loaded, dict):
        return str(loaded.get("name") or loaded.get("id") or "Unknown")
    return str(value)


def _first_existing(data: pd.DataFrame, columns: list[str]) -> str | None:
    for column in columns:
        if column in data.columns:
            return column
    return None


def _clean_column(column: object) -> str:
    return str(column).strip().lower().replace(" ", "_").replace("-", "_")


if __name__ == "__main__":
    main()
