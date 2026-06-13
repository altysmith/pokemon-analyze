"""Streamlit dashboard for Pokemon deck analysis."""

from __future__ import annotations

from datetime import date

import pandas as pd
import streamlit as st

from reports.deck_analysis import analyze_deck, best_decks_against_meta, matchup_summary, read_cards, read_matches


def _filter_cards_by_date(cards: pd.DataFrame, start_date: date, end_date: date) -> pd.DataFrame:
    if "date" not in cards.columns or cards["date"].isna().all():
        return cards

    start = pd.Timestamp(start_date)
    end = pd.Timestamp(end_date) + pd.Timedelta(days=1)
    return cards[(cards["date"] >= start) & (cards["date"] < end)].copy()


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
        column_config[column] = st.column_config.NumberColumn(format="%.3f")

    st.dataframe(
        display,
        column_config=column_config,
        width="stretch",
        hide_index=True,
    )


st.set_page_config(page_title="Pokemon Analyze", layout="wide")

st.title("Pokemon Analyze")

try:
    cards = read_cards()
except (FileNotFoundError, ValueError) as error:
    st.error(str(error))
    st.stop()

matches = read_matches()

today = pd.Timestamp.today().normalize()
default_start = today - pd.Timedelta(days=31)

source_options = ["All", "Online", "Majors"]

source_col, deck_col, bucket_col, start_col, end_col = st.columns([1, 2, 1, 1, 1])
with source_col:
    selected_source = st.selectbox("Source", source_options)

source_cards = cards.copy()
source_matches = matches.copy()
if selected_source == "Online":
    source_cards = cards[cards["source"] == "online"].copy()
    source_matches = matches[matches["source"] == "online"].copy()
elif selected_source == "Majors":
    source_cards = cards[cards["source"] == "major"].copy()
    source_matches = matches[matches["source"] == "major"].copy()

deck_counts = source_cards.groupby("deck")["list_id"].nunique().sort_values(ascending=False)
if deck_counts.empty:
    st.warning("No decks found for the selected source.")
    st.stop()

with deck_col:
    selected_deck = st.selectbox(
        "Deck",
        deck_counts.index.tolist(),
        format_func=lambda deck: f"{deck} ({int(deck_counts[deck])} lists)",
    )
with bucket_col:
    bucket = st.radio("Trend bucket", ["daily", "monthly"], index=1, horizontal=True)
with start_col:
    start_date = st.date_input("Start date", value=default_start.date())
with end_col:
    end_date = st.date_input("End date", value=today.date())

filtered_cards = _filter_cards_by_date(source_cards, start_date=start_date, end_date=end_date)
filtered_matches = _filter_cards_by_date(source_matches, start_date=start_date, end_date=end_date)
filtered_deck_counts = filtered_cards.groupby("deck")["list_id"].nunique().sort_values(ascending=False)
if selected_deck not in filtered_deck_counts:
    st.warning("This deck has no lists in the selected date window.")
    st.stop()

deck_cards = filtered_cards[filtered_cards["deck"] == selected_deck]
deck_list_count = int(filtered_deck_counts[selected_deck])

min_default = min(max(5, int(round(deck_list_count * 0.05))), max(deck_list_count, 1))
min_tech_decks = st.slider(
    "Minimum decks for tech/flex placement",
    min_value=1,
    max_value=max(deck_list_count, 1),
    value=min_default,
)
min_meta_matches = st.slider(
    "Minimum matches vs top 10 meta",
    min_value=1,
    max_value=500,
    value=30,
)

report = analyze_deck(
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
metric_one.metric("Deck Lists", int(filtered_deck_counts[selected_deck]))
metric_two.metric("Unique Cards", int(deck_cards["card"].nunique()))
metric_three.metric("Date Range", date_range or "Unknown")

if bucket == "monthly" and _unique_period_count(deck_cards, "M") < 2:
    st.info("Monthly trends need data from at least two months. Pull from the first of last month onward, or widen the date range.")
elif bucket == "daily" and _unique_period_count(deck_cards, "D") < 2:
    st.info("Daily trends need data from at least two different days. Widen the date range if the trend tables are empty.")

st.subheader("Best Decks Against Top 10 Meta Decks")
best_meta_decks = best_decks_against_meta(
    filtered_cards,
    filtered_matches,
    meta_n=10,
    min_matches=min_meta_matches,
)
if best_meta_decks.empty:
    st.info("No decks meet the current minimum matchup sample against the top 10 meta decks.")
else:
    _show_table(best_meta_decks, percent_columns=["win_rate", "tie_adjusted_win_rate"])

st.subheader("Matchups Against Top 20 Decks")
matchups = matchup_summary(selected_deck, filtered_cards, filtered_matches, top_n=20)
if matchups.empty:
    if selected_source == "Majors":
        st.info("Major-event matchup rows are not available yet. Switch to All or Online for online pairings.")
    else:
        st.info("No matchup rows yet. Run pull_all.bat again to fetch online match pairings.")
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
