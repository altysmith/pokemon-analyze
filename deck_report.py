"""Print a terminal report for one deck."""

from __future__ import annotations

import argparse

from reports.deck_analysis import analyze_deck, available_decks, format_report_table, read_cards


def main() -> None:
    parser = argparse.ArgumentParser(description="Show a report for one deck.")
    parser.add_argument("deck", nargs="?", help="Deck name. Omit to see available decks.")
    parser.add_argument("--bucket", choices=["daily", "monthly"], default="monthly")
    args = parser.parse_args()

    cards = read_cards()
    if not args.deck:
        print("Available decks:")
        for deck in available_decks(cards):
            print(f"- {deck}")
        return

    report = analyze_deck(args.deck, cards=cards, bucket=args.bucket)

    print(f"\n{report.deck} report ({report.bucket})")
    print("=" * (len(report.deck) + len(report.bucket) + 10))

    _print_table("Core / Common / Flex / Tech Cards", report.card_groups, ["adoption_rate"])
    _print_table("Trending Up", report.trending_up, ["previous_rate", "latest_rate", "trend"])
    _print_table("Trending Down", report.trending_down, ["previous_rate", "latest_rate", "trend"])
    _print_table("Best Average Placement Tech/Flex Cards", report.best_placement_cards, [])


def _print_table(title: str, table, percent_columns: list[str]) -> None:
    print(f"\n{title}")
    if table.empty:
        print("No data available.")
        return
    print(format_report_table(table, percent_columns=percent_columns).to_string(index=False))


if __name__ == "__main__":
    main()
