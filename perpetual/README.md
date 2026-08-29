# Hot Dog Shop Perpetual Standings — Migration Preview

This folder is a read-only successor prototype for the original `HotDogShopV29` weekly tournament manager.

## Safety status

- Original V29 root files are intentionally unchanged.
- A pre-change backup branch exists: `backup-v29-2026-08-29`.
- Backup branch base commit: `ceae184f9f248c033652675df03374fb044ebba8`.
- This dashboard performs Firebase reads only.
- It does **not** merge, delete, overwrite, or migrate Firestore records.
- Export Raw Firebase Backup before any future cleanup write is approved.

## Why a perpetual rebuild is needed

V29 was designed around a finite championship:

- weekly selector hard-coded from 2026-04-08 through 2026-07-01;
- 1st / 2nd / 3rd / 4th / other points = 10 / 7 / 5 / 3 / 1;
- Best 6 weeks count;
- minimum 8 weeks for championship eligibility;
- Top 16 + wildcard / qualifier workflow.

The weekly tournament continued beyond that original season window, so standings should now be derived from the historical tournament ledger instead of a fixed season date list.

## Authoritative source strategy

For the perpetual build, raw tournament history is more trustworthy than the legacy accumulated player `stats` object.

V29 increments player statistics when a tournament is saved. The same accumulation function is called from multiple save/archive/finalize paths, which means aggregate totals can be incremented more than once for a single event. The new dashboard therefore recomputes standings from individual historical events.

Primary event source:

- `tournamentByWeek/{date_location}`

Supporting / backup sources:

- `appState/playerDatabase`
- `appState/currentTournament`
- `seriesSeasons/hotdogshop-2026`
- `tournaments/{archiveId}`

## Current read-only dashboard

The dashboard:

1. loads Firebase history;
2. decodes V29's custom Firestore array wrapper;
3. reconstructs tournament placings from the saved tournament snapshot;
4. gives each player the original weekly points (10 / 7 / 5 / 3 / 1);
5. computes perpetual All-Time standings;
6. computes current-year standings;
7. computes a Rolling-12 event view;
8. creates a conservative player identity cleanup preview;
9. flags exact and possible duplicate groups;
10. exports a raw Firebase JSON backup;
11. exports a cleaned, Nexus-ready migration preview JSON.

## Duplicate policy

No duplicate is automatically changed in Firebase.

### Exact preview group

Different source IDs have the same normalized:

- first name;
- last name;
- nickname;
- gender.

These are collapsed only in the dashboard preview so the standings are easier to review.

### Possible duplicate group

The normalized first + last name match, but nickname and/or gender differs. These records are only flagged and are never collapsed automatically.

Human review should happen before any permanent merge.

## Nexus migration target

The cleaned export is intentionally shaped around four concepts:

- `players`: canonical Hot Dog Shop identity, all source IDs, future `nexusPlayerId`;
- `events`: one record per weekly tournament;
- `results`: event + canonical player + placement + points;
- source lineage: `hotdogshop-v29` retained on migration.

The long-term target should be:

1. Nexus becomes the authoritative player identity directory.
2. Hot Dog Shop records map to Nexus player IDs.
3. The weekly tournament UI becomes a Nexus tournament/venue view rather than an independent player database.
4. V29 remains archived as a historical source and emergency fallback.

## Next migration gates

Before enabling any write-back cleanup:

- download and retain the raw Firebase export;
- compare event count against known tournament dates;
- review every Exact duplicate group;
- review every Possible duplicate group;
- reconcile any missing / incomplete tournaments;
- approve canonical player mapping;
- import mappings into Nexus;
- only then consider deprecating the V29 player database.
