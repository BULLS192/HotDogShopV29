# V28.6 — Step 7 Series Directory + Other Players Persistence Fix

Problem observed:
- Week 2 "Other Players" selections disappeared after refresh.
- Leaderboard showed fewer players than expected by Week 3.

Root cause:
- `collectWeekFormData()` filtered selected "Other Players" against the currently loaded tournament players.
- When editing historical weeks, the current tournament player list is not the same as that historical week.
- Therefore checked players could be silently removed before saving.
- Series dropdown/checklist also did not guarantee inclusion of IDs already saved in weekly series data.

Fix:
- Removed the current-tournament filter from `collectWeekFormData()`.
- Step 7 now saves every checked "Other Player" except players already placed Top 4 that week.
- `getSeriesSelectablePlayers()` now includes:
  - current tournament players
  - playerDatabase
  - seriesPlayerDirectory
  - all IDs already referenced inside weeklySeriesState weeks
- Added `debugWeeklySeriesSummary()` console helper.

Expected result:
- Week 2 other participants persist after Save Weekly Series -> Refresh -> Load Series from Firebase.
- Leaderboard should include every player referenced by Week 1-3 placements/others.
- If there are 27 unique participants across Week 1-3, debugWeeklySeriesSummary().uniqueIds should show 27.

Changes:
[
  [
    "remove_current_tournament_filter_from_others",
    1
  ],
  [
    "include_saved_week_ids_in_series_selectable_players",
    1
  ],
  [
    "add_debug_weekly_series_summary",
    1
  ]
]
