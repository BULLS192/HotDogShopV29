# V28.5 Rebuilt Fresh — Step 7 Firebase Persistence Fix

Base:
- V28.4 10-team fix

Fix:
- Save Weekly Series now writes Step 7 changes directly to Firebase.
- Other participating players persist after refresh/load.
- Week record is normalized before saving.
- Firebase write uses merge:true.
- Added debugWeeklySeriesWeek(weekKey).

Build timestamp:
- 2026-04-29 18:03:54

Changes:
[
  [
    "add_quiet_series_firebase_save",
    1
  ],
  [
    "replace_saveSelectedSeriesWeekFromForm_direct_firebase",
    1
  ],
  [
    "replace_saveWeeklySeriesToFirebase_use_quiet",
    1
  ],
  [
    "add_debug_weekly_series_week",
    1
  ]
]
