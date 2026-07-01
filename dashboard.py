"""Streamlit dashboard for Pokemon deck analysis."""

from __future__ import annotations

import base64
from datetime import date
from functools import lru_cache
import html
import inspect
from pathlib import Path
import re

import pandas as pd
import streamlit as st

import pokemon_analyze.deck_analysis as deck_analysis


DEFAULT_META_COUNT = 25
MAX_META_COUNT = 35
FULL_META_COUNT = 25
DETAIL_DEFAULT_META_COUNT = 25
META_OVERVIEW_MAX_RANK = 25
META_OVERVIEW_LIST_SIZE = 10
CARD_SUBTYPES_CSV = Path("outputs/card_subtypes.csv")
MAJOR_WINDOW_OPTIONS = {
    "Last 3 majors": 3,
    "Last 5 majors": 5,
    "Last 8 majors": 8,
    "Last 10 majors": 10,
    "All majors": None,
}
DECKLIST_SUBTYPE_ORDER = {
    "Pokemon": 0,
    "Supporter": 1,
    "Item": 2,
    "Tool": 3,
    "Stadium": 4,
    "Energy": 5,
    "Special Energy": 6,
}


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


def _latest_major_event_ids(cards: pd.DataFrame, event_count: int | None) -> list[str]:
    """Return tournament ids for the newest Major events in the current data."""

    needed = {"source", "tournament_id", "date"}
    if cards.empty or not needed.issubset(cards.columns):
        return []

    major_cards = cards[(cards["source"] == "major") & cards["tournament_id"].notna()].copy()
    if major_cards.empty:
        return []

    if event_count is None:
        return major_cards["tournament_id"].astype(str).drop_duplicates().tolist()

    event_columns = ["tournament_id", "date"]
    if "tournament_name" in major_cards.columns:
        event_columns.append("tournament_name")

    events = major_cards[event_columns].drop_duplicates("tournament_id").copy()
    events["tournament_id"] = events["tournament_id"].astype(str)
    events["date_sort"] = events["date"].fillna(pd.Timestamp.min)
    name_sort = "tournament_name" if "tournament_name" in events.columns else "tournament_id"
    events = events.sort_values(["date_sort", name_sort], ascending=[False, True]).head(event_count)
    return events["tournament_id"].tolist()


def _filter_recent_majors(
    cards: pd.DataFrame,
    matches: pd.DataFrame,
    event_count: int | None,
) -> tuple[pd.DataFrame, pd.DataFrame, int]:
    """Keep all rows from the newest Major events instead of cutting by date."""

    major_cards, major_matches = _filter_by_source(cards, matches, "Majors")
    event_ids = _latest_major_event_ids(cards, event_count)
    if not event_ids:
        return major_cards.iloc[0:0].copy(), major_matches.iloc[0:0].copy(), 0

    event_set = set(event_ids)
    filtered_cards = major_cards[major_cards["tournament_id"].astype(str).isin(event_set)].copy()
    filtered_matches = major_matches[major_matches["tournament_id"].astype(str).isin(event_set)].copy()
    return filtered_cards, filtered_matches, len(event_ids)


def _filter_meta_overview_data(
    cards: pd.DataFrame,
    matches: pd.DataFrame,
    source: str,
    online_start: date,
    online_end: date,
    major_event_count: int | None,
) -> tuple[pd.DataFrame, pd.DataFrame, str]:
    """Build the Meta Overview pool using date-filtered online data and event-filtered Major data."""

    online_cards, online_matches = _filter_by_source(cards, matches, "Online")
    online_cards = _filter_by_date(online_cards, online_start, online_end)
    online_matches = _filter_by_date(online_matches, online_start, online_end)

    major_cards, major_matches, major_events_used = _filter_recent_majors(cards, matches, major_event_count)

    if source == "Online":
        caption = f"Using online events from {online_start} to {online_end}."
        return online_cards, online_matches, caption
    major_caption = (
        "all Major events"
        if major_event_count is None
        else f"the latest {major_events_used} Major event(s)"
    )
    if source == "Majors":
        caption = f"Using {major_caption}, regardless of date."
        return major_cards, major_matches, caption

    combined_cards = pd.concat([online_cards, major_cards], ignore_index=True)
    combined_matches = pd.concat([online_matches, major_matches], ignore_index=True)
    caption = (
        f"Using online events from {online_start} to {online_end} "
        f"plus {major_caption}."
    )
    return combined_cards, combined_matches, caption


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


def _plural(count: int, word: str) -> str:
    """Return a simple count phrase with readable pluralization."""

    suffix = "" if count == 1 else "s"
    return f"{count} {word}{suffix}"


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
                "decklist_rows": _decklist_display_rows(list_cards, card_metadata),
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
    card_metadata = _card_metadata_lookup(cards)
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
        rows.append(_decklist_rows_from_lists(exact, best["list_id"].tolist(), card_metadata))

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


