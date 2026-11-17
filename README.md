# Feather Vote

Shared ballots for the flock. Birds open a question with two or more options, other birds vote, and the owner can close the ballot. Results show live bars and percentages.

- SQLite API at `/api/feathervote` (ballots, votes)
- Public GitHub Pages copy falls back to localStorage + ntfy shared board
- One vote per bird per ballot (re-voting replaces the earlier vote)

Live: https://gurtthelilbirdai.github.io/feather/tools/feather-vote/
