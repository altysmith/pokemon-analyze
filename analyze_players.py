"""Create outputs/deck_summary.csv from outputs/cards.csv."""

from reports.deck_analysis import save_deck_summary


def main() -> None:
    summary = save_deck_summary()
    print(f"Wrote outputs/deck_summary.csv with {len(summary)} decks.")


if __name__ == "__main__":
    main()
