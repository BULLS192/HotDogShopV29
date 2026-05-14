Camarillo Darts - Clean Production Build

This build includes:
- King Seat / finals logic fix
- Hot Dog Shop location
- Step 7 Hot Dog Shop Weekly Series
- Full PDF/Excel exports
- Step 1 player stat edit/clear controls
- Firebase auto-connect via firebase-config.js

Recommended deployment:
1. Upload all files to a GitHub repository.
2. Enable GitHub Pages on the main branch / root folder.
3. In Firebase Console, add your GitHub Pages domain under Authentication -> Settings -> Authorized domains if you later enable Auth.
4. In Firestore Rules, publish the included starter rules, then tighten them later if needed.

For now, the app should auto-connect to your Firebase project on load.


Step 6 payout logic:
- Player Pot = players × buy-in
- Bar matches player pot adds another full Player Pot when selected
- Mystery Out Base = players × Mystery Out per player
- Bar matches Mystery Out adds another full Mystery Out Base when selected
- Tournament Prize Pool = Total Pot − Honey Pot − Total Mystery Out Pot


V11 Clean Rebuild Notes
- Includes hotfix-v11.js already wired into index.html
- Load Weekly Series from Firebase falls back to tournamentByWeek
- Save Tournament to Firebase also saves Weekly Series
- Finalize Tournament uses corrected current function names


V12 True Rebuild Notes
- Weekly-series Firebase recovery is integrated directly into app.js
- Load Weekly Series from Firebase falls back to tournamentByWeek
- Save Tournament to Firebase also saves Weekly Series
- Finalize Tournament uses corrected function names
- Patches applied: save=1, load=1, finalize=1


V14 Team Points Notes
- Team placings keep player arrays in weekly series data.
- Each player in a placing receives the full placing points.
- Season leaderboard returns the original row structure expected by the UI.
- Patches applied: normalize=1, leaderboard=1


V15 Persistent Player Identity Rebuild Notes
- Weekly series now uses persistent player IDs for cumulative tracking.
- Existing legacy tournament player IDs are resolved via tournamentByWeek history.
- Loading weekly series canonicalizes old IDs to persistent IDs.
- Team placings award full points to each player in the placing.
- Save Tournament to Firebase also saves Weekly Series.


V18 Clean Minimal Fix Notes
- insert_getSeriesSelectablePlayers: patched
- replace_populateSeriesPlayerSelectors: patched
- replace_setSeriesPlacementValues: patched
- replace_loadSelectedSeriesWeekIntoForm: patched
- replace_loadWeeklySeriesFromFirebase: patched
- Base version: V15 persistent identity rebuild
- Goal: keep leaderboard working while restoring Step 7 saved week form hydration


V19 Top 4 Placement Remap Notes
- insert_remapSeriesPlayerIds: patched
- replace_setSeriesPlacementValues: patched
- replace_loadSelectedSeriesWeekIntoForm: patched
- replace_loadWeeklySeriesFromFirebase: patched
- Base version: V18 clean minimal fix
- Goal: remap legacy placement IDs to persistent/current IDs so Top 4 dropdowns preselect correctly


V20 Force-Select Saved Top 4 Notes
- insert_ensureSeriesSelectHasOption: patched
- replace_setSeriesPlacementValues: patched
- replace_loadSelectedSeriesWeekIntoForm: patched
- Base version: V19 top-4 remap
- Goal: if a saved Top 4 player is missing from the dropdown options, inject it and preselect it anyway


V21 Real Step 7 ID Fix Notes
- Fixed Step 7 Top 4 select IDs to match index.html.
- HTML uses series-place-*-a / series-place-*-b, not *-1 / *-2.
- template_id_slot_1_to_a: 1
- template_id_slot_2_to_b: 1
- literal_1_1_to_1_a: 0
- literal_1_2_to_1_b: 0
- literal_2_1_to_2_a: 0
- literal_2_2_to_2_b: 0
- literal_3_1_to_3_a: 0
- literal_3_2_to_3_b: 0
- literal_4_1_to_4_a: 0
- literal_4_2_to_4_b: 0
- replace_getSeriesPlayerSelectIds: 1


