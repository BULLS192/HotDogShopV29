# Hot Dog Shop V29 — Forensic Recovery Findings

Generated: 2026-08-30

## Status

**Do not treat the reconstructed standings as official yet.** The Firebase history is incomplete and contains inconsistent save dates/status flags. No Firebase data has been deleted or modified by this audit; all reads were read-only.

## Sources cross-checked

- `tournamentByWeek`: 18 documents
- `tournaments` archives: 9 documents
- `seriesSeasons/hotdogshop-2026`: 9 week records
- `appState/currentTournament`: present

## Key finding: at least one tournament exists in standings data but has no saved tournament document

`seriesSeasons/hotdogshop-2026` contains a week for **2026-05-20** with 10 participant references and complete 1st–4th placement data, but there is no `tournamentByWeek` document and no archive for that date.

Recovered May 20 placement IDs:

- 1st: `plr_mnwo04ix_rm6bom4v` + `plr_mnwo04ix_aqk7cw9g` (Jaime + Derek)
- 2nd: `plr_mnwo04ix_z684yyhg` + `plr_mnwo04ix_4n88i3lx` (Josh + MC)
- 3rd: `plr_moarxquf_72mbr7gn` + `plr_moatcw1h_hxloueq3` (Bryce + Sam)
- 4th: `plr_monbd0h3_4eagsogj` + `plr_mpet31ut_135gounc` (Dennis + unresolved player ID pending identity mapping)
- Other participants: `plr_mpet2fep_pbgast0q`, `plr_mpet2v09_qhelf1kz` (second ID maps to Esme; first pending identity mapping)

This proves the tournament ledger is incomplete.

## Apparent date-offset records that should not be counted as separate missing tournaments

The season record uses Wednesday dates for several events whose saved tournament document is dated the following day. These appear to be the same tournaments, not extra events:

- season `2026-04-15` ↔ saved tournament `2026-04-16`
- season `2026-05-06` ↔ saved tournament `2026-05-07`
- season `2026-06-03` ↔ saved tournament `2026-06-04`
- season `2026-06-17` ↔ saved tournament `2026-06-18`

The reconstruction must normalize this Wednesday/Thursday date drift before deduplication.

## Missing-week candidates requiring verification

Based on weekly cadence plus all Firebase evidence currently available:

- **2026-05-20** — confirmed tournament evidence in season standings, missing tournament document; recoverable.
- **2026-05-27** — no tournament document, archive, or season week found; unknown whether tournament occurred.
- **2026-07-16** — no tournament document, archive, or season week found; unknown whether tournament occurred.
- **2026-08-20** — no tournament document, archive, or season week found; unknown whether tournament occurred.

These dates must be reviewed against external evidence (flyers/posts/photos/messages/payment records/manual notes) before being classified as cancelled or missing.

## Other data-quality problems

- Duplicate save shell for `2026-04-29_location`: 0 players, 0 teams, no result. A valid April 29 tournament document also exists.
- Several later tournament documents contain champion/runner-up information but have `completed=false`, including July 9, July 23, July 30, and August 27. Therefore the `completed` flag is not reliable by itself.
- Only 9 archive documents exist while meaningful weekly history extends much further, so archive coverage is incomplete.
- Old accumulated player stats remain unsafe as an authoritative source because V29 can update aggregates from multiple save/finalize paths.

## Recommended reconstruction policy

1. Preserve all raw Firebase data unchanged.
2. Build a master event ledger with one row per expected tournament date.
3. Give every week a confidence state: `confirmed`, `recovered`, `partial`, `missing`, or `cancelled`.
4. Merge Wednesday/Thursday date-offset duplicates only when participant/results evidence agrees.
5. Recover May 20 from `seriesSeasons` rather than omitting it.
6. Do not infer May 27, July 16, or August 20 as played until another source confirms them.
7. Recalculate standings only from reviewed event rows.
8. Map player identities to Nexus IDs before final migration.

## Current conclusion

The previously displayed all-time standings are **provisional and incomplete** because they were reconstructed mainly from `tournamentByWeek`. They should not be treated as official until the missing-history review is complete.
