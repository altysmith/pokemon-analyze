"""Shared deck analysis helpers.

The command line scripts and Streamlit dashboard both use this module. Keeping
the calculations here makes the project easier to change because each report
gets the same card groups, trend math, and formatting rules.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import pandas as pd


OUTPUTS_DIR = Path("outputs")
CARDS_CSV = OUTPUTS_DIR / "cards.csv"
MATCHES_CSV = OUTPUTS_DIR / "matches.csv"
DECK_SUMMARY_CSV = OUTPUTS_DIR / "deck_summary.csv"


CORE_THRESHOLD = 0.65
COMMON_THRESHOLD = 0.35
FLEX_THRESHOLD = 0.12


@dataclass
class DeckAnalysis:
    """All report tables for a single deck."""

    deck: str
    bucket: str
    card_groups: pd.DataFrame
    trending_up: pd.DataFrame
    trending_down: pd.DataFrame
    best_placement_cards: pd.DataFrame


def read_matches(path: str | Path = MATCHES_CSV) -> pd.DataFrame:
    """Read matches.csv if it exists, returning an empty table otherwise."""

    csv_path = Path(path)
    if not csv_path.exists():
        return pd.DataFrame(columns=["tournament_id", "player1", "player2", "winner", "date"])

    matches = pd.read_csv(csv_path)
    matches = _normalize_columns(matches)

    for column in ["tournament_id", "player1", "player2", "winner"]:
        if column not in matches.columns:
            matches[column] = ""

    if "date" in matches.columns:
        matches["date"] = pd.to_datetime(matches["date"], errors="coerce", utc=True).dt.tz_localize(None)

    matches["tournament_id"] = matches["tournament_id"].astype(str)
    matches["player1"] = matches["player1"].fillna("").astype(str)
    matches["player2"] = matches["player2"].fillna("").astype(str)
    matches["winner"] = matches["winner"].fillna("").astype(str)
    if "source" not in matches.columns:
        matches["source"] = "online"
    matches["source"] = matches["source"].fillna("online").replace("", "online").astype(str)
    return matches


def read_cards(path: str | Path = CARDS_CSV) -> pd.DataFrame:
    """Read cards.csv and normalize the columns used by reports."""

    csv_path = Path(path)
    if not csv_path.exists():
        raise FileNotFoundError(f"Could not find {csv_path}. Run extract_cards.py first.")

    cards = pd.read_csv(csv_path, low_memory=False)
    cards = _normalize_columns(cards)

    required = {"deck", "card"}
    missing = required - set(cards.columns)
    if missing:
        missing_text = ", ".join(sorted(missing))
        raise ValueError(f"{csv_path} is missing required column(s): {missing_text}")

    if "count" not in cards.columns:
        cards["count"] = 1

    if "player_id" not in cards.columns:
        # Use row number as a safe fallback. If a source file has one row per
        # card copy, this still lets the report run, though adoption is less
        # precise than with a player/deck-list id.
        cards["player_id"] = cards.index.astype(str)

    if "date" in cards.columns:
        cards["date"] = pd.to_datetime(cards["date"], errors="coerce", utc=True).dt.tz_localize(None)

    if "placement" in cards.columns:
        cards["placement"] = pd.to_numeric(cards["placement"], errors="coerce")

    cards["deck"] = cards["deck"].fillna("Unknown").astype(str)
    cards["card"] = cards["card"].fillna("Unknown").astype(str)
    cards["count"] = pd.to_numeric(cards["count"], errors="coerce").fillna(1)
    if "source" not in cards.columns:
        cards["source"] = "online"
    cards["source"] = cards["source"].fillna("online").replace("", "online").astype(str)
    if "player" in cards.columns:
        cards["player_id"] = cards["player_id"].fillna(cards["player"])
    fallback_player_ids = pd.Series(cards.index.astype(str), index=cards.index)
    cards["player_id"] = cards["player_id"].fillna(fallback_player_ids).astype(str)
    cards["list_id"] = _list_id(cards)
    return cards


def available_decks(cards: pd.DataFrame | None = None, path: str | Path = CARDS_CSV) -> list[str]:
    """Return deck names sorted alphabetically."""

    if cards is None:
        cards = read_cards(path)
    elif "list_id" not in cards.columns and "player_id" in cards.columns:
        cards = cards.copy()
        cards["list_id"] = _list_id(cards)
    return sorted(cards["deck"].dropna().astype(str).unique())


def analyze_deck(
    deck: str,
    cards: pd.DataFrame | None = None,
    bucket: str = "weekly",
    path: str | Path = CARDS_CSV,
    limit: int = 20,
    min_tech_decks: int = 3,
) -> DeckAnalysis:
    """Build all tables needed for a single deck report."""

    if cards is None:
        cards = read_cards(path)
    elif "list_id" not in cards.columns and "player_id" in cards.columns:
        cards = cards.copy()
        cards["list_id"] = _list_id(cards)

    bucket = bucket.lower()
    if bucket not in {"daily", "weekly", "monthly"}:
        raise ValueError("bucket must be 'daily', 'weekly', or 'monthly'")

    deck_cards = cards[cards["deck"] == deck].copy()
    if deck_cards.empty:
        raise ValueError(f"No cards found for deck: {deck}")

    card_groups = classify_cards(deck_cards)
    trend_table = card_trends(deck_cards, bucket=bucket)
    placement_table = best_average_placement_cards(deck_cards, min_decks_played=min_tech_decks)

    return DeckAnalysis(
        deck=deck,
        bucket=bucket,
        card_groups=card_groups.head(limit),
        trending_up=trend_table.sort_values("trend", ascending=False).head(limit),
        trending_down=trend_table.sort_values("trend", ascending=True).head(limit),
        best_placement_cards=placement_table.head(limit),
    )


def classify_cards(cards: pd.DataFrame) -> pd.DataFrame:
    """Classify cards as core, common, flex, or tech based on deck adoption."""

    deck_count = cards["list_id"].nunique()
    adoption = (
        cards.groupby("card", as_index=False)
        .agg(
            decks_played=("list_id", "nunique"),
            average_count=("count", "mean"),
            max_count=("count", "max"),
        )
        .sort_values(["decks_played", "average_count", "card"], ascending=[False, False, True])
    )

    adoption["adoption_rate"] = adoption["decks_played"] / max(deck_count, 1)
    adoption["category"] = adoption["adoption_rate"].apply(_card_category)
    return adoption


def card_trends(cards: pd.DataFrame, bucket: str = "weekly") -> pd.DataFrame:
    """Compare recent card adoption against the previous time bucket."""

    if "date" not in cards.columns or cards["date"].isna().all():
        return pd.DataFrame(
            columns=[
                "card",
                "previous_rate",
                "latest_rate",
                "trend",
                "previous_avg_count",
                "latest_avg_count",
                "avg_count_change",
            ]
        )

    period_codes = {"daily": "D", "weekly": "W", "monthly": "M"}
    period_code = period_codes[bucket]
    dated_cards = cards.dropna(subset=["date"]).copy()
    dated_cards["period"] = dated_cards["date"].dt.to_period(period_code).astype(str)

    periods = sorted(dated_cards["period"].unique())
    if len(periods) < 2:
        return pd.DataFrame(
            columns=[
                "card",
                "previous_rate",
                "latest_rate",
                "trend",
                "previous_avg_count",
                "latest_avg_count",
                "avg_count_change",
            ]
        )

    previous_period, latest_period = periods[-2], periods[-1]
    previous = _period_adoption(dated_cards[dated_cards["period"] == previous_period])
    latest = _period_adoption(dated_cards[dated_cards["period"] == latest_period])

    trends = previous.merge(latest, on="card", how="outer", suffixes=("_previous", "_latest")).fillna(0)
    trends = trends.rename(
        columns={
            "adoption_rate_previous": "previous_rate",
            "adoption_rate_latest": "latest_rate",
            "average_count_previous": "previous_avg_count",
            "average_count_latest": "latest_avg_count",
        }
    )
    trends["trend"] = trends["latest_rate"] - trends["previous_rate"]
    trends["avg_count_change"] = trends["latest_avg_count"] - trends["previous_avg_count"]
    return trends[
        [
            "card",
            "previous_rate",
            "latest_rate",
            "trend",
            "previous_avg_count",
            "latest_avg_count",
            "avg_count_change",
        ]
    ]


def best_average_placement_cards(cards: pd.DataFrame, min_decks_played: int = 3) -> pd.DataFrame:
    """Rank flex and tech cards by the average placement of decks using them."""

    if "placement" not in cards.columns or cards["placement"].isna().all():
        return pd.DataFrame(columns=["card", "category", "average_placement", "decks_played"])

    groups = classify_cards(cards)
    flex_and_tech = groups[groups["category"].isin(["flex", "tech"])]

    placements = (
        cards.merge(flex_and_tech[["card", "category"]], on="card", how="inner")
        .groupby(["card", "category"], as_index=False)
        .agg(
            average_placement=("placement", "mean"),
            decks_played=("list_id", "nunique"),
        )
        .sort_values(["average_placement", "decks_played", "card"], ascending=[True, False, True])
    )
    return placements[placements["decks_played"] >= min_decks_played]


def matchup_summary(
    selected_deck: str,
    cards: pd.DataFrame,
    matches: pd.DataFrame,
    top_n: int = 20,
    min_matches: int = 1,
) -> pd.DataFrame:
    """Calculate matchup win rates against the top overall decks."""

    empty = pd.DataFrame(
        columns=["opponent_deck", "matches", "wins", "losses", "ties", "win_rate", "loss_rate", "tie_rate"]
    )
    if matches.empty:
        return empty

    deck_map = _deck_map_from_cards(cards)
    if deck_map.empty:
        return empty

    top_decks = (
        deck_map.groupby("deck")["list_key"]
        .nunique()
        .sort_values(ascending=False)
        .head(top_n)
        .index.tolist()
    )

    match_rows = _matches_with_decks(matches, deck_map)
    if match_rows.empty:
        return empty

    selected_matches = match_rows[
        (
            (match_rows["deck"] == selected_deck)
            & (match_rows["opponent_deck"].isin(top_decks))
            & (match_rows["opponent_deck"] != selected_deck)
        )
    ].copy()
    if selected_matches.empty:
        return empty

    summary = (
        selected_matches.groupby("opponent_deck", as_index=False)
        .agg(
            matches=("result", "size"),
            wins=("result", lambda values: (values == "win").sum()),
            losses=("result", lambda values: (values == "loss").sum()),
            ties=("result", lambda values: (values == "tie").sum()),
        )
    )
    summary = summary[summary["matches"] >= min_matches].copy()
    if summary.empty:
        return empty

    summary["win_rate"] = summary["wins"] / summary["matches"]
    summary["loss_rate"] = summary["losses"] / summary["matches"]
    summary["tie_rate"] = summary["ties"] / summary["matches"]
    return summary.sort_values(["matches", "win_rate"], ascending=[False, False])


def best_decks_against_meta(
    cards: pd.DataFrame,
    matches: pd.DataFrame,
    meta_n: int = 10,
    min_matches: int = 30,
) -> pd.DataFrame:
    """Rank decks by aggregate performance against the top meta decks."""

    empty = pd.DataFrame(
        columns=[
            "deck",
            "matches",
            "wins",
            "losses",
            "ties",
            "win_rate",
            "tie_adjusted_win_rate",
            "top10_opponents_faced",
        ]
    )
    if cards.empty or matches.empty:
        return empty

    deck_map = _deck_map_from_cards(cards)
    if deck_map.empty:
        return empty

    top_decks = (
        deck_map.groupby("deck")["list_key"]
        .nunique()
        .sort_values(ascending=False)
        .head(meta_n)
        .index.tolist()
    )

    match_rows = _matches_with_decks(matches, deck_map)
    if match_rows.empty:
        return empty

    meta_matches = match_rows[
        (match_rows["opponent_deck"].isin(top_decks))
        & (match_rows["deck"] != match_rows["opponent_deck"])
    ].copy()
    if meta_matches.empty:
        return empty

    summary = (
        meta_matches.groupby("deck", as_index=False)
        .agg(
            matches=("result", "size"),
            wins=("result", lambda values: (values == "win").sum()),
            losses=("result", lambda values: (values == "loss").sum()),
            ties=("result", lambda values: (values == "tie").sum()),
            top10_opponents_faced=("opponent_deck", "nunique"),
        )
    )
    summary = summary[summary["matches"] >= min_matches].copy()
    if summary.empty:
        return empty

    summary["win_rate"] = summary["wins"] / summary["matches"]
    summary["tie_adjusted_win_rate"] = (summary["wins"] + (0.5 * summary["ties"])) / summary["matches"]
    return summary.sort_values(
        ["tie_adjusted_win_rate", "matches", "top10_opponents_faced"],
        ascending=[False, False, False],
    )


def build_deck_summary(cards: pd.DataFrame | None = None, path: str | Path = CARDS_CSV) -> pd.DataFrame:
    """Create one summary row per deck for outputs/deck_summary.csv."""

    if cards is None:
        cards = read_cards(path)

    summary = (
        cards.groupby("deck", as_index=False)
        .agg(
            deck_lists=("list_id", "nunique"),
            unique_cards=("card", "nunique"),
            total_card_rows=("card", "size"),
        )
        .sort_values(["deck_lists", "deck"], ascending=[False, True])
    )

    if "placement" in cards.columns:
        placements = cards.groupby("deck", as_index=False).agg(average_placement=("placement", "mean"))
        summary = summary.merge(placements, on="deck", how="left")

    return summary


def save_deck_summary(
    cards_path: str | Path = CARDS_CSV,
    output_path: str | Path = DECK_SUMMARY_CSV,
) -> pd.DataFrame:
    """Write outputs/deck_summary.csv and return the summary."""

    summary = build_deck_summary(path=cards_path)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    summary.to_csv(output, index=False)
    return summary


def format_percent(value: float | int | None) -> str:
    """Format a ratio as a readable percent with at most 3 decimals."""

    if value is None or pd.isna(value):
        return ""
    return f"{float(value) * 100:.3f}".rstrip("0").rstrip(".") + "%"


def format_number(value: float | int | None) -> str:
    """Format a number with at most 3 decimals."""

    if value is None or pd.isna(value):
        return ""
    return f"{float(value):.3f}".rstrip("0").rstrip(".")


def format_report_table(table: pd.DataFrame, percent_columns: Iterable[str] = ()) -> pd.DataFrame:
    """Return a copy with display-friendly numbers for terminal/dashboard use."""

    formatted = table.copy()
    for column in formatted.columns:
        if column in percent_columns:
            formatted[column] = formatted[column].apply(format_percent)
        elif pd.api.types.is_numeric_dtype(formatted[column]):
            formatted[column] = formatted[column].apply(format_number)
    return formatted


def _normalize_columns(data: pd.DataFrame) -> pd.DataFrame:
    """Map common source column names to the names used by this app."""

    normalized = data.copy()
    normalized.columns = [_clean_column_name(column) for column in normalized.columns]

    aliases = {
        "deck": ["deck", "deck_name", "archetype", "archetype_name"],
        "card": ["card", "card_name", "name"],
        "count": ["count", "qty", "quantity", "copies"],
        "player_id": ["player_id", "player", "player_name", "deck_id", "list_id"],
        "placement": ["placement", "placing", "place", "rank", "standing"],
        "date": ["date", "tournament_date", "start_date", "created_at"],
        "player1": ["player1", "player_1", "player_a"],
        "player2": ["player2", "player_2", "player_b"],
        "winner": ["winner", "winning_player"],
    }

    for target, choices in aliases.items():
        for choice in choices:
            if choice in normalized.columns and target not in normalized.columns:
                normalized = normalized.rename(columns={choice: target})
                break

    return normalized


def _clean_column_name(column: object) -> str:
    return str(column).strip().lower().replace(" ", "_").replace("-", "_")


def _card_category(adoption_rate: float) -> str:
    if adoption_rate >= CORE_THRESHOLD:
        return "core"
    if adoption_rate >= COMMON_THRESHOLD:
        return "common"
    if adoption_rate >= FLEX_THRESHOLD:
        return "flex"
    return "tech"


def _period_adoption(cards: pd.DataFrame) -> pd.DataFrame:
    deck_count = cards["list_id"].nunique()
    adoption = cards.groupby("card", as_index=False).agg(
        decks_played=("list_id", "nunique"),
        average_count=("count", "mean"),
    )
    adoption["adoption_rate"] = adoption["decks_played"] / max(deck_count, 1)
    return adoption[["card", "adoption_rate", "average_count"]]


def _deck_map_from_cards(cards: pd.DataFrame) -> pd.DataFrame:
    needed = {"tournament_id", "player_id", "deck"}
    if not needed.issubset(cards.columns):
        return pd.DataFrame(columns=["tournament_id", "player_id", "deck", "list_key"])

    deck_map = cards[["tournament_id", "player_id", "deck"]].drop_duplicates().copy()
    if "player" in cards.columns:
        names = cards[["tournament_id", "player", "deck"]].drop_duplicates().rename(columns={"player": "player_id"})
        deck_map = pd.concat([deck_map, names], ignore_index=True, sort=False)

    deck_map["tournament_id"] = deck_map["tournament_id"].astype(str)
    deck_map["player_id"] = deck_map["player_id"].astype(str)
    deck_map["list_key"] = deck_map["tournament_id"] + "::" + deck_map["player_id"]
    return deck_map.drop_duplicates()


def _list_id(cards: pd.DataFrame) -> pd.Series:
    if "tournament_id" in cards.columns:
        tournament_ids = cards["tournament_id"].fillna("unknown_tournament").astype(str)
        player_ids = cards["player_id"].fillna("").astype(str)
        return tournament_ids + "::" + player_ids
    return cards["player_id"].fillna("").astype(str)


def _matches_with_decks(matches: pd.DataFrame, deck_map: pd.DataFrame) -> pd.DataFrame:
    if matches.empty or deck_map.empty:
        return pd.DataFrame(columns=["deck", "opponent_deck", "result"])

    match_rows = matches.dropna(subset=["tournament_id"]).copy()
    match_rows["tournament_id"] = match_rows["tournament_id"].astype(str)
    match_rows["player1"] = match_rows["player1"].astype(str)
    match_rows["player2"] = match_rows["player2"].astype(str)
    match_rows["winner"] = match_rows["winner"].astype(str)

    player_one = match_rows.merge(
        deck_map.rename(columns={"player_id": "player1", "deck": "deck"}),
        on=["tournament_id", "player1"],
        how="left",
    ).merge(
        deck_map.rename(columns={"player_id": "player2", "deck": "opponent_deck"}),
        on=["tournament_id", "player2"],
        how="left",
    )
    player_one["player"] = player_one["player1"]

    player_two = match_rows.merge(
        deck_map.rename(columns={"player_id": "player2", "deck": "deck"}),
        on=["tournament_id", "player2"],
        how="left",
    ).merge(
        deck_map.rename(columns={"player_id": "player1", "deck": "opponent_deck"}),
        on=["tournament_id", "player1"],
        how="left",
    )
    player_two["player"] = player_two["player2"]

    combined = pd.concat([player_one, player_two], ignore_index=True, sort=False)
    combined = combined.dropna(subset=["deck", "opponent_deck"])
    combined = combined[(combined["player"] != "") & (combined["opponent_deck"] != "")]
    combined["result"] = combined.apply(_match_result, axis=1)
    return combined[["deck", "opponent_deck", "result"]]


def _match_result(row: pd.Series) -> str:
    winner = _clean_winner(row.get("winner", ""))
    player = str(row.get("player", ""))
    if winner == "0":
        return "tie"
    if winner == "-1":
        return "loss"
    if winner == player:
        return "win"
    return "loss"


def _clean_winner(value: object) -> str:
    text = str(value).strip()
    if text in {"0.0", "-0.0"}:
        return "0"
    if text == "-1.0":
        return "-1"
    return text
