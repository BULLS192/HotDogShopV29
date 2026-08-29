# Hot Dog Shop Live Firebase Audit — 2026-08-29

This report records the output of the read-only Firestore REST audit executed by GitHub Actions on 2026-08-29. No Firebase records were created, edited, merged, or deleted by the audit.

## Coverage

- Firebase project: `camarillo-darts---hot-dog-shop`
- Audit transport: Firestore REST
- Access errors: 0
- Raw `tournamentByWeek` documents: 18
- Hot Dog Shop tournament documents: 18
- Other-location documents: 0
- Archive documents: 9
- Player database rows: 98
- Original `hotdogshop-2026` series record: available
- Raw tournament date range: 2026-04-08 through 2026-08-27

## Clean event ledger

One raw tournament document is an empty duplicate/save-shell snapshot:

- `2026-04-29_location` — 0 players, 0 teams, no champion or runner-up.

A valid tournament record also exists for April 29:

- `2026-04-29_Hot-Dog-Shop` — 10 players, 5 teams, champion DEREK & JOSH, runner-up BRYCE & MC.

The clean perpetual event ledger therefore contains **17 meaningful weekly tournaments** through 2026-08-27 while preserving all 18 raw documents in backup/export data.

The latest tournament is 2026-08-27: 14 players, 7 teams, champion Logan & SAM, runner-up BRYCE & KEVIN.

## Player identity cleanup preview

The live audit observed:

- 120 raw/source player IDs across the player directory and tournament history.
- 83 canonical identity groups in the initial exact-identity preview.
- 20 exact duplicate groups with multiple source IDs.
- 0 broader same-first-and-last-name candidate groups under the current conservative rule.

The August 27 tournament also contains an administrative `BUY BACK` entry. The clean perpetual view excludes `BUY BACK` from player identities and standings, leaving **82 clean player identity groups** before any additional human-reviewed merges. The raw Firebase export retains the source record.

The 20 exact duplicate groups are:

1. MC — 4 source IDs — seen in 14 events
2. Esme — 2 source IDs — seen in 0 events
3. Josh — 4 source IDs — seen in 15 events
4. Jaime — 4 source IDs — seen in 12 events
5. KELSEY — 3 source IDs — seen in 2 events
6. VICKI — 2 source IDs — seen in 1 event
7. CHRIS — 2 source IDs — seen in 1 event
8. JOHNNY — 2 source IDs — seen in 1 event
9. JACK — 2 source IDs — seen in 1 event
10. DANNY — 4 source IDs — seen in 2 events
11. LYNDA — 4 source IDs — seen in 2 events
12. KEVIN — 3 source IDs — seen in 15 events
13. DENNIS — 2 source IDs — seen in 4 events
14. JESSICA — 3 source IDs — seen in 6 events
15. JENSEA — 4 source IDs — seen in 10 events
16. TAYLOR — 2 source IDs — seen in 1 event
17. DEREK — 4 source IDs — seen in 16 events
18. JORGE — 2 source IDs — seen in 5 events
19. BRYCE — 2 source IDs — seen in 13 events
20. SAM — 2 source IDs — seen in 12 events

These duplicate groups are collapsed only in the read-only standings preview. No permanent Firebase merge has been performed.

## Reconstructed perpetual standings

Standings are recomputed from tournament history using the original points schedule: 1st = 10, 2nd = 7, 3rd = 5, 4th = 3, all other participants = 1. Legacy accumulated player `stats` are not used as the authoritative standings source.

| Rank | Player | Points | Played | Wins | Podiums | Points / Entry | Last Played |
|---:|---|---:|---:|---:|---:|---:|---|
| 1 | DEREK | 112 | 16 | 10 | 11 | 7.00 | 2026-08-27 |
| 2 | MC | 74 | 14 | 4 | 8 | 5.29 | 2026-08-06 |
| 3 | Josh | 61 | 15 | 4 | 6 | 4.07 | 2026-08-27 |
| 4 | BRYCE | 58 | 13 | 1 | 7 | 4.46 | 2026-08-27 |
| 5 | GREG | 46 | 9 | 1 | 5 | 5.11 | 2026-08-13 |
| 6 | JENSEA | 43 | 10 | 1 | 5 | 4.30 | 2026-08-27 |
| 7 | SAM | 43 | 12 | 1 | 4 | 3.58 | 2026-08-27 |
| 8 | Jaime | 38 | 12 | 0 | 5 | 3.17 | 2026-08-06 |
| 9 | KEVIN | 37 | 15 | 0 | 3 | 2.47 | 2026-08-27 |
| 10 | Joel | 32 | 5 | 1 | 4 | 6.40 | 2026-08-27 |
| 11 | Omar | 27 | 4 | 1 | 4 | 6.75 | 2026-08-27 |
| 12 | JORGE | 24 | 5 | 1 | 3 | 4.80 | 2026-08-27 |
| 13 | Adam | 24 | 8 | 0 | 3 | 3.00 | 2026-08-27 |
| 14 | JESSICA | 23 | 6 | 1 | 2 | 3.83 | 2026-06-11 |
| 15 | DOSS | 21 | 4 | 1 | 3 | 5.25 | 2026-08-13 |

## Migration policy

The recommended source-of-truth hierarchy is:

1. Historical tournament/event records for results and standings.
2. Canonical Hot Dog Shop identity mapping for deduplication.
3. Nexus player IDs added to the canonical mapping as Nexus becomes authoritative.
4. Original V29 Firebase data retained as immutable lineage/archive data.

No destructive cleanup should occur until the raw Firebase export has been retained and every exact duplicate group has been reviewed.
