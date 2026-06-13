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
python limitless_pull.py --format STANDARD --min-players 100 --days 31 --pages 5
python limitless_pull.py --format STANDARD --min-players 64 --since 2026-05-01 --pages 5
python limitless_pull.py --format STANDARD --min-players 64 --has-decklists --pages 5
python limitless_pull.py --format STANDARD --min-players 100 --days 31 --pages 5 --has-decklists --top-percent 50
```

Useful options:

- `--format STANDARD` limits the Limitless tournament search to Standard.
- `--min-players 100` skips smaller online events.
- `--days 31` pulls roughly the previous month of tournaments.
- `--since 2026-05-01` skips older events.
- `--has-decklists` keeps only standing rows that include a submitted decklist.
- `--top-percent 50` keeps only the top half of each online tournament's standings.
- `--pairings-delay 1.5` slows match-pairing requests to avoid rate limits.

`pull_all.bat` and the daily GitHub Action use `--top-percent 50` for online
events. Major events are not filtered by top 50%; the app keeps the published
Limitless major decklists, which are already a selective event cut. The
Limitless meta ranking is pulled with `--time 1months`, matching Limitless's
"Past month" tournament filter.

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
- an All, Online, or Majors source filter
- a top-5 best decks list against the top 25 split-variant Limitless meta decks
- matchup percentages with wins, losses, ties, win rate, and tie-adjusted win rate
- favorable and unfavorable matchup lines for each top performer
- daily or monthly trend buckets
- core, common, flex, and tech card groups
- trending up and trending down cards
- best average placement tech and flex cards, with a minimum deck count filter

The "Best Decks Against Top 25 Meta Decks" overview uses
`outputs/limitless_meta_decks.csv`, which comes from Limitless's metagame
ranking page with deck variants split and the "Past month" time filter.
Candidates and targets both come from that same top-25 meta list. A favorable
matchup is 55% or higher tie-adjusted win rate against a top meta deck, and a
very favorable matchup is 60% or higher. The overview sorts by favorable
matchups, then very favorable matchups, then aggregate tie-adjusted win rate.
The Deck Detail page keeps the card trends, individual matchup table, and
tech/flex placement analysis for one selected deck.

Percentages and numbers are formatted to at most 3 decimals for readability.

To rebuild just the top-25 meta matchup report after data is already pulled:

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
