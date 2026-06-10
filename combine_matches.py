"""Combine online and major match CSVs into outputs/matches.csv."""

from __future__ import annotations

from pathlib import Path

import pandas as pd


OUTPUTS_DIR = Path("outputs")
ONLINE_MATCHES_CSV = OUTPUTS_DIR / "online_matches.csv"
MAJOR_MATCHES_CSV = OUTPUTS_DIR / "major_matches.csv"
MATCHES_CSV = OUTPUTS_DIR / "matches.csv"


def main() -> None:
    frames: list[pd.DataFrame] = []
    for path in [ONLINE_MATCHES_CSV, MAJOR_MATCHES_CSV]:
        if path.exists():
            data = pd.read_csv(path)
            if not data.empty:
                frames.append(data)

    if not frames:
        raise FileNotFoundError("No online_matches.csv or major_matches.csv files found.")

    combined = pd.concat(frames, ignore_index=True, sort=False)
    combined.to_csv(MATCHES_CSV, index=False)
    print(f"Wrote {MATCHES_CSV} with {len(combined)} combined match rows.")


if __name__ == "__main__":
    main()
