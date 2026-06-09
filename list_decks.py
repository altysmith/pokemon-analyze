"""List deck names available in outputs/cards.csv."""

from reports.deck_analysis import available_decks


def main() -> None:
    for deck in available_decks():
        print(deck)


if __name__ == "__main__":
    main()
