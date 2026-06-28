"""Download card subtype metadata used to organize exported decklists."""

from __future__ import annotations

from pathlib import Path
import time

import pandas as pd
import requests


CARDS_CSV = Path("outputs/cards.csv")
SUBTYPES_CSV = Path("outputs/card_subtypes.csv")
API_URL = "https://api.pokemontcg.io/v2/cards"


def main() -> None:
    """Fetch each set once and save a compact set/number subtype lookup."""

    cards = pd.read_csv(CARDS_CSV, low_memory=False)
    set_codes = sorted(
        {
            str(value).strip()
            for value in cards.get("set", pd.Series(dtype=str)).dropna()
            if str(value).strip()
        }
    )

    rows: list[dict[str, object]] = []
    for index, set_code in enumerate(set_codes, start=1):
        print(f"Fetching card metadata {index}/{len(set_codes)}: {set_code}")
        response = _get_set(set_code)
        if response is None:
            print(f"  Skipping {set_code} after repeated API timeouts.")
            continue
        for card in response.json().get("data", []):
            card_set = card.get("set") or {}
            rows.append(
                {
                    "set": card_set.get("ptcgoCode", set_code),
                    "number": card.get("number", ""),
                    "card": card.get("name", ""),
                    "supertype": card.get("supertype", ""),
                    "subtype": _display_subtype(card.get("supertype", ""), card.get("subtypes", [])),
                }
            )
        time.sleep(0.15)

    output = pd.DataFrame(rows).drop_duplicates(["set", "number", "card"])
    SUBTYPES_CSV.parent.mkdir(parents=True, exist_ok=True)
    output.to_csv(SUBTYPES_CSV, index=False)
    print(f"Wrote {SUBTYPES_CSV} with {len(output)} card metadata rows.")


def _get_set(set_code: str) -> requests.Response | None:
    """Fetch one set with retries so a transient timeout does not stop pulls."""

    for attempt in range(1, 4):
        try:
            response = requests.get(
                API_URL,
                params={
                    "q": f"set.ptcgoCode:{set_code}",
                    "pageSize": 250,
                    "select": "name,number,supertype,subtypes,set",
                },
                timeout=(10, 90),
            )
            response.raise_for_status()
            return response
        except requests.RequestException as error:
            print(f"  Attempt {attempt}/3 failed: {error}")
            if attempt < 3:
                time.sleep(attempt * 2)
    return None


def _display_subtype(supertype: str, subtypes: list[str]) -> str:
    """Reduce API subtype values to the decklist groups used by the app."""

    if supertype == "Pokemon":
        return "Pokemon"
    if supertype == "Energy":
        return "Special Energy" if "Special" in subtypes else "Energy"
    for subtype in ["Supporter", "Item", "Pokemon Tool", "Pokémon Tool", "Tool", "Stadium"]:
        if subtype in subtypes:
            return "Tool" if subtype in {"Pokemon Tool", "Pokémon Tool"} else subtype
    return supertype or "Other"


if __name__ == "__main__":
    main()
