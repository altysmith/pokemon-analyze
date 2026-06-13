"""Build a clean top-25 meta matchup report.

This answers one focused question:

Which decks from the current Limitless top-25 meta list perform best against
the rest of that same top-25 meta list?
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from pokemon_analyze.deck_analysis import (
    best_decks_against_meta,
    read_cards,
    read_limitless_meta_decks,
    read_matches,
    resolve_meta_decks,
)


OUTPUT_PATH = Path("outputs") / "best_decks_against_top25_meta.csv"


def main() -> None:
    cards = read_cards()
    matches = read_matches()
    meta_decks = read_limitless_meta_decks().head(25)

    # Map Limitless names like "Dragapult ex" to the deck names used in our
    # card and match CSVs. Candidate decks and target decks both come from this
    # same top-25 list.
    resolved_meta = resolve_meta_decks(cards, meta_decks, limit=25)
    report = best_decks_against_meta(
        cards,
        matches,
        meta_n=25,
        min_matches=1,
        eligible_decks=set(resolved_meta["local_deck"]),
        meta_deck_map=resolved_meta,
    )

    report = _add_limitless_meta_columns(report, resolved_meta, meta_decks)
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    report.to_csv(OUTPUT_PATH, index=False)
    print(f"Wrote {OUTPUT_PATH} with {len(report)} rows.")


def _add_limitless_meta_columns(
    report: pd.DataFrame,
    resolved_meta: pd.DataFrame,
    meta_decks: pd.DataFrame,
) -> pd.DataFrame:
    """Add Limitless rank, points, and share next to each local deck name."""

    meta_values = meta_decks.rename(
        columns={
            "deck": "limitless_deck",
            "points": "meta_points",
            "share": "meta_share",
        }
    )[["limitless_deck", "meta_points", "meta_share"]]
    meta_details = (
        resolved_meta.rename(columns={"local_deck": "deck", "rank": "meta_rank"})
        .merge(meta_values, on="limitless_deck", how="left")
        [["deck", "meta_rank", "meta_points", "meta_share"]]
        .sort_values(["deck", "meta_rank"], ascending=[True, True])
        .drop_duplicates("deck", keep="first")
    )

    with_meta = report.merge(meta_details, on="deck", how="left")
    columns = [
        "meta_rank",
        "deck",
        "meta_points",
        "meta_share",
        "favorable_matchups",
        "very_favorable_matchups",
        "unfavorable_matchups",
        "very_unfavorable_matchups",
        "meta_opponents_faced",
        "matches",
        "wins",
        "losses",
        "ties",
        "win_rate",
        "tie_adjusted_win_rate",
    ]
    return with_meta[columns].sort_values(
        ["favorable_matchups", "very_favorable_matchups", "tie_adjusted_win_rate", "matches"],
        ascending=[False, False, False, False],
    )


if __name__ == "__main__":
    main()
