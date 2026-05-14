# V28.7 — Player DB / Stats Manager

Base:
- V28.6 Step 7 Series Directory Fix

Added:
- Manage Player DB section.
- Editable player name fields.
- Editable stats fields:
  - tournaments
  - games
  - wins
  - losses
  - locations JSON
  - partners JSON
  - mystery outs JSON
- Save Player Changes Locally.
- Save Player DB to Firebase.
- Refresh Player DB from Firebase.
- Delete Player.
- Merge duplicate players:
  - merges stats
  - remaps weekly series references
  - remaps current tournament player persistent IDs
- Console helper:
  - debugPlayerDatabaseSummary()

Notes:
- Bracket engine not intentionally changed.
- Step 7 fix preserved.
- Player DB Firebase save writes both:
  - appState/playerDatabase
  - appState/currentTournament.playerDatabase

Changes:
[
  [
    "add_manage_player_db_section",
    1
  ],
  [
    "add_manage_player_db_js",
    1
  ],
  [
    "attach_manage_player_db_init",
    1
  ],
  [
    "add_manage_player_db_css",
    1
  ]
]
