"""Streamlit dashboard for Pokemon deck analysis."""

from __future__ import annotations

from datetime import date
import inspect

import pandas as pd
import streamlit as st

import pokemon_analyze.deck_analysis as deck_analysis


DEFAULT_META_COUNT = 10
MAX_META_COUNT = 25


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
        deck_cards = cards[cards["deck"] == deck].copy()
        if "source" in deck_cards.columns:
            deck_cards = deck_cards[deck_cards["source"] == "major"].copy()
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
                "deck": deck,
                "player": best_list.get("player", ""),
                "placement": best_list.get("placement", ""),
                "tournament": best_list.get("tournament_name", ""),
                "source_link": _source_decklist_url(best_list),
                "decklist": _format_importable_decklist(list_cards, card_metadata),
            }
        )
    return pd.DataFrame(rows)


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
            number = str(row.number or fallback.get("number", "")).strip()
            suffix = f" {set_code} {number}".rstrip() if set_code or number else ""
            lines.append(f"{int(row.count)} {card_name}{suffix}")
        lines.append("")
    return "\n".join(lines).strip()


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
    st.subheader(f"Full Top-{meta_count} Meta Performance Table")
    best_display = _ensure_columns(best, full_columns)
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
    source_col, deck_col, bucket_col, start_col, end_col = st.columns([1, 2, 1, 1, 1])
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
    with bucket_col:
        bucket = st.radio("Trend bucket", ["daily", "monthly"], index=1, horizontal=True)
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
    min_default = min(max(5, int(round(deck_list_count * 0.05))), max(deck_list_count, 1))
    min_tech_decks = st.slider(
        "Minimum decks for tech/flex placement",
        min_value=1,
        max_value=max(deck_list_count, 1),
        value=min_default,
    )

    report = deck_analysis.analyze_deck(
        selected_deck,
        cards=filtered_cards,
        bucket=bucket,
        limit=100,
        min_tech_decks=min_tech_decks,
    )

    date_range = ""
    if "date" in deck_cards.columns and deck_cards["date"].notna().any():
        date_range = f"{deck_cards['date'].min().date()} to {deck_cards['date'].max().date()}"

    metric_one, metric_two, metric_three = st.columns(3)
    metric_one.metric("Deck Lists", deck_list_count)
    metric_two.metric("Unique Cards", int(deck_cards["card"].nunique()))
    metric_three.metric("Date Range", date_range or "Unknown")

    major_link_cards = _filter_by_date(cards, start_date, end_date)
    representatives = _representative_decklists(major_link_cards, [selected_deck])
    _show_representative_decklists(representatives, heading="Newest Major representative decklist")

    meta_decks = limitless_meta_decks.head(meta_count).copy()
    resolved_meta = deck_analysis.resolve_meta_decks(filtered_cards, meta_decks, limit=meta_count)
    deck_rank = "-"
    rank_rows = resolved_meta[resolved_meta["local_deck"] == selected_deck] if not resolved_meta.empty else pd.DataFrame()
    if not rank_rows.empty:
        deck_rank = rank_rows.iloc[0]["rank"]
    meta_details = deck_analysis.deck_matchups_against_meta(selected_deck, filtered_cards, filtered_matches, resolved_meta)
    _render_deck_meta_summary(selected_deck, meta_details, deck_rank)

    st.subheader("Card Impact Against Top 15 Meta")
    card_query = st.text_input("Card name", key=f"card_impact_{selected_deck}")
    if card_query.strip():
        impact_meta_decks = limitless_meta_decks.head(15).copy()
        impact_meta = deck_analysis.resolve_meta_decks(filtered_cards, impact_meta_decks, limit=15)
        matched_card, impact_summary, impact_matchups = deck_analysis.card_impact_against_meta(
            selected_deck,
            card_query,
            filtered_cards,
            filtered_matches,
            impact_meta,
        )
        st.caption(f"Search matched: {matched_card}")
        if not impact_summary.empty:
            with_count = int(impact_summary.loc[impact_summary["group"] == "With card", "lists"].sum())
            if with_count == 0:
                st.info("No saved decklists for this deck include that card in the selected filters.")
            summary_labels = {
                "group": "Set",
                "lists": "Lists",
                "matches": "M",
                "wins": "W",
                "losses": "L",
                "ties": "T",
                "win_rate": "Win",
                "tie_adjusted_win_rate": "Adj",
            }
            _show_table(
                impact_summary,
                percent_columns=["win_rate", "tie_adjusted_win_rate"],
                column_labels=summary_labels,
            )
        matchup_labels = {
            "opponent_deck": "MU",
            "with_matches": "In M",
            "with_wins": "In W",
            "with_losses": "In L",
            "with_ties": "In T",
            "with_tie_adjusted_win_rate": "In Adj",
            "without_matches": "Out M",
            "without_wins": "Out W",
            "without_losses": "Out L",
            "without_ties": "Out T",
            "without_tie_adjusted_win_rate": "Out Adj",
            "delta_tie_adjusted_win_rate": "Change vs Out",
        }
        if impact_matchups.empty:
            st.info("No top-15 matchup rows are available for this card search and filter set.")
        else:
            _show_table(
                impact_matchups,
                percent_columns=[
                    "with_tie_adjusted_win_rate",
                    "without_tie_adjusted_win_rate",
                    "delta_tie_adjusted_win_rate",
                ],
                column_labels=matchup_labels,
            )
    else:
        st.info("Type a card name to compare lists with and without that card into the top 15 meta decks.")

    if bucket == "monthly" and _unique_period_count(deck_cards, "M") < 2:
        st.info("Monthly trends need data from at least two months.")
    elif bucket == "daily" and _unique_period_count(deck_cards, "D") < 2:
        st.info("Daily trends need data from at least two different days.")

    st.subheader(f"Matchups Against Top {meta_count} Decks")
    matchups = deck_analysis.matchup_summary(selected_deck, filtered_cards, filtered_matches, top_n=meta_count)
    if matchups.empty:
        st.info("No matchup rows are available for this deck and filter set.")
    else:
        _show_table(matchups, percent_columns=["win_rate", "loss_rate", "tie_rate"])

    st.subheader("Core / Common / Flex / Tech Cards")
    _show_table(report.card_groups, percent_columns=["adoption_rate"])

    trend_up, trend_down = st.columns(2)
    with trend_up:
        st.subheader("Trending Up Cards")
        if report.trending_up.empty:
            st.info("No trend yet. Pull data from at least two daily or monthly buckets.")
        else:
            _show_table(report.trending_up, percent_columns=["previous_rate", "latest_rate", "trend"])

    with trend_down:
        st.subheader("Trending Down Cards")
        if report.trending_down.empty:
            st.info("No trend yet. Pull data from at least two daily or monthly buckets.")
        else:
            _show_table(report.trending_down, percent_columns=["previous_rate", "latest_rate", "trend"])

    st.subheader("Best Average Placement Tech/Flex Cards")
    if report.best_placement_cards.empty:
        st.info("No tech/flex placement rows meet the current minimum deck count.")
    else:
        _show_table(report.best_placement_cards)


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