def _decklist_rows_from_lists(
    cards: pd.DataFrame,
    list_ids: list[str],
    metadata: dict[str, dict[str, str]] | None = None,
) -> pd.DataFrame:
    """Build render-ready representative decklist rows from selected list ids."""

    if cards.empty or not list_ids:
        return pd.DataFrame()

    card_metadata = metadata or _card_metadata_lookup(cards)
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
                "decklist_rows": _decklist_display_rows(list_cards, card_metadata),
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
        number = _clean_card_number(getattr(row, "number", ""))
        category = str(getattr(row, "category", ""))
        if not card_name or not set_code or not number:
            continue
        subtype_lookup = _card_subtype_lookup()
        subtype = subtype_lookup.get(
            (set_code, number),
            subtype_lookup.get((f"name:{card_name.lower()}", ""), ""),
        )
        metadata.setdefault(
            card_name,
            {
                "category": category,
                "set": set_code,
                "number": number,
                "subtype": subtype,
            },
        )
    return metadata


@lru_cache(maxsize=1)
def _card_subtype_lookup() -> dict[tuple[str, str], str]:
    """Read downloaded set/number subtype metadata."""

    if not CARD_SUBTYPES_CSV.exists():
        return {}

    subtypes = pd.read_csv(CARD_SUBTYPES_CSV, dtype=str).fillna("")
    needed = {"set", "number", "subtype"}
    if not needed.issubset(subtypes.columns):
        return {}
    lookup = {
        (str(row.set).strip(), _clean_card_number(row.number)): str(row.subtype).strip()
        for row in subtypes.itertuples(index=False)
        if str(row.set).strip() and str(row.number).strip()
    }
    if "card" in subtypes.columns:
        for row in subtypes.itertuples(index=False):
            card_name = str(getattr(row, "card", "")).strip().lower()
            subtype = str(getattr(row, "subtype", "")).strip()
            if card_name and subtype not in {"", "Trainer"}:
                lookup.setdefault((f"name:{card_name}", ""), subtype)
    return lookup


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
        for row in _sorted_decklist_cards(section_cards, metadata).itertuples(index=False):
            card_name = str(row.card)
            fallback = metadata.get(card_name, {})
            set_code = str(row.set or fallback.get("set", "")).strip()
            number = _clean_card_number(row.number or fallback.get("number", ""))
            suffix = f" {set_code} {number}".rstrip() if set_code or number else ""
            lines.append(f"{_clean_card_count(row.count)} {card_name}{suffix}")
        lines.append("")
    return "\n".join(lines).strip()


def _sorted_decklist_cards(
    cards: pd.DataFrame,
    metadata: dict[str, dict[str, str]],
) -> pd.DataFrame:
    """Sort cards by decklist subtype, count descending, then card name."""

    sorted_cards = cards.copy()
    sorted_cards["subtype"] = sorted_cards["card"].apply(
        lambda card: metadata.get(str(card), {}).get("subtype", "")
    )
    sorted_cards["subtype_sort"] = sorted_cards["subtype"].map(DECKLIST_SUBTYPE_ORDER).fillna(99)
    return sorted_cards.sort_values(
        ["subtype_sort", "count", "card"],
        ascending=[True, False, True],
    ).drop(columns=["subtype_sort"])


def _decklist_display_rows(cards: pd.DataFrame, metadata: dict[str, dict[str, str]]) -> list[dict[str, object]]:
    """Build grouped decklist rows for a readable in-app table."""

    sections = [
        ("pokemon", "Pokemon"),
        ("trainer", "Trainer"),
        ("energy", "Energy"),
    ]
    display_cards = cards.copy()
    for column in ["category", "set", "number"]:
        if column not in display_cards.columns:
            display_cards[column] = ""
        display_cards[column] = display_cards[column].fillna("").astype(str)

    rows: list[dict[str, object]] = []
    for category_key, heading in sections:
        section_cards = _cards_for_section(display_cards, category_key, metadata)
        for row in _sorted_decklist_cards(section_cards, metadata).itertuples(index=False):
            card_name = str(row.card)
            fallback = metadata.get(card_name, {})
            rows.append(
                {
                    "Section": heading,
                    "Type": str(getattr(row, "subtype", "") or heading),
                    "Count": _clean_card_count(row.count),
                    "Card": card_name,
                    "Set": str(row.set or fallback.get("set", "")).strip(),
                    "#": _clean_card_number(row.number or fallback.get("number", "")),
                }
            )
    return rows


def _decklist_svg(title: str, decklist_text: str) -> bytes:
    """Create a simple text SVG so a decklist can open/download like an image."""

    lines = [line for line in decklist_text.splitlines() if line.strip()]
    width = 900
    line_height = 26
    height = max(180, 96 + (len(lines) * line_height))
    escaped_title = html.escape(title)
    svg_lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        '<rect width="100%" height="100%" fill="#101216"/>',
        f'<text x="32" y="46" fill="#f5f5f5" font-family="Consolas, monospace" font-size="26" font-weight="700">{escaped_title}</text>',
    ]
    y = 88
    for line in lines:
        is_heading = line.endswith(":") or re.match(r"^[A-Za-z]+: \d+$", line)
        color = "#ff4b5c" if is_heading else "#f5f5f5"
        weight = "700" if is_heading else "400"
        svg_lines.append(
            f'<text x="32" y="{y}" fill="{color}" font-family="Consolas, monospace" '
            f'font-size="20" font-weight="{weight}">{html.escape(line)}</text>'
        )
        y += line_height
    svg_lines.append("</svg>")
    return "\n".join(svg_lines).encode("utf-8")