V21 Clean Rebuild: 3 Requested Changes
- index_player_db_dropdown: patched
- dom_player_db_dropdown: patched
- event_player_db_dropdown: patched
- insert_player_db_helpers: patched
- init_player_db_sync: patched
- rerender_populate_playerdb: patched
- save_playerdb_to_firebase: patched
- anti_rematch_loser_template: patched
- collect_week_current_players_only: patched
- autofill_only_current_players: patched
- Base version: V21 real Step 7 ID fix
- Added Player DB dropdown + Firebase sync for player database / stats
- Updated loser bracket first-round seeding to reduce quick rematches
- Weekly series 'other players' now limited to players actually in that night's tournament


V21 currentTournament Player DB Sync Fix
- replace_normalizer: patched
- replace_sync_function: patched
- refresh_alert: patched
- Player DB refresh now reads appState/currentTournament.playerDatabase first.
- Falls back to appState/playerDatabase only if needed.


V25 Change 2 + Change 3 + nested Firebase fix
- remove_async_async: 0
- nested_firebase_normalize_fix: 1
- sync_function_keeps_currentTournament_first: 1
- change2_anti_rematch_loser_template: 1
- change3_collect_week_current_players_only: 1
- change3_autofill_only_current_players: 0
- Base source: camarillo_darts_v21_currentTournament_playerdb_sync.zip
- Includes nested/double-wrapped currentTournament.playerDatabase normalization.


V25.1 Bracket Review 3-20 Logic
- insert_bracket_3_20_helpers: 1
- replace_buildWinnersBracket_seeded_3_20: 1
- replace_losers_template_generic_3_20: 1
- patch_syncLosersBracketTeams_auto_byes: 1
- add_finals_visual_model_helper: 1
- Supports team counts 3-20 using 4/8/16/32 seeded brackets.
- Adds balanced byes and generic loser bracket routing.
- Preserves current V25 nested Firebase fix.


V25.2 Bracket Visual Refresh
- wrap_bracket_zones: 1
- add_finals_visual_container: 1
- replace_match_box_visuals: 1
- replace_winners_visual_layout: 1
- replace_losers_visual_layout: 1
- replace_finals_visual_render: 1
- append_visual_css: 1
- Updates bracket visuals only on top of V25.1.


V25.3 Bracket Logic Cleanup
- add_blank_template_option: 1
- patch_apply_view_mode_blank: 1
- round1_byes_only: 1
- add_correction_helpers: 1
- allow_change_winner_winners: 1
- allow_change_winner_losers: 1
- losers_no_auto_advance: 1
- finals_change_winner_allowed: 1
- stats_include_finals: 1
- blank_mode_match_lines: 1
- append_v25_3_css: 1
- Base: V25.2 visuals.


V25.4 Editable Blank Template + Anti-Rematch Refinement
- add_antirem_blank_helpers: 1
- patch_resolve_antirem_source: 1
- patch_generic_loser_drop_antirem: 1
- blank_template_editable_inputs: 1
- source_label_antirem: 1
- append_v25_4_css: 1
- Base: V25.3 bracket cleanup.


V25.5 Loser Bracket Duplicate Fix
- remove_dynamic_antirem_resolver: 1
- restore_deterministic_loser_drop_rounds: 1
- clean_antirem_source_label: 1
- add_loser_round_duplicate_guard: 1
- Keeps first-round anti-rematch pairing but removes dynamic swapping that caused duplicate teams in same round.


V25.6 True Blank Template + No Auto BYE Winners
- disable_auto_advance_byes: 1
- add_blank_display_helpers: 1
- blank_hide_generated_match_ids: 1
- blank_hide_win_loss_classes: 1
- blank_hide_winner_chip_js: 1
- blank_hide_board_select_js: 1
- blank_disable_winner_clicks: 1
- blank_winner_round_titles: 1
- blank_loser_round_titles: 1
- rerender_on_bracket_mode_change: 1
- append_v25_6_css: 1
- Base: V25.5 loser duplicate fix.


