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
pulls match pairings, combines decklists, extracts cards, and rebuilds the deck
summary.

Manual pipeline:

```powershell
python limitless_pull.py
python limitless_major_pull.py
python combine_players.py
python extract_cards.py
python analyze_players.py
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
Limitless major decklists, which are already a selective event cut.

These commands write CSV files under `outputs/`:

- `outputs/tournaments.csv`
- `outputs/online_players.csv`
- `outputs/major_tournaments.csv`
- `outputs/major_players.csv`
- `outputs/matches.csv`
- `outputs/online_matches.csv`
- `outputs/major_matches.csv`
- `outputs/players.csv`
- `outputs/cards.csv`
- `outputs/deck_summary.csv`

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

- a deck dropdown
- an All, Online, or Majors source filter
- matchup percentages against the top 20 overall decks
- daily or monthly trend buckets
- core, common, flex, and tech card groups
- trending up and trending down cards
- best average placement tech and flex cards, with a minimum deck count filter

The "Best Decks Against Top 10 Meta Decks" table only considers decks that have
at least one Major top-100 finish in the selected date window, then applies the
minimum-match filter shown in the dashboard.

Percentages and numbers are formatted to at most 3 decimals for readability.

## Daily Data Updates

The GitHub Actions workflow in `.github/workflows/update-data.yml` refreshes the
CSV files every day and can also be run manually from GitHub:

1. Open the GitHub repository.
2. Go to **Actions**.
3. Select **Update Pokemon Analyze Data**.
4. Click **Run workflow**.

The workflow pulls online events, major events, match pairings, rebuilds the CSV
files in `outputs/`, and commits changes back to the repository.