def _safe_file_stem(value: str) -> str:
    """Make a short, browser-friendly filename for downloads."""

    stem = re.sub(r"[^A-Za-z0-9]+", "-", value).strip("-").lower()
    return stem or "decklist"


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
    for index, row in enumerate(representatives.itertuples(index=False)):
        placement_number = pd.to_numeric(row.placement, errors="coerce")
        placement = "" if pd.isna(placement_number) else f" - {int(placement_number)}"
        label = f"{row.deck}: {row.player}{placement} at {row.tournament}"
        with st.expander(label):
            title = f"{row.deck} - {row.player}{placement} at {row.tournament}"
            source_col, image_col, text_col = st.columns(3)
            with source_col:
                if row.source_link:
                    st.link_button("Open source event", row.source_link)
            image_bytes = _decklist_svg(title, row.decklist)
            image_name = _safe_file_stem(title)
            widget_key = _safe_file_stem(f"{heading}-{index}-{title}")
            image_data_url = "data:image/svg+xml;base64," + base64.b64encode(image_bytes).decode("ascii")
            with image_col:
                st.markdown(
                    f'<a href="{image_data_url}" target="_blank">Open generated image</a>',
                    unsafe_allow_html=True,
                )
            with text_col:
                st.download_button(
                    "Download text list",
                    data=row.decklist,
                    file_name=f"{image_name}.txt",
                    mime="text/plain",
                    key=f"text_{widget_key}",
                )

            decklist_rows = getattr(row, "decklist_rows", [])
            if decklist_rows:
                st.dataframe(pd.DataFrame(decklist_rows), width="stretch", hide_index=True)
            st.download_button(
                "Download image",
                data=image_bytes,
                file_name=f"{image_name}.svg",
                mime="image/svg+xml",
                key=f"image_{widget_key}",
            )
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


def _meta_overview_target_decks(limitless_meta_decks: pd.DataFrame) -> pd.DataFrame:
    """Use the full current top-25 for overview recommendation tables."""

    if limitless_meta_decks.empty:
        return limitless_meta_decks.copy()

    meta_decks = limitless_meta_decks.copy()
    meta_decks["rank_sort"] = pd.to_numeric(meta_decks.get("rank"), errors="coerce")
    meta_decks = meta_decks[meta_decks["rank_sort"] <= META_OVERVIEW_MAX_RANK].copy()
    return meta_decks.sort_values("rank_sort").drop(columns=["rank_sort"])


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


