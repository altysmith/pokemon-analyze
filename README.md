# Pokemon Analyze

Small Python app for pulling Limitless tournament data, extracting deck cards,
and reporting on deck trends.

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Data Flow

One-click Windows pull:

```powershell
.\pull_all.bat
```

That pulls both Play Limitless online events and main Limitless major events,
pulls the Limitless metagame ranking, pulls match pairings, combines decklists,
extracts cards, and rebuilds the deck summary.

Manual pipeline:

```powershell
python limitless_pull.py
python pull_limitless_meta.py
python limitless_major_pull.py
python combine_players.py
python extract_cards.py
python analyze_players.py
python best_meta_report.py
```

By default, `limitless_pull.py` pulls one page of recent tournaments. Pull more
history with:

```powershell
python limitless_pull.py --pages 5
```

To pull every tournament page Limitless returns, use:

```powershell
python limitless_pull.py --all-pages
```

That can take a while because the script fetches standings for every tournament.

For cleaner, narrower data, filter the tournaments before standings are pulled:

```powershell
python limitless_pull.py --format STANDARD --min-players 50 --days 31 --pages 5
python limitless_pull.py --format STANDARD --min-players 64 --since 2026-05-01 --pages 5
python limitless_pull.py --format STANDARD --min-players 64 --has-decklists --pages 5
python limitless_pull.py --format STANDARD --min-players 50 --days 31 --pages 5 --has-decklists
```

Useful options:

- `--format STANDARD` limits the Limitless tournament search to Standard.
- `--min-players 50` matches the TrainerHill-style minimum player filter.
- `--days 31` pulls roughly the previous month of tournaments.
- `--since 2026-05-01` skips older events.
- `--has-decklists` keeps only standing rows that include a submitted decklist.
- `--pairings-delay 1.5` slows match-pairing requests to avoid rate limits.

`pull_all.bat` and the daily GitHub Action use `--min-players 50` for online
and major events. Major events still depend on the decklists published by
Limitless Labs, which may be a selective event cut. The Limitless meta ranking
is pulled with `--time 1months`, matching Limitless's "Past month" tournament
filter.

These commands write CSV files under `outputs/`:

- `outputs/tournaments.csv`
- `outputs/online_players.csv`
- `outputs/major_tournaments.csv`
- `outputs/limitless_meta_decks.csv`
- `outputs/major_players.csv`
- `outputs/matches.csv`
- `outputs/online_matches.csv`
- `outputs/major_matches.csv`
- `outputs/players.csv`
- `outputs/cards.csv`
- `outputs/deck_summary.csv`
- `outputs/best_decks_against_top25_meta.csv`

Existing CSV outputs are not removed by the app.

## Command Line Reports

List decks:

```powershell
python list_decks.py
```

Show one deck report:

```powershell
python deck_report.py "Charizard" --bucket daily
python deck_report.py "Charizard" --bucket monthly
```

## Streamlit Dashboard

Run the dashboard:

```powershell
streamlit run dashboard.py
```

The dashboard reads `outputs/cards.csv` and includes:

- a Meta Overview opening page
- a Deck Detail page with a deck dropdown
- a Testing Recommendations page for Top 25 matchup analysis
- an All, Online, or Majors source filter
- a Meta Overview table with complete W-L-T records against all known opponents
- representative decklists from the newest available Major, using best placement within that event
- copyable representative decklists formatted with section totals and card set/number identifiers when available
- side-by-side top-5 lists for most favorable matchups, highest overall win percentage, and highest non-Dragapult win percentage
- matchup percentages with wins, losses, ties, win rate, and tie-adjusted win rate
- favorable and unfavorable matchup lines at the top of each selected deck detail page
- a card-impact text search that compares lists with and without a card against the top 15 meta decks
- daily or monthly trend buckets
- core, common, flex, and tech card groups
- trending up and trending down cards
- best average placement tech and flex cards, with a minimum deck count filter

The Meta Overview shows the current top decks with their complete win, loss,
and tie records against every known opponent in the selected data. It does not
limit those records to games against other meta decks. The overview also keeps
the Top-25 matchup comparison tables. Recommendation scores, labels, exclusions,
and explanations live on Testing Recommendations, while one-deck matchup
analysis lives on Deck Detail.

Testing Recommendations uses
`outputs/limitless_meta_decks.csv`, which comes from Limitless's metagame
ranking page with deck variants split and the "Past month" time filter.
Candidates and targets come from the selected top meta list. A favorable
matchup is 55% or higher tie-adjusted win rate against a top meta deck, and a
very favorable matchup is over 60%. An unfavorable matchup is under 45%, and a
very unfavorable matchup is under 40%.
Recommendation scores use the full current Top 25 meta list and weight each
opponent by its meta share.
The Testing Recommendations Score Lab can rebalance confidence-adjusted matchup win rate,
Limitless Labs Day 2 conversion, and matchup coverage without changing code.
Its optional conversion benchmark is off by default, so every scored deck stays
visible unless a user chooses to filter the table. Run
`python limitless_labs_pull.py` after the major pull to refresh
`outputs/labs_conversion.csv`.
Matchup coverage is weighted by each opponent's meta share. Conversion below
the selected major-field average uses a squared penalty, while above-average
conversion remains linear.
Major matchup calculations use the archetypes attached to the full Limitless
Labs pairing data, with the published decklist map retained as a fallback.
The dashboard's collapsed "How scoring works" panel documents these calculations
next to the adjustable Score Lab controls, including explicit definitions for
every recommendation label.
Testing Recommendations has its own dashboard page so the Meta Overview remains
focused on factual metagame and matchup tables.
The automated major pull retains the latest ten events, independent of the
31-day online window, so the dashboard's Last 3/5/8/10 Major filters use the
number of events shown.
For meta matchup percentages, ties count as one-third of a win, matching the
TrainerHill formula.
The Deck Detail page keeps the card trends, individual matchup table, and
tech/flex placement analysis for one selected deck.

Percentages and numbers are formatted to at most 3 decimals for readability.

To rebuild just the meta matchup report after data is already pulled:

```powershell
python best_meta_report.py
```

## Daily Data Updates

The GitHub Actions workflow in `.github/workflows/update-data.yml` refreshes the
CSV files every day and can also be run manually from GitHub:

1. Open the GitHub repository.
2. Go to **Actions**.
3. Select **Update Pokemon Analyze Data**.
4. Click **Run workflow**.

The workflow pulls online events, major events, match pairings, rebuilds the CSV
files in `outputs/`, and commits changes back to the repository.
