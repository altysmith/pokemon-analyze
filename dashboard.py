"""Streamlit dashboard for Pokemon deck analysis."""

from __future__ import annotations

from datetime import date
import inspect

import pandas as pd
import streamlit as st

import pokemon_analyze.deck_analysis as deck_analysis


TOP_META_COUNT = 25


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


def _show_table(table: pd.DataFrame, percent_columns: list[str] | None = None) -> None:
    """Show a numeric table with readable formatting and real numeric sorting."""

    percent_columns = percent_columns or []
    display = table.copy()
    column_config = {}

    for column in percent_columns:
        if column in display.columns:
            display[column] = display[column] * 100
            column_config[column] = st.column_config.NumberColumn(format="%.3f%%")

    for column in display.columns:
        if column in column_config or not pd.api.types.is_numeric_dtype(display[column]):
            continue
        column_config[column] = st.column_config.NumberColumn(format="%.0f")

    st.dataframe(display, column_config=column_config, width="stretch", hide_index=True)


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


def _meta_overview(cards: pd.DataFrame, matches: pd.DataFrame, limitless_meta_decks: pd.DataFrame) -> None:
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
    meta_decks = limitless_meta_decks.head(TOP_META_COUNT).copy()
    resolved_meta = deck_analysis.resolve_meta_decks(filtered_cards, meta_decks, limit=TOP_META_COUNT)

    st.subheader(f"Best Decks Against Top {TOP_META_COUNT} Meta Decks")
    if resolved_meta.empty:
        st.info("No Limitless top-meta decks could be matched to the current card data.")
        return

    best = deck_analysis.best_decks_against_meta(
        filtered_cards,
        filtered_matches,
        **_best_meta_kwargs(TOP_META_COUNT, set(resolved_meta["local_deck"]), resolved_meta),
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
        "Favorable means 55%+ tie-adjusted win rate. Very favorable means 60%+. "
        "Candidates and targets both come from the current Limitless top-25 split-variant meta list."
    )

    for rank, row in enumerate(best.head(5).itertuples(index=False), start=1):
        details = deck_analysis.deck_matchups_against_meta(row.deck, filtered_cards, filtered_matches, resolved_meta)
        favorable = details[details["matchup_label"].isin(["favorable", "very favorable"])].sort_values(
            ["tie_adjusted_win_rate", "matches"], ascending=[False, False]
        )
        unfavorable = details[details["matchup_label"] == "unfavorable"].sort_values(
            ["tie_adjusted_win_rate", "matches"], ascending=[True, False]
        )

        st.markdown(f"### {rank}. {row.deck}")
        cols = st.columns(6)
        cols[0].metric("Meta Rank", int(row.meta_rank) if pd.notna(row.meta_rank) else "-")
        cols[1].metric("W-L-T", f"{int(row.wins)}-{int(row.losses)}-{int(row.ties)}")
        cols[2].metric("Win %", _format_percent(row.win_rate))
        cols[3].metric("Tie Adj.", _format_percent(row.tie_adjusted_win_rate))
        cols[4].metric("Favorable", int(row.favorable_matchups))
        cols[5].metric("Very Fav.", int(row.very_favorable_matchups))
        st.write(f"**Favorable matchups:** {_format_matchup_list(favorable)}")
        st.write(f"**Unfavorable matchups:** {_format_matchup_list(unfavorable)}")
        st.divider()

    full_columns = [
        "meta_rank",
        "deck",
        "matches",
        "wins",
        "losses",
        "ties",
        "win_rate",
        "tie_adjusted_win_rate",
        "favorable_matchups",
        "very_favorable_matchups",
        "meta_opponents_faced",
    ]
    st.subheader("Full Top-25 Meta Performance Table")
    _show_table(best[full_columns], percent_columns=["win_rate", "tie_adjusted_win_rate"])

    st.subheader("Current Limitless Top 25 Meta List")
    _show_table(meta_decks[["rank", "deck", "points", "share"]], percent_columns=["share"])


def _deck_detail(cards: pd.DataFrame, matches: pd.DataFrame) -> None:
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

    if bucket == "monthly" and _unique_period_count(deck_cards, "M") < 2:
        st.info("Monthly trends need data from at least two months.")
    elif bucket == "daily" and _unique_period_count(deck_cards, "D") < 2:
        st.info("Daily trends need data from at least two different days.")

    st.subheader("Matchups Against Top 25 Decks")
    matchups = deck_analysis.matchup_summary(selected_deck, filtered_cards, filtered_matches, top_n=TOP_META_COUNT)
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
if page == "Meta Overview":
    _meta_overview(cards, matches, limitless_meta_decks)
else:
    _deck_detail(cards, matches)
