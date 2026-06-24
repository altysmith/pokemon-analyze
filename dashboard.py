"""Streamlit dashboard for Pokemon deck analysis."""

from __future__ import annotations

from datetime import date
import inspect

import pandas as pd
import streamlit as st

import pokemon_analyze.deck_analysis as deck_analysis


DEFAULT_META_COUNT = 10
MAX_META_COUNT = 35
FULL_META_COUNT = 25
DETAIL_DEFAULT_META_COUNT = 25


def _filter_by_date(data: pd.DataFrame, start_date: date, end_date: date) -> pd.DataFrame:
    """Keep rows whose date falls inside the selected date window."""

    if "date" not in data.columns or data["date"].isna().all():
        return data

    start = pd.Timestamp(start_date)
    end = pd.Timestamp(end_date) + pd.Timedelta(days=1)
    return data[(data["date"] >= start) & (data["date"] < end)].copy()


def _filter_by_source(cards: pd.DataFrame, matches: pd.DataFrame, source: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    if source == "Online":
        return cards[cards["source"] == "online"].copy(), matches[matches["source"] == "online"].copy()
    if source == "Majors":
        return cards[cards["source"] == "major"].copy(), matches[matches["source"] == "major"].copy()
    return cards.copy(), matches.copy()


def _unique_period_count(cards: pd.DataFrame, period_code: str) -> int:
    if "date" not in cards.columns or cards["date"].isna().all():
        return 0
    return cards.dropna(subset=["date"])["date"].dt.to_period(period_code).nunique()


def _show_table(
    table: pd.DataFrame,
    percent_columns: list[str] | None = None,
    column_labels: dict[str, str] | None = None,
) -> None:
    """Show a numeric table with readable formatting and real numeric sorting."""

    percent_columns = percent_columns or []
    column_labels = column_labels or {}
    display = table.copy()
    column_config = {}

    for column in percent_columns:
        if column in display.columns:
            display[column] = display[column] * 100
            column_config[column] = st.column_config.NumberColumn(
                label=column_labels.get(column, column),
                format="%.3f%%",
            )

    for column in display.columns:
        if column in column_config:
            continue
        if not pd.api.types.is_numeric_dtype(display[column]):
            if column in column_labels:
                column_config[column] = st.column_config.TextColumn(label=column_labels[column])
            continue
        column_config[column] = st.column_config.NumberColumn(
            label=column_labels.get(column, column),
            format="%.0f",
        )

    st.dataframe(display, column_config=column_config, width="stretch", hide_index=True)


def _ensure_columns(table: pd.DataFrame, columns: list[str], default: int = 0) -> pd.DataFrame:
    """Add missing display columns so older generated reports still render."""

    display = table.copy()
    for column in columns:
        if column not in display.columns:
            display[column] = default
    return display


def _format_percent(value: float) -> str:
    return f"{value * 100:.1f}%"


def _format_matchup_list(rows: pd.DataFrame, limit: int = 6) -> str:
    """Build a readable matchup sentence for the top-5 overview cards."""

    if rows.empty:
        return "None in current data"

    pieces = []
    for row in rows.head(limit).itertuples(index=False):
        pieces.append(
            f"{row.opponent_deck} ({_format_percent(row.tie_adjusted_win_rate)}, "
            f"{int(row.wins)}-{int(row.losses)}-{int(row.ties)})"
        )
    return "; ".join(pieces)


def _matchup_result_label(win_rate: float) -> str:
    """Bucket a matchup into the labels players usually talk through."""

    if win_rate >= 0.65:
        return "Very Fav"
    if win_rate >= 0.55:
        return "Fav"
    if win_rate < 0.40:
        return "Very Unfav"
    if win_rate < 0.45:
        return "Unfav"
    return "Even-ish"


def _find_card_names(card_names: pd.Series | list[str], query: str) -> list[str]:
    """Find exact card-name matches first, then partial matches."""

    query_clean = str(query or "").strip().lower()
    if not query_clean:
        return []

    names = sorted({str(name) for name in card_names if str(name).strip()})
    exact = [name for name in names if name.lower() == query_clean]
    if exact:
        return exact
    return [name for name in names if query_clean in name.lower()]


def _source_decklist_url(row: pd.Series) -> str:
    """Build the best source link we can from saved tournament data."""

    tournament_id = str(row.get("tournament_id", ""))
    source = str(row.get("source", ""))
    if source == "major" and tournament_id.startswith("major-"):
        event_id = tournament_id.replace("major-", "", 1)
        return f"https://limitlesstcg.com/tournaments/{event_id}/decklists"
    if source == "online" and tournament_id:
        return f"https://play.limitlesstcg.com/tournament/{tournament_id}/standings"
    return ""


def _representative_decklists(cards: pd.DataFrame, decks: list[str]) -> pd.DataFrame:
    """Pick the newest Major list for each deck, then best placement at that Major."""

    rows: list[dict[str, object]] = []
    card_metadata = _card_metadata_lookup(cards)
    for deck in decks:
        deck_cards = _representative_cards_for_deck(cards, deck)
        if deck_cards.empty:
            continue

        list_columns = [
            "list_id",
            "deck",
            "player",
            "placement",
            "tournament_name",
            "tournament_id",
            "source",
            "date",
        ]
        available_columns = [column for column in list_columns if column in deck_cards.columns]
        lists = deck_cards[available_columns].drop_duplicates("list_id").copy()
        if "placement" in lists.columns:
            lists["placement_sort"] = pd.to_numeric(lists["placement"], errors="coerce").fillna(9999)
        else:
            lists["placement_sort"] = 9999
        if "date" in lists.columns:
            lists["date_sort"] = lists["date"].fillna(pd.Timestamp.min)
        else:
            lists["date_sort"] = pd.Timestamp.min
        best_list = lists.sort_values(["date_sort", "placement_sort"], ascending=[False, True]).iloc[0]

        list_cards = deck_cards[deck_cards["list_id"] == best_list["list_id"]].copy()
        rows.append(
            {
                "deck": best_list.get("deck", deck),
                "player": best_list.get("player", ""),
                "placement": best_list.get("placement", ""),
                "tournament": best_list.get("tournament_name", ""),
                "source_link": _source_decklist_url(best_list),
                "decklist": _format_importable_decklist(list_cards, card_metadata),
            }
        )
    return pd.DataFrame(rows)


def _recent_major_representatives(cards: pd.DataFrame, deck: str, major_count: int = 3) -> pd.DataFrame:
    """Show one best matching list from each of the most recent Major events."""

    if cards.empty:
        return pd.DataFrame()

    major_cards = cards.copy()
    if "source" in major_cards.columns:
        major_cards = major_cards[major_cards["source"] == "major"].copy()
    if major_cards.empty or "date" not in major_cards.columns:
        return pd.DataFrame()

    event_columns = ["tournament_id", "tournament_name", "date"]
    events = major_cards[event_columns].drop_duplicates().copy()
    events["date_sort"] = events["date"].fillna(pd.Timestamp.min)
    events = events.sort_values(["date_sort", "tournament_name"], ascending=[False, True]).head(major_count)

    rows: list[pd.DataFrame] = []
    for event in events.itertuples(index=False):
        event_cards = major_cards[major_cards["tournament_id"] == event.tournament_id].copy()
        exact = event_cards[event_cards["deck"] == deck].copy()
        if exact.empty:
            exact = _closest_deck_cards(event_cards, deck)
        if exact.empty:
            continue

        lists = _list_summaries(exact)
        if lists.empty:
            continue
        best = lists.sort_values(["placement_sort", "player"], ascending=[True, True]).head(1)
        rows.append(_decklist_rows_from_lists(exact, best["list_id"].tolist()))

    if not rows:
        return pd.DataFrame()
    return pd.concat(rows, ignore_index=True, sort=False)


def _closest_deck_cards(cards: pd.DataFrame, deck: str) -> pd.DataFrame:
    """Find close archetype rows when the exact local variant name is missing."""

    requested_tokens = _deck_name_tokens(deck)
    if not requested_tokens or cards.empty:
        return pd.DataFrame()

    candidates: list[tuple[int, str]] = []
    for candidate in sorted(cards["deck"].dropna().astype(str).unique()):
        candidate_tokens = _deck_name_tokens(candidate)
        if candidate_tokens.issubset(requested_tokens) or requested_tokens.issubset(candidate_tokens):
            candidates.append((len(candidate_tokens & requested_tokens), candidate))

    if not candidates:
        return pd.DataFrame()
    _, best_candidate = sorted(candidates, key=lambda item: (-item[0], item[1]))[0]
    return cards[cards["deck"] == best_candidate].copy()


def _list_summaries(cards: pd.DataFrame) -> pd.DataFrame:
    """Return one sortable row per saved decklist."""

    if cards.empty or "list_id" not in cards.columns:
        return pd.DataFrame()

    columns = [
        "list_id",
        "deck",
        "player",
        "placement",
        "tournament_name",
        "tournament_id",
        "source",
        "date",
    ]
    available = [column for column in columns if column in cards.columns]
    lists = cards[available].drop_duplicates("list_id").copy()
    if "placement" in lists.columns:
        lists["placement_sort"] = pd.to_numeric(lists["placement"], errors="coerce").fillna(9999)
    else:
        lists["placement_sort"] = 9999
    if "date" in lists.columns:
        lists["date_sort"] = lists["date"].fillna(pd.Timestamp.min)
    else:
        lists["date_sort"] = pd.Timestamp.min
    return lists


def _decklist_rows_from_lists(cards: pd.DataFrame, list_ids: list[str]) -> pd.DataFrame:
    """Build render-ready representative decklist rows from selected list ids."""

    if cards.empty or not list_ids:
        return pd.DataFrame()

    card_metadata = _card_metadata_lookup(cards)
    rows: list[dict[str, object]] = []
    lists = _list_summaries(cards[cards["list_id"].isin(list_ids)].copy())
    lists = lists.sort_values(["date_sort", "placement_sort"], ascending=[False, True])
    for list_row in lists.itertuples(index=False):
        list_cards = cards[cards["list_id"] == list_row.list_id].copy()
        rows.append(
            {
                "deck": getattr(list_row, "deck", ""),
                "player": getattr(list_row, "player", ""),
                "placement": getattr(list_row, "placement", ""),
                "tournament": getattr(list_row, "tournament_name", ""),
                "date": getattr(list_row, "date", pd.NaT),
                "source_link": _source_decklist_url(pd.Series(list_row._asdict())),
                "decklist": _format_importable_decklist(list_cards, card_metadata),
            }
        )
    return pd.DataFrame(rows)


def _representative_cards_for_deck(cards: pd.DataFrame, deck: str) -> pd.DataFrame:
    """Find Major card rows for a deck, allowing close variant names."""

    major_cards = cards.copy()
    if "source" in major_cards.columns:
        major_cards = major_cards[major_cards["source"] == "major"].copy()
    exact = major_cards[major_cards["deck"] == deck].copy()
    if not exact.empty:
        return exact

    requested_tokens = _deck_name_tokens(deck)
    if not requested_tokens:
        return exact

    candidates: list[tuple[int, str]] = []
    candidate_decks = sorted(major_cards["deck"].dropna().astype(str).unique())
    for candidate in candidate_decks:
        candidate_tokens = _deck_name_tokens(candidate)
        if not candidate_tokens:
            continue
        if candidate_tokens.issubset(requested_tokens) or requested_tokens.issubset(candidate_tokens):
            overlap = len(candidate_tokens & requested_tokens)
            candidates.append((overlap, candidate))

    if candidates:
        _, best_candidate = sorted(candidates, key=lambda item: (-item[0], item[1]))[0]
        return major_cards[major_cards["deck"] == best_candidate].copy()

    return exact


def _deck_name_tokens(deck: str) -> set[str]:
    """Normalize deck names for loose representative-list matching."""

    ignored = {"ex", "the", "box", "variant"}
    return {token for token in str(deck).lower().replace("-", " ").split() if token and token not in ignored}


def _card_metadata_lookup(cards: pd.DataFrame) -> dict[str, dict[str, str]]:
    """Build a simple card-name lookup for set/number/category fallbacks."""

    needed = {"card", "set", "number"}
    if cards.empty or not needed.issubset(cards.columns):
        return {}

    metadata: dict[str, dict[str, str]] = {}
    usable = cards.dropna(subset=["card"]).copy()
    usable["set"] = usable["set"].fillna("").astype(str)
    usable["number"] = usable["number"].fillna("").astype(str)
    if "category" not in usable.columns:
        usable["category"] = ""
    usable["category"] = usable["category"].fillna("").astype(str)

    for row in usable.itertuples(index=False):
        card_name = str(getattr(row, "card", ""))
        set_code = str(getattr(row, "set", ""))
        number = str(getattr(row, "number", ""))
        category = str(getattr(row, "category", ""))
        if not card_name or not set_code or not number:
            continue
        metadata.setdefault(
            card_name,
            {
                "category": category,
                "set": set_code,
                "number": number,
            },
        )
    return metadata


def _format_importable_decklist(cards: pd.DataFrame, metadata: dict[str, dict[str, str]]) -> str:
    """Format a decklist for copy/paste into deck building tools."""

    sections = [
        ("pokemon", "Pokémon"),
        ("trainer", "Trainer"),
        ("energy", "Energy"),
    ]
    display_cards = cards.copy()
    for column in ["category", "set", "number"]:
        if column not in display_cards.columns:
            display_cards[column] = ""
        display_cards[column] = display_cards[column].fillna("").astype(str)

    lines: list[str] = []
    for category_key, heading in sections:
        section_cards = _cards_for_section(display_cards, category_key, metadata)
        if section_cards.empty:
            continue
        total = int(section_cards["count"].sum())
        lines.append(f"{heading}: {total}")
        for row in section_cards.sort_values(["card"]).itertuples(index=False):
            card_name = str(row.card)
            fallback = metadata.get(card_name, {})
            set_code = str(row.set or fallback.get("set", "")).strip()
            number = _clean_card_number(row.number or fallback.get("number", ""))
            suffix = f" {set_code} {number}".rstrip() if set_code or number else ""
            lines.append(f"{_clean_card_count(row.count)} {card_name}{suffix}")
        lines.append("")
    return "\n".join(lines).strip()


def _clean_card_count(value: object) -> int:
    """Show decklist counts as whole numbers for import tools."""

    return int(pd.to_numeric(value, errors="coerce")) if not pd.isna(pd.to_numeric(value, errors="coerce")) else 0


def _clean_card_number(value: object) -> str:
    """Remove spreadsheet-style decimals from card numbers, such as 54.0."""

    if value is None or pd.isna(value):
        return ""
    text = str(value).strip()
    if text.endswith(".0"):
        return text[:-2]
    return text


def _cards_for_section(
    cards: pd.DataFrame,
    category_key: str,
    metadata: dict[str, dict[str, str]],
) -> pd.DataFrame:
    """Return cards matching one import section."""

    def normalized_category(row: pd.Series) -> str:
        category = str(row.get("category", "")).strip().lower()
        if category:
            return category
        fallback = metadata.get(str(row.get("card", "")), {})
        return str(fallback.get("category", "")).strip().lower()

    categories = cards.apply(normalized_category, axis=1)
    if category_key == "pokemon":
        mask = categories.str.contains("pokemon|pokémon", regex=True, na=False)
    elif category_key == "trainer":
        mask = categories.str.contains("trainer", regex=False, na=False)
    else:
        mask = categories.str.contains("energy", regex=False, na=False)
    return cards[mask].copy()


def _show_representative_decklists(representatives: pd.DataFrame, heading: str = "Representative decklists") -> None:
    """Render saved representative decklists as expandable text blocks."""

    if representatives.empty:
        st.info("No saved Major decklist found for this deck in the selected date window.")
        return

    st.markdown(heading)
    for row in representatives.itertuples(index=False):
        placement_number = pd.to_numeric(row.placement, errors="coerce")
        placement = "" if pd.isna(placement_number) else f" - {int(placement_number)}"
        label = f"{row.deck}: {row.player}{placement} at {row.tournament}"
        with st.expander(label):
            if row.source_link:
                st.link_button("Open source event", row.source_link)
            st.code(row.decklist, language="text")


def _deck_matchup_table(
    selected_deck: str,
    cards: pd.DataFrame,
    matches: pd.DataFrame,
    limitless_meta_decks: pd.DataFrame,
    meta_count: int,
    min_matches: int = 0,
) -> tuple[pd.DataFrame, pd.DataFrame, object]:
    """Build the selected deck's matchup rows against the resolved meta list."""

    meta_decks = limitless_meta_decks.head(meta_count).copy()
    resolved_meta = deck_analysis.resolve_meta_decks(cards, meta_decks, limit=meta_count)
    if resolved_meta.empty:
        return pd.DataFrame(), resolved_meta, "-"

    rank_rows = resolved_meta[resolved_meta["local_deck"] == selected_deck]
    deck_rank = "-" if rank_rows.empty else rank_rows.iloc[0]["rank"]
    details = deck_analysis.deck_matchups_against_meta(selected_deck, cards, matches, resolved_meta)

    base = resolved_meta.rename(columns={"limitless_deck": "opponent", "local_deck": "local_opponent"})[
        ["rank", "opponent", "local_opponent"]
    ].copy()
    if details.empty:
        table = base.copy()
        for column in ["matches", "wins", "losses", "ties", "win_rate", "loss_rate", "tie_rate"]:
            table[column] = 0
    else:
        details = details.rename(columns={"opponent_deck": "opponent"})
        table = base.merge(details, on="opponent", how="left")
        for column in ["matches", "wins", "losses", "ties"]:
            table[column] = pd.to_numeric(table[column], errors="coerce").fillna(0)
        table["win_rate"] = pd.to_numeric(table["win_rate"], errors="coerce").fillna(0)
        table["loss_rate"] = table["losses"] / table["matches"].replace(0, pd.NA)
        table["tie_rate"] = table["ties"] / table["matches"].replace(0, pd.NA)
        table[["loss_rate", "tie_rate"]] = table[["loss_rate", "tie_rate"]].fillna(0)
        table[["win_rate", "loss_rate", "tie_rate"]] = table[["win_rate", "loss_rate", "tie_rate"]].astype(float)

    table = table[table["local_opponent"] != selected_deck].copy()
    if min_matches:
        table = table[table["matches"] >= min_matches].copy()
    table["result"] = table["win_rate"].apply(_matchup_result_label)
    table["rank_sort"] = pd.to_numeric(table["rank"], errors="coerce").fillna(9999)
    table = table.sort_values(["rank_sort", "opponent"]).drop(columns=["rank_sort"])
    return table, resolved_meta, deck_rank


def _deck_overall_stats(matchups: pd.DataFrame, meta_rank: object) -> dict[str, object]:
    """Summarize W-L-T and rates from a selected deck matchup table."""

    wins = int(matchups["wins"].sum()) if "wins" in matchups.columns else 0
    losses = int(matchups["losses"].sum()) if "losses" in matchups.columns else 0
    ties = int(matchups["ties"].sum()) if "ties" in matchups.columns else 0
    matches = int(matchups["matches"].sum()) if "matches" in matchups.columns else 0
    rank_number = pd.to_numeric(meta_rank, errors="coerce")
    return {
        "Meta Rank": "-" if pd.isna(rank_number) else int(rank_number),
        "Win Rate": wins / matches if matches else 0,
        "Loss Rate": losses / matches if matches else 0,
        "Matches": matches,
        "W-L-T": f"{wins}-{losses}-{ties}",
        "Tie Rate": ties / matches if matches else 0,
        "Adjusted Win Rate": (wins + (deck_analysis.TIE_WIN_VALUE * ties)) / matches if matches else 0,
    }


def _show_overview_metrics(stats: dict[str, object]) -> None:
    """Render the Deck Overview top summary in the requested order."""

    columns = st.columns(7)
    for index, label in enumerate(["Meta Rank", "Win Rate", "Loss Rate", "Matches", "W-L-T", "Tie Rate", "Adjusted Win Rate"]):
        value = stats[label]
        if "Rate" in label:
            value = _format_percent(float(value))
        columns[index].metric(label, value)


def _show_favorable_buckets(matchups: pd.DataFrame) -> None:
    """Show matchup buckets with one readable row per matchup."""

    st.subheader("Favorable Matchups")
    if matchups.empty:
        st.info("No matchup rows are available for these filters.")
        return

    bucket_order = ["Very Fav", "Fav", "Even-ish", "Unfav", "Very Unfav"]
    rows = []
    for bucket in bucket_order:
        bucket_rows = matchups[matchups["result"] == bucket].sort_values(["win_rate", "matches"], ascending=[False, False])
        if bucket_rows.empty:
            rows.append({"type": bucket, "opponent": "None", "win_rate": pd.NA, "matches": pd.NA, "record": ""})
            continue
        for row in bucket_rows.itertuples(index=False):
            rows.append(
                {
                    "type": bucket,
                    "opponent": row.opponent,
                    "win_rate": row.win_rate,
                    "matches": int(row.matches),
                    "record": f"{int(row.wins)}-{int(row.losses)}-{int(row.ties)}",
                }
            )

    labels = {
        "type": "Type",
        "opponent": "Opponent",
        "win_rate": "Win %",
        "matches": "M",
        "record": "W-L-T",
    }
    _show_table(
        pd.DataFrame(rows)[["type", "opponent", "win_rate", "matches", "record"]],
        percent_columns=["win_rate"],
        column_labels=labels,
    )


def _recent_window_cards(cards: pd.DataFrame, end_date: date, days: int = 31) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split cards into recent and previous windows for trend-style searches."""

    if cards.empty or "date" not in cards.columns:
        return cards.iloc[0:0].copy(), cards.iloc[0:0].copy()

    end = pd.Timestamp(end_date) + pd.Timedelta(days=1)
    recent_start = end - pd.Timedelta(days=days)
    previous_start = recent_start - pd.Timedelta(days=days)
    dated = cards.dropna(subset=["date"]).copy()
    recent = dated[(dated["date"] >= recent_start) & (dated["date"] < end)].copy()
    previous = dated[(dated["date"] >= previous_start) & (dated["date"] < recent_start)].copy()
    return recent, previous


def _usage_table(cards: pd.DataFrame) -> pd.DataFrame:
    """Return per-card usage for a card pool."""

    if cards.empty:
        return pd.DataFrame(columns=["card", "lists", "usage_rate", "avg_count", "max_count"])

    total_lists = max(cards["list_id"].nunique(), 1)
    usage = (
        cards.groupby("card", as_index=False)
        .agg(
            lists=("list_id", "nunique"),
            avg_count=("count", "mean"),
            max_count=("count", "max"),
        )
        .sort_values(["lists", "avg_count", "card"], ascending=[False, False, True])
    )
    usage["usage_rate"] = usage["lists"] / total_lists
    return usage


def _rising_cards(cards: pd.DataFrame, end_date: date) -> pd.DataFrame:
    """Compare recent card usage to the prior 31 days for one archetype."""

    recent, previous = _recent_window_cards(cards, end_date)
    recent_usage = _usage_table(recent).rename(
        columns={"usage_rate": "recent_usage", "avg_count": "recent_avg_count", "lists": "recent_lists"}
    )
    previous_usage = _usage_table(previous).rename(columns={"usage_rate": "previous_usage"})
    if recent_usage.empty and previous_usage.empty:
        return pd.DataFrame(columns=["card", "recent_usage", "previous_usage", "change", "recent_avg_count", "recent_lists"])

    trends = recent_usage[["card", "recent_usage", "recent_avg_count", "recent_lists"]].merge(
        previous_usage[["card", "previous_usage"]],
        on="card",
        how="outer",
    ).fillna(0)
    trends["change"] = trends["recent_usage"] - trends["previous_usage"]
    return trends.sort_values(["change", "recent_usage", "card"], ascending=[False, False, True])


def _archetype_card_search(cards: pd.DataFrame, query: str) -> tuple[str, pd.DataFrame, pd.DataFrame]:
    """Search one selected archetype for a card and return summary plus lists."""

    summary_columns = ["matched_card", "lists_with_card", "usage_rate", "avg_placement_with", "avg_placement_without"]
    if cards.empty:
        return query, pd.DataFrame(columns=summary_columns), pd.DataFrame()

    matches = _find_card_names(cards["card"].dropna().astype(str).unique().tolist(), query)
    matched = ", ".join(matches) if matches else query
    list_count = max(cards["list_id"].nunique(), 1)
    list_summaries = _list_summaries(cards)
    with_ids = set(cards[cards["card"].isin(matches)]["list_id"].dropna().astype(str).unique()) if matches else set()
    with_lists = list_summaries[list_summaries["list_id"].isin(with_ids)]
    without_lists = list_summaries[~list_summaries["list_id"].isin(with_ids)]
    summary = pd.DataFrame(
        [
            {
                "matched_card": matched,
                "lists_with_card": len(with_ids),
                "usage_rate": len(with_ids) / list_count,
                "avg_placement_with": with_lists["placement_sort"].mean() if not with_lists.empty else pd.NA,
                "avg_placement_without": without_lists["placement_sort"].mean() if not without_lists.empty else pd.NA,
            }
        ]
    )
    list_rows = _decklist_rows_from_lists(cards, with_lists.sort_values(["date_sort", "placement_sort"], ascending=[False, True])["list_id"].head(10).tolist())
    return matched, summary, list_rows


def _meta_card_search(cards: pd.DataFrame, all_source_cards: pd.DataFrame, query: str, end_date: date) -> tuple[str, pd.DataFrame, pd.DataFrame]:
    """Search the whole selected meta for one card and show deck-level prevalence."""

    summary_columns = [
        "matched_card",
        "total_lists_using",
        "meta_usage",
        "avg_count",
        "max_count",
        "recent_usage",
        "previous_usage",
        "change",
    ]
    breakdown_columns = ["deck", "lists_with_card", "usage_in_deck", "avg_count"]
    if cards.empty:
        return query, pd.DataFrame(columns=summary_columns), pd.DataFrame(columns=breakdown_columns)

    matches = _find_card_names(cards["card"].dropna().astype(str).unique().tolist(), query)
    matched = ", ".join(matches) if matches else query
    total_lists = max(cards["list_id"].nunique(), 1)
    card_rows = cards[cards["card"].isin(matches)].copy() if matches else cards.iloc[0:0].copy()
    list_ids = set(card_rows["list_id"].dropna().astype(str).unique())

    recent_all, previous_all = _recent_window_cards(all_source_cards, end_date)
    recent_card_rows = recent_all[recent_all["card"].isin(matches)] if matches else recent_all.iloc[0:0]
    previous_card_rows = previous_all[previous_all["card"].isin(matches)] if matches else previous_all.iloc[0:0]
    recent_total = max(recent_all["list_id"].nunique(), 1) if not recent_all.empty else 1
    previous_total = max(previous_all["list_id"].nunique(), 1) if not previous_all.empty else 1
    recent_usage = recent_card_rows["list_id"].nunique() / recent_total
    previous_usage = previous_card_rows["list_id"].nunique() / previous_total

    summary = pd.DataFrame(
        [
            {
                "matched_card": matched,
                "total_lists_using": len(list_ids),
                "meta_usage": len(list_ids) / total_lists,
                "avg_count": card_rows["count"].mean() if not card_rows.empty else 0,
                "max_count": card_rows["count"].max() if not card_rows.empty else 0,
                "recent_usage": recent_usage,
                "previous_usage": previous_usage,
                "change": recent_usage - previous_usage,
            }
        ]
    )
    if card_rows.empty:
        return matched, summary, pd.DataFrame(columns=breakdown_columns)

    deck_totals = cards.groupby("deck", as_index=False).agg(total_lists=("list_id", "nunique"))
    breakdown = (
        card_rows.groupby("deck", as_index=False)
        .agg(lists_with_card=("list_id", "nunique"), avg_count=("count", "mean"))
        .merge(deck_totals, on="deck", how="left")
    )
    breakdown["usage_in_deck"] = breakdown["lists_with_card"] / breakdown["total_lists"].replace(0, pd.NA)
    return matched, summary, breakdown[breakdown_columns].sort_values(["lists_with_card", "usage_in_deck"], ascending=[False, False])


def _best_meta_kwargs(
    meta_count: int,
    eligible_decks: set[str],
    resolved_meta: pd.DataFrame,
) -> dict[str, object]:
    """Pass only arguments supported by the deployed analysis module."""

    kwargs: dict[str, object] = {
        "meta_n": meta_count,
        "min_matches": 1,
        "eligible_decks": eligible_decks,
        "meta_deck_map": resolved_meta,
    }
    accepted_args = inspect.signature(deck_analysis.best_decks_against_meta).parameters
    return {name: value for name, value in kwargs.items() if name in accepted_args}


def _add_meta_rank_columns(report: pd.DataFrame, resolved_meta: pd.DataFrame, meta_decks: pd.DataFrame) -> pd.DataFrame:
    """Attach Limitless rank/share to the matchup report."""

    if report.empty or resolved_meta.empty:
        return report

    meta_values = meta_decks.rename(
        columns={"deck": "limitless_deck", "points": "meta_points", "share": "meta_share"}
    )[["limitless_deck", "meta_points", "meta_share"]]
    meta_details = (
        resolved_meta.rename(columns={"local_deck": "deck", "rank": "meta_rank"})
        .merge(meta_values, on="limitless_deck", how="left")
        [["deck", "meta_rank", "meta_points", "meta_share"]]
        .sort_values(["deck", "meta_rank"], ascending=[True, True])
        .drop_duplicates("deck", keep="first")
    )
    return report.merge(meta_details, on="deck", how="left")


def _render_deck_meta_summary(deck: str, details: pd.DataFrame, meta_rank: object = "-") -> None:
    """Show a compact matchup summary for one selected deck."""

    st.subheader(f"{deck} Meta Matchup Summary")
    if details.empty:
        st.info("No top-meta matchup rows are available for this deck and filter set.")
        return

    wins = int(details["wins"].sum())
    losses = int(details["losses"].sum())
    ties = int(details["ties"].sum())
    matches = int(details["matches"].sum())
    win_rate = wins / matches if matches else 0
    adjusted_rate = (wins + (deck_analysis.TIE_WIN_VALUE * ties)) / matches if matches else 0
    favorable = details[details["matchup_label"].isin(["favorable", "very favorable"])].sort_values(
        ["tie_adjusted_win_rate", "matches"], ascending=[False, False]
    )
    unfavorable = details[details["matchup_label"].isin(["unfavorable", "very unfavorable"])].sort_values(
        ["tie_adjusted_win_rate", "matches"], ascending=[True, False]
    )
    very_unfavorable = details[details["matchup_label"] == "very unfavorable"].sort_values(
        ["tie_adjusted_win_rate", "matches"], ascending=[True, False]
    )

    rank_value = "-"
    rank_number = pd.to_numeric(meta_rank, errors="coerce")
    if not pd.isna(rank_number):
        rank_value = int(rank_number)

    cols = st.columns(8)
    cols[0].metric("Meta Rank", rank_value)
    cols[1].metric("W-L-T", f"{wins}-{losses}-{ties}")
    cols[2].metric("Win %", _format_percent(win_rate))
    cols[3].metric("Adj. Win %", _format_percent(adjusted_rate))
    cols[4].metric("Favorable", int(details["matchup_label"].isin(["favorable", "very favorable"]).sum()))
    cols[5].metric("Very Fav.", int((details["matchup_label"] == "very favorable").sum()))
    cols[6].metric("Unfav.", int(details["matchup_label"].isin(["unfavorable", "very unfavorable"]).sum()))
    cols[7].metric("Very Unfav.", int((details["matchup_label"] == "very unfavorable").sum()))
    st.write(f"**Favorable matchups:** {_format_matchup_list(favorable)}")
    st.write(f"**Unfavorable matchups:** {_format_matchup_list(unfavorable)}")
    st.write(f"**Very unfavorable matchups:** {_format_matchup_list(very_unfavorable)}")


def _meta_overview(
    cards: pd.DataFrame,
    matches: pd.DataFrame,
    limitless_meta_decks: pd.DataFrame,
    meta_count: int,
) -> None:
    """Opening page: top meta list and best performers into that meta."""

    st.header("Meta Overview")

    today = pd.Timestamp.today().normalize()
    default_start = today - pd.Timedelta(days=31)
    source_col, start_col, end_col = st.columns([1, 1, 1])
    with source_col:
        selected_source = st.selectbox("Source", ["All", "Online", "Majors"])
    with start_col:
        start_date = st.date_input("Start date", value=default_start.date(), key="overview_start")
    with end_col:
        end_date = st.date_input("End date", value=today.date(), key="overview_end")

    source_cards, source_matches = _filter_by_source(cards, matches, selected_source)
    filtered_cards = _filter_by_date(source_cards, start_date, end_date)
    filtered_matches = _filter_by_date(source_matches, start_date, end_date)
    meta_decks = limitless_meta_decks.head(meta_count).copy()
    resolved_meta = deck_analysis.resolve_meta_decks(filtered_cards, meta_decks, limit=meta_count)

    st.subheader(f"Best Decks Against Top {meta_count} Meta Decks")
    if resolved_meta.empty:
        st.info("No Limitless top-meta decks could be matched to the current card data.")
        return

    best = deck_analysis.best_decks_against_meta(
        filtered_cards,
        filtered_matches,
        **_best_meta_kwargs(meta_count, set(resolved_meta["local_deck"]), resolved_meta),
    )
    best = _add_meta_rank_columns(best, resolved_meta, meta_decks)
    if best.empty:
        st.info("No matchup rows are available for the current source/date filters.")
        return

    total_matches = int(best["matches"].sum())
    top_favorable = int(best["favorable_matchups"].max())
    metric_one, metric_two, metric_three = st.columns(3)
    metric_one.metric("Meta Decks", len(resolved_meta))
    metric_two.metric("Top Favorable Count", top_favorable)
    metric_three.metric("Recorded Match Rows", total_matches)

    st.caption(
        "Favorable means 55%+ tie-adjusted win rate, with ties counted as one-third of a win. "
        "Very favorable means over 60%. "
        "Unfavorable means under 45%, and very unfavorable means under 40%. "
        f"Candidates and targets both come from the current Limitless top-{meta_count} split-variant meta list."
    )

    most_favorable = best.head(5).copy()
    highest_win_rate = best.sort_values(
        ["tie_adjusted_win_rate", "matches"],
        ascending=[False, False],
    ).head(5)
    highest_non_dragapult = (
        best[~best["deck"].astype(str).str.contains("Dragapult", case=False, na=False)]
        .sort_values(["tie_adjusted_win_rate", "matches"], ascending=[False, False])
        .head(5)
    )
    matchup_columns = [
        "deck",
        "matches",
        "favorable_matchups",
        "unfavorable_matchups",
        "very_unfavorable_matchups",
        "win_rate",
        "tie_adjusted_win_rate",
    ]
    win_rate_columns = [
        "deck",
        "matches",
        "win_rate",
        "tie_adjusted_win_rate",
        "favorable_matchups",
        "unfavorable_matchups",
        "very_unfavorable_matchups",
    ]
    compact_labels = {
        "deck": "Deck",
        "matches": "M",
        "win_rate": "Win",
        "tie_adjusted_win_rate": "Adj",
        "favorable_matchups": "Fav MU",
        "unfavorable_matchups": "Unfav MU",
        "very_unfavorable_matchups": "V Unfav MU",
    }
    spread_col, win_col, non_dragapult_col = st.columns(3)
    with spread_col:
        st.markdown("#### Most Favorable Matchups")
        _show_table(
            most_favorable[matchup_columns],
            percent_columns=["win_rate", "tie_adjusted_win_rate"],
            column_labels=compact_labels,
        )
    with win_col:
        st.markdown("#### Highest Adjusted Win %")
        _show_table(
            highest_win_rate[win_rate_columns],
            percent_columns=["win_rate", "tie_adjusted_win_rate"],
            column_labels=compact_labels,
        )
    with non_dragapult_col:
        st.markdown("#### Highest Adjusted Win % Non Dragapult")
        _show_table(
            highest_non_dragapult[win_rate_columns],
            percent_columns=["win_rate", "tie_adjusted_win_rate"],
            column_labels=compact_labels,
        )

    st.subheader("Best Decks To Beat One Target")
    target_options = resolved_meta.sort_values("rank").copy()
    target_labels = {
        row.local_deck: f"{int(row.rank)}. {row.limitless_deck}"
        for row in target_options.itertuples(index=False)
        if pd.notna(row.rank)
    }
    target_col, sample_col = st.columns([2, 1])
    with target_col:
        target_deck = st.selectbox(
            "Target deck",
            target_options["local_deck"].tolist(),
            format_func=lambda deck: target_labels.get(deck, deck),
        )
    with sample_col:
        min_target_matches = st.number_input("Minimum matches", min_value=1, max_value=100, value=30, step=1)

    target_report = deck_analysis.best_decks_against_target(
        target_deck,
        filtered_cards,
        filtered_matches,
        min_matches=int(min_target_matches),
    )
    if target_report.empty:
        st.info("No decks meet the current minimum match count into that target.")
    else:
        top_target_decks = target_report.head(5).copy()
        _show_table(
            top_target_decks,
            percent_columns=["win_rate", "tie_adjusted_win_rate"],
        )
        major_link_cards = _filter_by_date(cards, start_date, end_date)
        representatives = _representative_decklists(major_link_cards, top_target_decks["deck"].tolist())
        _show_representative_decklists(representatives)

    full_columns = [
        "meta_rank",
        "deck",
        "meta_share",
        "matches",
        "wins",
        "losses",
        "ties",
        "win_rate",
        "tie_adjusted_win_rate",
        "favorable_matchups",
        "very_favorable_matchups",
        "unfavorable_matchups",
        "very_unfavorable_matchups",
    ]
    full_labels = {
        "meta_rank": "Rank",
        "deck": "Deck",
        "meta_share": "Share",
        "matches": "M",
        "wins": "W",
        "losses": "L",
        "ties": "T",
        "win_rate": "Win",
        "tie_adjusted_win_rate": "Adj",
        "favorable_matchups": "Fav MU",
        "very_favorable_matchups": "V Fav MU",
        "unfavorable_matchups": "Unfav MU",
        "very_unfavorable_matchups": "V Unfav MU",
    }
    full_meta_decks = limitless_meta_decks.head(FULL_META_COUNT).copy()
    full_resolved_meta = deck_analysis.resolve_meta_decks(filtered_cards, full_meta_decks, limit=FULL_META_COUNT)
    st.subheader(f"Full Top-{FULL_META_COUNT} Meta Performance Table")
    if full_resolved_meta.empty:
        st.info("No Limitless top-25 meta decks could be matched to the current card data.")
    else:
        full_best = deck_analysis.best_decks_against_meta(
            filtered_cards,
            filtered_matches,
            **_best_meta_kwargs(FULL_META_COUNT, set(full_resolved_meta["local_deck"]), full_resolved_meta),
        )
        full_best = _add_meta_rank_columns(full_best, full_resolved_meta, full_meta_decks)
        best_display = _ensure_columns(full_best, full_columns)
        best_display = best_display.sort_values("meta_rank", ascending=True)
        _show_table(
            best_display[full_columns],
            percent_columns=["meta_share", "win_rate", "tie_adjusted_win_rate"],
            column_labels=full_labels,
        )


def _deck_detail(
    cards: pd.DataFrame,
    matches: pd.DataFrame,
    limitless_meta_decks: pd.DataFrame,
    meta_count: int,
) -> None:
    """Second page: individual deck analysis."""

    st.header("Deck Detail")

    today = pd.Timestamp.today().normalize()
    default_start = today - pd.Timedelta(days=31)
    source_col, deck_col, start_col, end_col = st.columns([1, 2, 1, 1])
    with source_col:
        selected_source = st.selectbox("Source", ["All", "Online", "Majors"], key="detail_source")

    source_cards, source_matches = _filter_by_source(cards, matches, selected_source)
    deck_counts = source_cards.groupby("deck")["list_id"].nunique().sort_values(ascending=False)
    if deck_counts.empty:
        st.warning("No decks found for the selected source.")
        return

    with deck_col:
        selected_deck = st.selectbox(
            "Deck",
            deck_counts.index.tolist(),
            format_func=lambda deck: f"{deck} ({int(deck_counts[deck])} lists)",
        )
    with start_col:
        start_date = st.date_input("Start date", value=default_start.date(), key="detail_start")
    with end_col:
        end_date = st.date_input("End date", value=today.date(), key="detail_end")

    filtered_cards = _filter_by_date(source_cards, start_date, end_date)
    filtered_matches = _filter_by_date(source_matches, start_date, end_date)
    filtered_deck_counts = filtered_cards.groupby("deck")["list_id"].nunique().sort_values(ascending=False)
    if selected_deck not in filtered_deck_counts:
        st.warning("This deck has no lists in the selected date window.")
        return

    deck_cards = filtered_cards[filtered_cards["deck"] == selected_deck]
    deck_list_count = int(filtered_deck_counts[selected_deck])
    date_range = "Unknown"
    if "date" in deck_cards.columns and deck_cards["date"].notna().any():
        date_range = f"{deck_cards['date'].min().date()} to {deck_cards['date'].max().date()}"

    st.caption(f"{deck_list_count} selected lists | {int(deck_cards['card'].nunique())} unique cards | {date_range}")

    overview_tab, matchup_tab, tech_tab = st.tabs(["Overview", "Matchup Explorer", "Decklists & Tech"])

    with overview_tab:
        overview_matchups, _, overview_rank = _deck_matchup_table(
            selected_deck,
            filtered_cards,
            filtered_matches,
            limitless_meta_decks,
            FULL_META_COUNT,
        )
        _show_overview_metrics(_deck_overall_stats(overview_matchups, overview_rank))

        _show_favorable_buckets(overview_matchups)

        st.subheader("Top 25 Meta Matchups")
        if overview_matchups.empty:
            st.info("No top-25 matchup rows are available for this deck and filter set.")
        else:
            overview_columns = ["opponent", "matches", "win_rate", "loss_rate", "wins", "losses", "ties"]
            overview_labels = {
                "opponent": "Opponent",
                "matches": "Matches",
                "win_rate": "Win %",
                "loss_rate": "Loss %",
                "wins": "W",
                "losses": "L",
                "ties": "T",
            }
            _show_table(
                overview_matchups[overview_columns],
                percent_columns=["win_rate", "loss_rate"],
                column_labels=overview_labels,
            )

        representatives = _recent_major_representatives(cards, selected_deck, major_count=3)
        _show_representative_decklists(representatives, heading="Representative decklists from last 3 Majors")

    with matchup_tab:
        filter_col, sample_col = st.columns([1, 1])
        with filter_col:
            detail_meta_count = st.slider(
                "Top meta count",
                min_value=5,
                max_value=MAX_META_COUNT,
                value=DETAIL_DEFAULT_META_COUNT,
                step=1,
                key="detail_matchup_meta_count",
            )
        with sample_col:
            min_matchups = st.number_input(
                "Minimum matches",
                min_value=1,
                max_value=300,
                value=30,
                step=1,
                key="detail_matchup_min_matches",
            )

        explorer_matchups, _, _ = _deck_matchup_table(
            selected_deck,
            filtered_cards,
            filtered_matches,
            limitless_meta_decks,
            detail_meta_count,
            min_matches=int(min_matchups),
        )
        st.subheader(f"{selected_deck} Against Top {detail_meta_count} Meta")
        if explorer_matchups.empty:
            st.info("No matchup rows meet the current minimum match count.")
        else:
            matchup_columns = ["opponent", "matches", "win_rate", "loss_rate", "tie_rate", "wins", "losses", "ties", "result"]
            matchup_labels = {
                "opponent": "Opponent",
                "matches": "M",
                "win_rate": "Win",
                "loss_rate": "Loss",
                "tie_rate": "Tie",
                "wins": "W",
                "losses": "L",
                "ties": "T",
                "result": "Result",
            }
            _show_table(
                explorer_matchups[matchup_columns],
                percent_columns=["win_rate", "loss_rate", "tie_rate"],
                column_labels=matchup_labels,
            )

        st.subheader(f"Best Decks To Beat {selected_deck}")
        target_report = deck_analysis.best_decks_against_target(
            selected_deck,
            filtered_cards,
            filtered_matches,
            min_matches=int(min_matchups),
        )
        if target_report.empty:
            st.info("No counter decks meet the current minimum match count.")
        else:
            target_report = target_report.head(5).copy()
            target_report["loss_rate"] = target_report["losses"] / target_report["matches"].replace(0, pd.NA)
            target_report["loss_rate"] = target_report["loss_rate"].fillna(0).astype(float)
            target_report["result"] = target_report["win_rate"].apply(_matchup_result_label)
            counter_columns = ["deck", "matches", "win_rate", "loss_rate", "wins", "losses", "ties", "result"]
            counter_labels = {
                "deck": "Deck",
                "matches": "M",
                "win_rate": "Win",
                "loss_rate": "Loss",
                "wins": "W",
                "losses": "L",
                "ties": "T",
                "result": "Result",
            }
            _show_table(
                target_report[counter_columns],
                percent_columns=["win_rate", "loss_rate"],
                column_labels=counter_labels,
            )
            representatives = _representative_decklists(cards, target_report["deck"].tolist())
            _show_representative_decklists(representatives, heading="Counter deck representative lists")

    with tech_tab:
        st.subheader("Recent Major Lists")
        recent_major_cards = _representative_cards_for_deck(cards, selected_deck)
        recent_lists = _list_summaries(recent_major_cards)
        if recent_lists.empty:
            st.info("No saved Major lists found for this deck.")
        else:
            recent_list_ids = recent_lists.sort_values(["date_sort", "placement_sort"], ascending=[False, True])[
                "list_id"
            ].head(10).tolist()
            _show_representative_decklists(
                _decklist_rows_from_lists(recent_major_cards, recent_list_ids),
                heading="Recent Major decklists",
            )

        st.subheader("New / Rising Cards")
        rising = _rising_cards(source_cards[source_cards["deck"] == selected_deck].copy(), end_date)
        if rising.empty:
            st.info("Rising cards need dated lists from the recent and previous 31-day windows.")
        else:
            rising_columns = ["card", "recent_usage", "previous_usage", "change", "recent_avg_count", "recent_lists"]
            rising_labels = {
                "card": "Card",
                "recent_usage": "Recent",
                "previous_usage": "Previous",
                "change": "Change",
                "recent_avg_count": "Avg Count",
                "recent_lists": "Lists",
            }
            _show_table(
                rising.head(25)[rising_columns],
                percent_columns=["recent_usage", "previous_usage", "change"],
                column_labels=rising_labels,
            )

        st.subheader("Archetype Card Search")
        archetype_query = st.text_input("Search this deck for a card", key=f"archetype_card_{selected_deck}")
        if archetype_query.strip():
            matched_card, card_summary, list_rows = _archetype_card_search(deck_cards, archetype_query)
            st.caption(f"Search matched: {matched_card}")
            archetype_labels = {
                "matched_card": "Card",
                "lists_with_card": "Lists",
                "usage_rate": "Usage",
                "avg_placement_with": "Avg Place With",
                "avg_placement_without": "Avg Place Without",
            }
            _show_table(card_summary, percent_columns=["usage_rate"], column_labels=archetype_labels)
            _show_representative_decklists(list_rows, heading="Recent lists using this card")

        st.subheader("Meta Card Search")
        meta_query = st.text_input("Search the whole meta for a card", key="meta_card_search")
        if meta_query.strip():
            matched_card, meta_summary, meta_breakdown = _meta_card_search(
                filtered_cards,
                source_cards,
                meta_query,
                end_date,
            )
            st.caption(f"Search matched: {matched_card}")
            meta_labels = {
                "matched_card": "Card",
                "total_lists_using": "Lists",
                "meta_usage": "Meta Usage",
                "avg_count": "Avg Count",
                "max_count": "Max Count",
                "recent_usage": "Recent",
                "previous_usage": "Previous",
                "change": "Change",
            }
            _show_table(
                meta_summary,
                percent_columns=["meta_usage", "recent_usage", "previous_usage", "change"],
                column_labels=meta_labels,
            )
            if meta_breakdown.empty:
                st.info("No selected meta lists include that card.")
            else:
                breakdown_labels = {
                    "deck": "Deck",
                    "lists_with_card": "Lists",
                    "usage_in_deck": "Usage",
                    "avg_count": "Avg Count",
                }
                _show_table(
                    meta_breakdown.head(25),
                    percent_columns=["usage_in_deck"],
                    column_labels=breakdown_labels,
                )


st.set_page_config(page_title="Pokemon Analyze", layout="wide")
st.title("Pokemon Analyze")

try:
    cards = deck_analysis.read_cards()
except (FileNotFoundError, ValueError) as error:
    st.error(str(error))
    st.stop()

matches = deck_analysis.read_matches()
limitless_meta_decks = deck_analysis.read_limitless_meta_decks()

page = st.sidebar.radio("Page", ["Meta Overview", "Deck Detail"])
meta_count = st.sidebar.slider(
    "Meta deck count",
    min_value=1,
    max_value=MAX_META_COUNT,
    value=DEFAULT_META_COUNT,
    step=1,
)
if page == "Meta Overview":
    _meta_overview(cards, matches, limitless_meta_decks, meta_count)
else:
    _deck_detail(cards, matches, limitless_meta_decks, meta_count)
