"""Combine online and major-event player CSVs into outputs/players.csv."""

from __future__ import annotations

from pathlib import Path

import pandas as pd


OUTPUTS_DIR = Path("outputs")
ONLINE_PLAYERS_CSV = OUTPUTS_DIR / "online_players.csv"
MAJOR_PLAYERS_CSV = OUTPUTS_DIR / "major_players.csv"
PLAYERS_CSV = OUTPUTS_DIR / "players.csv"


def main() -> None:
    frames: list[pd.DataFrame] = []
    for path in [ONLINE_PLAYERS_CSV, MAJOR_PLAYERS_CSV]:
        if path.exists():
            data = pd.read_csv(path)
            if not data.empty:
                frames.append(data)

    if not frames:
        raise FileNotFoundError("No online_players.csv or major_players.csv files found.")

    combined = pd.concat(frames, ignore_index=True, sort=False)
    combined.to_csv(PLAYERS_CSV, index=False)
    print(f"Wrote {PLAYERS_CSV} with {len(combined)} combined player/decklist rows.")


if __name__ == "__main__":
    main()
