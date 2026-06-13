"""Compatibility wrapper for older scripts.

New code should import from pokemon_analyze.deck_analysis. This module keeps the
original reports.deck_analysis import path working for existing CLI scripts.
"""

from pokemon_analyze.deck_analysis import *  # noqa: F401,F403
