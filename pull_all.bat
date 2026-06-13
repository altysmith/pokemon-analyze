@echo off
setlocal
cd /d "%~dp0"

echo Pulling Play Limitless online events...
python limitless_pull.py --format STANDARD --min-players 50 --days 31 --pages 5 --has-decklists --delay 0.5 --pairings-delay 1.5
if errorlevel 1 goto failed

echo Pulling Limitless metagame ranking...
python pull_limitless_meta.py --format TEF-CRI --time 1months --limit 50
if errorlevel 1 goto failed

echo Pulling Limitless major events...
python limitless_major_pull.py --format standard --min-players 50 --days 31
if errorlevel 1 goto failed

echo Combining online and major rows...
python combine_players.py
if errorlevel 1 goto failed

echo Combining online and major matchups...
python combine_matches.py
if errorlevel 1 goto failed

echo Extracting cards...
python extract_cards.py
if errorlevel 1 goto failed

echo Building deck summary...
python analyze_players.py
if errorlevel 1 goto failed

echo Building top-25 meta matchup report...
python best_meta_report.py
if errorlevel 1 goto failed

echo.
echo Done. Start the dashboard with:
echo python -m streamlit run dashboard.py
goto end

:failed
echo.
echo Pull failed. Check the error above.

:end
pause