V25.7 Seeded 3-20 Logic + Manual R1/R2 Editing
- remove_blank_view_option: 1
- remove_blank_apply_mode: 1
- force_no_blank_mode_runtime: 1
- add_review_style_bracket_helpers: 1
- replace_build_winners_seeded_review_logic: 1
- add_sync_winner_bracket_teams: 1
- replace_loser_template_review_style: 1
- enable_edit_round1_round2_slots: 1
- replace_show_team_select_inline_clearable: 0
- sync_winners_in_rerender: 1
- patch_apply_view_mode_no_blank: 1
- remove_old_padding_offsets: 1
- append_v25_7_css_alignment: 1
- Uses Bracket Review 3-20 clean generator concepts: seeded power-of-two slots, WB/LB/Final separation, routing-table style sources.


V25.8 Strict Reference 5-Team Bracket + Manual R1/R2 Edit
- remove_blank_option: 0
- add_strict_5team_template: 1
- use_strict_5team_in_builder: 1
- replace_showTeamSelectInline_unlocked_all_r1_r2: 1
- ensure_r1_r2_editable_condition: 1
- remove_blank_round_title_refs: 1
- remove_blank_click_branch: 1
- append_v25_8_alignment_css: 1
- Implements strict 5-team reference template first. Other team counts still use existing 3-20 generator logic.


V25.9 Strict 5-Team Sync Fix
- fix_syncWinnerBracketTeams_preserve_static_slots: 1
- confirm_strict_5team_winner_template: 1
- confirm_strict_5team_loser_template: 1
- replace_showTeamSelectInline_round2_safe: 1
- append_v25_9_css: 1
- Fixes Round 2 static BYE teams being wiped by syncWinnerBracketTeams.


V26 Source-Based Connector System
- add_connector_helpers: 1
- replace_drawBracketLines_source_based: 1
- draw_lines_after_layout: 1
- append_v26_css: 1
- Connector lines now follow team1Source/team2Source instead of generic floor(index/2) pairing.


V27.1 5-Team Winner Fix + 6-Team Loser Fix
- source_based_propagate_no_floor_overwrite: 1
- source_based_clear_advancement: 1
- add_strict_6team_templates: 1
- route_6team_to_strict_template: 1
- Fixes generic floor advancement overwriting W2 in 5-team bracket.
- Adds strict 6-team loser side reference routing.


V27.2 7-Team Loser Side Fix
- add_strict_7team_templates: 1
- route_7team_to_strict_template: 1
- Added strict 7-team loser bracket reference routing.


V27.4 8-Team Loser Bracket Reference Fix
- fix_8team_L5_LW1_vs_LW2: 1
- fix_8team_L6_LW3_vs_LW4: 1
- 8-team Loser Round 1 now uses L(W1) vs L(W2), L(W3) vs L(W4).


V28 Route-Table Engine
- Exact route maps encoded for 3-10.
- Deterministic validated support for 11-20.


V28.1 7-Team PDF Loser Bracket + Connector Fix
- replace_7team_pdf_loser_route: 1
- fix_winner_connector_route_sources: 1
- fix_loser_connector_route_sources: 1
- fix_draw_loser_route_sources: 1
- Fixed route-table connector compatibility.
- Updated 7-team loser side only.


V28.2 9-Team PDF Bracket Fix
- Replaced 9-team winner side with dependency stages from the PDF.
- Replaced 9-team loser side with PDF match routing.


V28.3 9-Team Round Structure Fix
- Replaced 9-team block using exact match.
- Winner Round 1 now has only W1: Seed 8 vs Seed 9.
- Winner Round 2 now contains W2/W3/W4/W5.
- Loser Round 1 now has only one match.
- Loser Round 2 now has two matches.


V28.5 Rebuilt Fresh Step 7 Firebase Fix
- add_quiet_series_firebase_save: 1
- replace_saveSelectedSeriesWeekFromForm_direct_firebase: 1
- replace_saveWeeklySeriesToFirebase_use_quiet: 1
- add_debug_weekly_series_week: 1


V28.6 Step 7 Series Directory Fix
- remove_current_tournament_filter_from_others: 1
- include_saved_week_ids_in_series_selectable_players: 1
- add_debug_weekly_series_summary: 1
- Other participating players are no longer filtered to current tournament only.


V28.7 Player DB / Stats Manager
- add_manage_player_db_section: 1
- add_manage_player_db_js: 1
- attach_manage_player_db_init: 1
- add_manage_player_db_css: 1