def _show_full_meta_performance(
    cards: pd.DataFrame,
    matches: pd.DataFrame,
    limitless_meta_decks: pd.DataFrame,
) -> None:
    """Show the current top-25 meta list with matchup performance columns."""

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

    st.subheader(f"Full Top-{FULL_META_COUNT} Meta Performance Table")
    full_meta_decks = limitless_meta_decks.head(FULL_META_COUNT).copy()
    full_resolved_meta = deck_analysis.resolve_meta_decks(cards, full_meta_decks, limit=FULL_META_COUNT)
    if full_resolved_meta.empty:
        st.info("No Limitless top-25 meta decks could be matched to the current source/date filters.")
        return

    full_best = deck_analysis.best_decks_against_meta(
        cards,
        matches,
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


def _testing_recommendation_note(
    label: str,
    trusted_rate: float,
    adjusted_conversion: float,
    day1: int,
    day2: int,
    favorable: int,
    very_favorable: int,
    unfavorable: int,
    very_unfavorable: int,
    matches: int,
    best_matchups: pd.DataFrame,
    risky_matchups: pd.DataFrame,
) -> str:
    """Write one readable sentence explaining why a deck was recommended."""

    opening = (
        f"{label}: {_format_percent(trusted_rate)} trusted win rate, "
        f"{_format_percent(adjusted_conversion)} adjusted Day 2 conversion "
        f"({day2} of {day1}), and {_plural(favorable, 'favorable matchup')}"
    )

    if very_favorable:
        opening += f", including {_plural(very_favorable, 'very favorable matchup')}"

    if not best_matchups.empty:
        best = best_matchups.iloc[0]
        opening += f", led by {best['limitless_deck']}"

    if very_unfavorable:
        risk = f"{_plural(very_unfavorable, 'very unfavorable matchup')}"
    elif unfavorable:
        risk = f"{_plural(unfavorable, 'unfavorable matchup')}"
    elif not risky_matchups.empty:
        risk = f"{risky_matchups.iloc[0]['limitless_deck']}"
    else:
        risk = "no major bad matchup in this pool"

    sample = " Low sample." if matches < 100 else ""
    return f"{opening}. Risk: {risk}.{sample}"


def _conversion_profiles(
    conversion: pd.DataFrame,
    cards: pd.DataFrame,
    local_decks: list[str],
    prior_entries: int = 50,
) -> tuple[dict[str, dict[str, float]], float]:
    """Aggregate Labs conversion data and match its archetypes to local names."""

    if conversion.empty:
        return {}, 0

    event_ids = set(
        cards.loc[cards.get("source", pd.Series(index=cards.index, dtype=str)).eq("major"), "tournament_id"]
        .dropna()
        .astype(str)
    )
    selected = conversion[conversion["tournament_id"].astype(str).isin(event_ids)].copy()
    if selected.empty:
        return {}, 0

    total_day1 = float(selected["day1"].sum())
    baseline = float(selected["day2"].sum() / total_day1) if total_day1 else 0
    aggregate = selected.groupby("deck", as_index=False).agg(day1=("day1", "sum"), day2=("day2", "sum"))
    labs_decks = aggregate["deck"].dropna().astype(str).tolist()
    aggregate_lookup = aggregate.set_index("deck").to_dict("index")
    aliases = {
        "Hydrapple": "Ogerpon Meganium Hydrapple",
        "Ogerpon Box": "Basic Box",
    }

    profiles: dict[str, dict[str, float]] = {}
    for local_deck in local_decks:
        labs_deck = aliases.get(local_deck, "")
        if not labs_deck:
            local_tokens = deck_analysis._deck_match_tokens(local_deck)
            token_matches = [
                candidate
                for candidate in labs_decks
                if deck_analysis._deck_match_tokens(candidate) == local_tokens
            ]
            labs_deck = token_matches[0] if token_matches else ""
        values = aggregate_lookup.get(labs_deck)
        if not values:
            continue

        day1 = int(values["day1"])
        day2 = int(values["day2"])
        adjusted_rate = (
            (day2 + (baseline * prior_entries)) / (day1 + prior_entries)
            if day1 + prior_entries
            else baseline
        )
        if baseline:
            conversion_ratio = adjusted_rate / baseline
            # Below-average conversion receives a steeper penalty. Above the
            # field average remains linear and reaches 100 at twice the norm.
            conversion_score = (
                50 * (conversion_ratio**2)
                if conversion_ratio < 1
                else min(100, 50 * conversion_ratio)
            )
        else:
            conversion_score = 50
        profiles[local_deck] = {
            "day1": day1,
            "day2": day2,
            "raw_conversion_rate": day2 / day1 if day1 else 0,
            "adjusted_conversion_rate": adjusted_rate,
            "conversion_score": conversion_score,
        }
    return profiles, baseline


def _major_recommendation_profiles(cards: pd.DataFrame) -> pd.DataFrame:
    """Summarize major finishes and identify recent breakout results."""

    columns = ["deck", "major_finish_score", "best_major_finish", "recent_breakout"]
    needed = {"source", "deck", "placement", "tournament_id", "date", "list_id"}
    if cards.empty or not needed.issubset(cards.columns):
        return pd.DataFrame(columns=columns)

    major_lists = cards[cards["source"].eq("major")].drop_duplicates("list_id").copy()
    major_lists["placement"] = pd.to_numeric(major_lists["placement"], errors="coerce")
    major_lists = major_lists[major_lists["placement"].notna()].copy()
    if major_lists.empty:
        return pd.DataFrame(columns=columns)

    events = (
        major_lists[["tournament_id", "date"]]
        .drop_duplicates("tournament_id")
        .sort_values("date", ascending=False)
        .reset_index(drop=True)
    )
    events["recency_weight"] = [max(0.6, 1 - (index * 0.1)) for index in range(len(events))]
    recent_events = set(events.head(2)["tournament_id"])
    major_lists = major_lists.merge(events[["tournament_id", "recency_weight"]], on="tournament_id", how="left")

    def finish_points(placement: float) -> int:
        if placement <= 1:
            return 100
        if placement <= 2:
            return 90
        if placement <= 4:
            return 80
        if placement <= 8:
            return 70
        if placement <= 16:
            return 55
        if placement <= 32:
            return 40
        if placement <= 64:
            return 25
        if placement <= 100:
            return 10
        return 0

    major_lists["finish_points"] = major_lists["placement"].map(finish_points)
    major_lists["weighted_finish_points"] = major_lists["finish_points"] * major_lists["recency_weight"]
    event_finishes = (
        major_lists.groupby(["deck", "tournament_id"], as_index=False)
        .agg(
            weighted_finish_points=("weighted_finish_points", "max"),
            best_finish=("placement", "min"),
        )
    )

    rows: list[dict[str, object]] = []
    for deck, deck_events in event_finishes.groupby("deck"):
        top_scores = deck_events["weighted_finish_points"].nlargest(3).tolist()
        diminishing_weights = [1, 0.5, 0.25]
        major_score = sum(
            score * weight for score, weight in zip(top_scores, diminishing_weights)
        ) / 1.75
        recent_top_finish = (
            deck_events["tournament_id"].isin(recent_events)
            & (deck_events["best_finish"] <= 32)
        ).any()
        prior_top_finish = (
            ~deck_events["tournament_id"].isin(recent_events)
            & (deck_events["best_finish"] <= 32)
        ).any()
        rows.append(
            {
                "deck": deck,
                "major_finish_score": major_score,
                "best_major_finish": int(deck_events["best_finish"].min()),
                "recent_breakout": bool(recent_top_finish and not prior_top_finish),
            }
        )
    return pd.DataFrame(rows, columns=columns)


def _recommendation_label(
    trusted_rate: float,
    adjusted_conversion: float,
    conversion_baseline: float,
    day1: int,
    best_major_finish: int,
    recent_breakout: bool,
) -> str:
    """Describe the evidence without forcing a deck into an avoid category."""

    if best_major_finish <= 32 and conversion_baseline and adjusted_conversion < conversion_baseline * 0.85:
        return "Spike result"
    if recent_breakout:
        return "Breakout watch"
    if trusted_rate >= 0.50 and adjusted_conversion >= conversion_baseline:
        return "Accessible pick"
    if conversion_baseline and adjusted_conversion >= conversion_baseline * 1.10:
        return "Strong converter"
    if best_major_finish <= 32 and trusted_rate < 0.50:
        return "Expert pick"
    if day1 < 30:
        return "Limited evidence"
    if conversion_baseline and adjusted_conversion < conversion_baseline * 0.80:
        return "Conversion concern"
    return "Day 2 contender"


def _build_testing_recommendations(
    cards: pd.DataFrame,
    matches: pd.DataFrame,
    resolved_meta: pd.DataFrame,
    meta_decks: pd.DataFrame,
    best: pd.DataFrame,
    excluded_decks: list[str],
    conversion: pd.DataFrame | None = None,
    win_weight: int = 70,
    conversion_weight: int = 20,
    coverage_weight: int = 10,
) -> pd.DataFrame:
    """Score decks worth testing, weighting matchups by opponent meta share."""

    columns = [
        "deck",
        "label",
        "score",
        "weighted_adjusted_win_rate",
        "trusted_win_rate",
        "adjusted_conversion_rate",
        "raw_conversion_rate",
        "day1",
        "day2",
        "coverage_score",
        "matches",
        "favorable_matchups",
        "very_favorable_matchups",
        "unfavorable_matchups",
        "very_unfavorable_matchups",
        "note",
    ]
    if cards.empty or matches.empty or resolved_meta.empty or best.empty:
        return pd.DataFrame(columns=columns)

    deck_map = deck_analysis._deck_map_from_cards(cards)
    match_rows = deck_analysis._matches_with_decks(matches, deck_map)
    if match_rows.empty:
        return pd.DataFrame(columns=columns)

    meta_targets = resolved_meta[["limitless_deck", "local_deck"]].dropna().drop_duplicates().copy()
    share_map = (
        meta_decks.rename(columns={"deck": "limitless_deck"})
        .assign(meta_share=lambda frame: pd.to_numeric(frame["share"], errors="coerce").fillna(0))
        [["limitless_deck", "meta_share"]]
    )
    meta_targets = meta_targets.merge(share_map, on="limitless_deck", how="left")
    meta_targets["meta_share"] = meta_targets["meta_share"].fillna(0)

    selected = match_rows[
        (match_rows["deck"].isin(meta_targets["local_deck"]))
        & (match_rows["opponent_deck"].isin(meta_targets["local_deck"]))
        & (match_rows["deck"] != match_rows["opponent_deck"])
    ].copy()
    if selected.empty:
        return pd.DataFrame(columns=columns)

    selected = selected.merge(
        meta_targets.rename(columns={"local_deck": "opponent_deck"}),
        on="opponent_deck",
        how="inner",
    )
    per_opponent = (
        selected.groupby(["deck", "limitless_deck", "meta_share"], as_index=False)
        .agg(
            opponent_matches=("result", "size"),
            opponent_wins=("result", lambda values: (values == "win").sum()),
            opponent_losses=("result", lambda values: (values == "loss").sum()),
            opponent_ties=("result", lambda values: (values == "tie").sum()),
        )
    )
    per_opponent["opponent_adjusted_win_rate"] = (
        per_opponent["opponent_wins"] + (deck_analysis.TIE_WIN_VALUE * per_opponent["opponent_ties"])
    ) / per_opponent["opponent_matches"].replace(0, pd.NA)

    rows: list[dict[str, object]] = []
    excluded = set(excluded_decks)
    best_lookup = best.set_index("deck").to_dict("index")
    major_profiles = _major_recommendation_profiles(cards)
    major_lookup = major_profiles.set_index("deck").to_dict("index") if not major_profiles.empty else {}
    conversion_lookup, conversion_baseline = _conversion_profiles(
        conversion if conversion is not None else pd.DataFrame(),
        cards,
        sorted(per_opponent["deck"].dropna().astype(str).unique()),
    )
    weight_total = max(win_weight + conversion_weight + coverage_weight, 1)
    for deck, deck_rows in per_opponent.groupby("deck"):
        if deck in excluded or deck not in best_lookup:
            continue

        share_total = deck_rows["meta_share"].sum()
        weighted_rate = (
            (deck_rows["opponent_adjusted_win_rate"] * deck_rows["meta_share"]).sum() / share_total
            if share_total
            else deck_rows["opponent_adjusted_win_rate"].mean()
        )
        best_row = best_lookup[deck]
        matches = int(best_row.get("matches", 0))
        favorable = int(best_row.get("favorable_matchups", 0))
        very_favorable = int(best_row.get("very_favorable_matchups", 0))
        unfavorable = int(best_row.get("unfavorable_matchups", 0))
        very_unfavorable = int(best_row.get("very_unfavorable_matchups", 0))
        best_matchups = deck_rows[deck_rows["opponent_adjusted_win_rate"] >= 0.55].sort_values(
            ["meta_share", "opponent_adjusted_win_rate", "opponent_matches"],
            ascending=[False, False, False],
        )
        risky_matchups = deck_rows[deck_rows["opponent_adjusted_win_rate"] < 0.45].sort_values(
            ["meta_share", "opponent_adjusted_win_rate", "opponent_matches"],
            ascending=[False, True, False],
        )
        major_profile = major_lookup.get(deck, {})
        best_major_finish = int(major_profile.get("best_major_finish", 9999))
        recent_breakout = bool(major_profile.get("recent_breakout", False))
        conversion_profile = conversion_lookup.get(deck, {})
        day1 = int(conversion_profile.get("day1", 0))
        day2 = int(conversion_profile.get("day2", 0))
        raw_conversion = float(conversion_profile.get("raw_conversion_rate", 0))
        adjusted_conversion = float(conversion_profile.get("adjusted_conversion_rate", conversion_baseline))
        conversion_score = float(conversion_profile.get("conversion_score", 50))
        def coverage_value(rate: float) -> int:
            if rate > 0.60:
                return 2
            if rate >= 0.55:
                return 1
            if rate < 0.40:
                return -2
            if rate < 0.45:
                return -1
            return 0

        deck_rows = deck_rows.copy()
        deck_rows["coverage_value"] = deck_rows["opponent_adjusted_win_rate"].map(coverage_value)
        coverage_share = deck_rows["meta_share"].sum()
        weighted_coverage = (
            (deck_rows["coverage_value"] * deck_rows["meta_share"]).sum() / coverage_share
            if coverage_share
            else 0
        )
        coverage_score = max(0, min(100, ((weighted_coverage + 2) / 4) * 100))
        trusted_rate = ((weighted_rate * matches) + (0.50 * 50)) / (matches + 50)
        score = (
            ((trusted_rate * 100) * win_weight)
            + (conversion_score * conversion_weight)
            + (coverage_score * coverage_weight)
        ) / weight_total
        label = _recommendation_label(
            trusted_rate,
            adjusted_conversion,
            conversion_baseline,
            day1,
            best_major_finish,
            recent_breakout,
        )
        note = _testing_recommendation_note(
            label,
            trusted_rate,
            adjusted_conversion,
            day1,
            day2,
            favorable,
            very_favorable,
            unfavorable,
            very_unfavorable,
            matches,
            best_matchups,
            risky_matchups,
        )
        rows.append(
            {
                "deck": deck,
                "label": label,
                "score": score,
                "weighted_adjusted_win_rate": weighted_rate,
                "trusted_win_rate": trusted_rate,
                "adjusted_conversion_rate": adjusted_conversion,
                "raw_conversion_rate": raw_conversion,
                "day1": day1,
                "day2": day2,
                "coverage_score": coverage_score,
                "matches": matches,
                "favorable_matchups": favorable,
                "very_favorable_matchups": very_favorable,
                "unfavorable_matchups": unfavorable,
                "very_unfavorable_matchups": very_unfavorable,
                "note": note,
            }
        )

    if not rows:
        return pd.DataFrame(columns=columns)
    return pd.DataFrame(rows).sort_values(["score", "matches"], ascending=[False, False])[columns]


def _build_lowest_evidence(recommendations: pd.DataFrame) -> pd.DataFrame:
    """Return the three lowest scores without declaring viable decks unplayable."""

    columns = [
        "deck",
        "score",
        "trusted_win_rate",
        "adjusted_conversion_rate",
        "label",
        "why",
    ]
    if recommendations.empty:
        return pd.DataFrame(columns=columns)

    lowest = recommendations.sort_values(["score", "matches"], ascending=[True, False]).head(3).copy()
    lowest["why"] = lowest.apply(
        lambda row: (
            f"Current evidence: {_format_percent(row['trusted_win_rate'])} trusted win rate and "
            f"{_format_percent(row['adjusted_conversion_rate'])} adjusted Day 2 conversion."
        ),
        axis=1,
    )
    return lowest[columns]


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
    labs_conversion: pd.DataFrame,
) -> None:
    """Opening page: top meta list and best performers into that meta."""

    st.header("Meta Overview")

    today = pd.Timestamp.today().normalize()
    default_start = today - pd.Timedelta(days=31)
    source_col, start_col, end_col, major_col = st.columns([1, 1, 1, 1])
    with source_col:
        selected_source = st.selectbox("Source", ["Both", "Online", "Majors"])
    with start_col:
        start_date = st.date_input("Online start", value=default_start.date(), key="overview_start")
    with end_col:
        end_date = st.date_input("Online end", value=today.date(), key="overview_end")
    with major_col:
        major_window_label = st.selectbox(
            "Major window",
            list(MAJOR_WINDOW_OPTIONS.keys()),
            index=1,
        )

    filtered_cards, filtered_matches, filter_caption = _filter_meta_overview_data(
        cards,
        matches,
        selected_source,
        start_date,
        end_date,
        MAJOR_WINDOW_OPTIONS[major_window_label],
    )
    st.caption(filter_caption)

    _show_full_meta_performance(filtered_cards, filtered_matches, limitless_meta_decks)

    meta_decks = _meta_overview_target_decks(limitless_meta_decks)
    meta_count = len(meta_decks)
    resolved_meta = deck_analysis.resolve_meta_decks(filtered_cards, meta_decks, limit=meta_count)

    st.subheader(f"Best Decks Against Top {META_OVERVIEW_MAX_RANK} Meta Decks")
    if resolved_meta.empty:
        st.info("No Top 25 Limitless meta decks could be matched to the current card data.")
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
        f"Candidates and targets both come from the current Limitless split-variant meta list, "
        f"limited to the top {META_OVERVIEW_MAX_RANK}. Matchup scores still weight each opponent "
        "by its meta share."
    )

    most_favorable = best.head(META_OVERVIEW_LIST_SIZE).copy()
    highest_win_rate = best.sort_values(
        ["tie_adjusted_win_rate", "matches"],
        ascending=[False, False],
    ).head(META_OVERVIEW_LIST_SIZE)
    highest_non_dragapult = (
        best[~best["deck"].astype(str).str.contains("Dragapult", case=False, na=False)]
        .sort_values(["tie_adjusted_win_rate", "matches"], ascending=[False, False])
        .head(META_OVERVIEW_LIST_SIZE)
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
    win_col, non_dragapult_col = st.columns(2)
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
    st.markdown("#### Most Favorable Matchups")
    _show_table(
        most_favorable[matchup_columns],
        percent_columns=["win_rate", "tie_adjusted_win_rate"],
        column_labels=compact_labels,
    )

    st.subheader("Decks Worth Testing")
    st.caption(
        "Scores combine confidence-adjusted matchup win rate, sample-adjusted Day 2 conversion, "
        "and meta-share-weighted matchup coverage. Below-average conversion receives a steeper "
        "penalty. Major matchup rates use the full Limitless Labs pairing field. Major finishes "
        "affect evidence labels, not the score."
    )
    with st.container(border=True):
        st.markdown("#### Score Lab")
        weight_columns = st.columns(3)
        with weight_columns[0]:
            win_weight = st.slider("Win rate weight", 0, 100, 70, 5)
        with weight_columns[1]:
            conversion_weight = st.slider("Day 2 conversion weight", 0, 100, 20, 5)
        with weight_columns[2]:
            coverage_weight = st.slider("Matchup coverage weight", 0, 100, 10, 5)
        weight_total = win_weight + conversion_weight + coverage_weight
        if weight_total:
            st.caption(
                "Normalized weights: "
                f"win rate {win_weight / weight_total:.0%}, "
                f"conversion {conversion_weight / weight_total:.0%}, "
                f"coverage {coverage_weight / weight_total:.0%}."
            )
        else:
            st.warning("Set at least one score weight above zero.")
        with st.expander("How scoring works"):
            st.markdown(
                """
**Trusted win rate:** Matchup win rates are weighted by each opponent's meta share. Ties count as
one-third of a win, and 50 prior matches at 50% pull small samples toward an even record.

**Day 2 conversion:** Limitless Labs Day 1 and Day 2 counts are combined across the selected majors.
Fifty prior entrants at the overall field conversion rate stabilize small archetypes. Below-average
conversion receives a squared penalty; above-average conversion remains linear.

**Matchup coverage:** Very favorable, favorable, even, unfavorable, and very unfavorable matchups
receive values of +2, +1, 0, -1, and -2. Each value is weighted by that opponent's meta share.

Major matchup rates use the full Labs pairing field. Exceptional finishes affect evidence labels
such as **Expert pick**, **Breakout watch**, and **Spike result**, but do not directly add score.

**Label meanings**

- **Accessible pick:** At least a 50% trusted win rate and conversion at or above the major-field average.
- **Strong converter:** Day 2 conversion is at least 10% better than the field average, even if its matchup win rate is lower.
- **Day 2 contender:** Conversion is reasonably close to the field average without another stronger label applying.
- **Expert pick:** A Top 32 major finish exists despite a trusted win rate below 50%, suggesting stronger results from top pilots.
- **Breakout watch:** A recent Top 32 finish appeared without an older Top 32 in the selected major window.
- **Spike result:** A Top 32 finish exists, but adjusted conversion is at least 15% below the field average.
- **Conversion concern:** Adjusted conversion is more than 20% below the field average.
- **Limited evidence:** Fewer than 30 Day 1 entries are available across the selected majors.

Labels describe the evidence pattern. They do not automatically include, exclude, or change the score of a deck.
                """
            )
    recommendation_decks = sorted(best["deck"].dropna().astype(str).unique().tolist())
    exclude_dragapult = st.checkbox(
        "Exclude all Dragapult variants",
        key="testing_recommendation_exclude_dragapult",
    )
    excluded_decks = st.multiselect(
        "Exclude decks",
        recommendation_decks,
        key="testing_recommendation_exclusions",
    )
    if exclude_dragapult:
        excluded_decks = sorted(
            set(excluded_decks)
            | {deck for deck in recommendation_decks if "dragapult" in deck.lower()}
        )
    all_recommendations = _build_testing_recommendations(
        filtered_cards,
        filtered_matches,
        resolved_meta,
        meta_decks,
        best,
        [],
        conversion=labs_conversion,
        win_weight=win_weight,
        conversion_weight=conversion_weight,
        coverage_weight=coverage_weight,
    )
    _, conversion_baseline = _conversion_profiles(
        labs_conversion,
        filtered_cards,
        recommendation_decks,
    )
    use_conversion_benchmark = st.checkbox(
        "Show only decks meeting a Day 2 conversion benchmark",
        value=False,
    )
    benchmark_percent = st.slider(
        "Conversion benchmark relative to field",
        0,
        150,
        80,
        5,
        disabled=not use_conversion_benchmark,
    )
    recommendations = all_recommendations[
        ~all_recommendations["deck"].isin(excluded_decks)
    ].copy()
    if use_conversion_benchmark and conversion_baseline:
        recommendations = recommendations[
            recommendations["adjusted_conversion_rate"]
            >= conversion_baseline * (benchmark_percent / 100)
        ].copy()
    if conversion_baseline:
        st.caption(
            f"Selected major field Day 2 baseline: {_format_percent(conversion_baseline)}. "
            "The conversion benchmark is optional and does not change deck scores."
        )
    elif selected_source != "Online":
        st.info("No Limitless Labs conversion rows are available for the selected majors yet.")
    if recommendations.empty:
        st.info("No deck recommendations are available after the current filters and exclusions.")
    else:
        recommendation_labels = {
            "deck": "Deck",
            "label": "Label",
            "score": "Score",
            "trusted_win_rate": "Win",
            "adjusted_conversion_rate": "Conv",
        }
        recommendation_columns = [
            "deck",
            "score",
            "trusted_win_rate",
            "adjusted_conversion_rate",
        ]
        full_recommendation_columns = ["deck", "label", *recommendation_columns[1:]]
        visible_recommendations = recommendations.head(5)
        _show_table(
            visible_recommendations[recommendation_columns],
            percent_columns=["trusted_win_rate", "adjusted_conversion_rate"],
            column_labels=recommendation_labels,
        )
        for row in visible_recommendations.itertuples():
            st.write(f"**{row.deck}:** {row.note}")
        with st.expander("Show full recommendation score list"):
            _show_table(
                recommendations[full_recommendation_columns],
                percent_columns=["trusted_win_rate", "adjusted_conversion_rate"],
                column_labels=recommendation_labels,
            )

    st.subheader("Lowest Current Evidence")
    lowest_evidence = _build_lowest_evidence(all_recommendations)
    if lowest_evidence.empty:
        st.info("No recommendation evidence is available.")
    else:
        evidence_labels = {
            "deck": "Deck",
            "score": "Score",
            "trusted_win_rate": "Win",
            "adjusted_conversion_rate": "Conv",
            "label": "Label",
        }
        evidence_columns = [
            "deck",
            "label",
            "score",
            "trusted_win_rate",
            "adjusted_conversion_rate",
        ]
        _show_table(
            lowest_evidence[evidence_columns],
            percent_columns=["trusted_win_rate", "adjusted_conversion_rate"],
            column_labels=evidence_labels,
        )
        for row in lowest_evidence.itertuples():
            st.write(f"**{row.deck}:** {row.why}")


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
            overview_columns = ["rank", "opponent", "matches", "win_rate", "loss_rate", "wins", "losses", "ties"]
            overview_labels = {
                "rank": "Rank",
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
            matchup_columns = ["rank", "opponent", "matches", "win_rate", "loss_rate", "tie_rate", "wins", "losses", "ties", "result"]
            matchup_labels = {
                "rank": "Rank",
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
                _decklist_rows_from_lists(recent_major_cards, recent_list_ids, _card_metadata_lookup(cards)),
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
labs_conversion = deck_analysis.read_labs_conversion()

page = st.sidebar.radio("Page", ["Meta Overview", "Deck Detail"])
if page == "Meta Overview":
    _meta_overview(cards, matches, limitless_meta_decks, labs_conversion)
else:
    meta_count = st.sidebar.slider(
        "Meta deck count",
        min_value=1,
        max_value=MAX_META_COUNT,
        value=DEFAULT_META_COUNT,
        step=1,
    )
    _deck_detail(cards, matches, limitless_meta_decks, meta_count)
