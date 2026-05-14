# V28.1 — 7-Team PDF Loser Bracket + Connector Fix

Fixed connector lines:
- Route-table sources `routeWinner` and `routeLoser` now work with the source-based connector renderer.

Fixed 7-team loser bracket:
- Loser Round 1:
  - L6 = Loser W2 vs Loser W3

- Loser Round 2:
  - L7 = Loser W4 vs Winner L6
  - L9 = Loser W1 vs Loser W5

- Loser Round 3:
  - L10 = Winner L7 vs Winner L9

- Loser Round 4:
  - L11 = Winner L10 vs Loser W8

Winner side unchanged:
- W1 = Seed 3 vs Seed 6
- W2 = Seed 2 vs Seed 7
- W3 = Seed 4 vs Seed 5
- W4 = Winner W1 vs Winner W2
- W5 = Seed 1 vs Winner W3
- W8 = Winner W4 vs Winner W5
