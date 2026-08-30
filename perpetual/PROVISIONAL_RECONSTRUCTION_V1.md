# Hot Dog Shop — Provisional Tournament Reconstruction V1

Generated: 2026-08-30

## Purpose

This is a non-destructive reconstruction of the Hot Dog Shop weekly tournament history using every currently available Firebase source. It is intentionally conservative: uncertain information is flagged rather than silently promoted to fact.

Original Firebase data remains unchanged.

## Confidence states

- **Confirmed** — multiple independent Firebase representations agree on the same event/result.
- **Recovered** — event/result is absent from the tournament ledger but recoverable from another stored source.
- **Probable** — one stored tournament record exists and appears internally coherent, but lacks independent corroboration.
- **Disputed** — stored result is contradicted by organizer knowledge.
- **Unknown** — expected weekly date with no surviving result evidence; may have been cancelled or simply not saved.

## Normalization rule

Several tournament records were saved with Thursday dates while the season ledger used the preceding Wednesday. These are treated as the same weekly event when the participants/results align:

- 2026-04-15 ↔ saved 2026-04-16
- 2026-05-06 ↔ saved 2026-05-07
- 2026-06-03 ↔ saved 2026-06-04
- 2026-06-17 ↔ saved 2026-06-18

## Reconstructed event ledger

| Canonical week | Confidence | 1st | 2nd | 3rd/4th availability | Evidence notes |
|---|---|---|---|---|---|
| 2026-04-08 | Confirmed | JORGE & DEREK | JENSEA & CHRIS | Recoverable from elimination/series data | Tournament + archive + series agree |
| 2026-04-15 | Confirmed | JENSEA & DEREK | LYNDA & RYAN KEY | Recoverable | Saved as 2026-04-16; archive + series agree |
| 2026-04-22 | Confirmed | MC & GREG | DEREK & SAM | Recoverable | Tournament + archive + series agree |
| 2026-04-29 | Confirmed | DEREK & JOSH | BRYCE & MC | Recoverable | Valid tournament + archive + series agree; separate empty save shell ignored |
| 2026-05-06 | Confirmed | MC & DEREK | JENSEA & JAIME | Recoverable | Saved as 2026-05-07; archive + series agree |
| 2026-05-13 | Confirmed | JESSICA & DEREK | JEREMY & JAIME | Recoverable | Tournament + archive + series agree |
| 2026-05-20 | Recovered | Jaime & Derek | Josh & MC | 3rd Bryce & Sam; 4th Dennis & unresolved player | Missing tournament document; complete placements survive in `seriesSeasons` |
| 2026-05-27 | Unknown | — | — | — | No surviving tournament, archive, or series record |
| 2026-06-03 | Confirmed | Mercedes & DEREK | Hayley & BRYCE | Recoverable | Saved as 2026-06-04; tournament + archive + series agree |
| 2026-06-11 | Confirmed | JOSH & Derek | DENNIS & GREG | Recoverable | Tournament + archive agree |
| 2026-06-17 | Confirmed | BRYCE & DEREK | Omar & GREG | Series contains complete 1st–4th + others | Saved as 2026-06-18; archive + series agree |
| 2026-06-25 | Probable | SLIM & Justin G | Joel & CORTEZ | Recoverable from tournament state | Single coherent saved tournament; no archive/series cross-check |
| 2026-07-02 | Probable | MC & Joel | GREG & Batman | Recoverable from tournament state | Single coherent saved tournament |
| 2026-07-09 | Probable | Omar & JOSH | BRYCE & MC | Recoverable from tournament state | Result exists; `completed=false` is known unreliable |
| 2026-07-16 | Unknown | — | — | — | No surviving tournament, archive, or series record |
| 2026-07-23 | Probable | JOSH & DOSS | SAM & JENSEA | Recoverable from tournament state | Result exists; `completed=false` |
| 2026-07-30 | Probable | MC & Patrick | Adam & Joel | Recoverable from tournament state | Result exists; `completed=false` |
| 2026-08-06 | Probable | DEREK & JASON | GREG & JEFF | Recoverable from tournament state | Single coherent saved tournament |
| 2026-08-13 | Probable | Brother James & DEREK | Cody T & Joel | Recoverable from tournament state | Single coherent saved tournament |
| 2026-08-20 | Unknown | — | — | — | No surviving tournament, archive, or series record |
| 2026-08-27 | Disputed | **Stored: Logan & SAM — known wrong** | Stored: BRYCE & KEVIN | Do not trust until reviewed | Organizer confirms Logan did not win; entire event excluded from official reconstruction for now |

## Currently reconstructable May 20 result

The season ledger preserves these exact player IDs and placements:

- 1st: `plr_mnwo04ix_rm6bom4v` + `plr_mnwo04ix_aqk7cw9g` → Jaime + Derek
- 2nd: `plr_mnwo04ix_z684yyhg` + `plr_mnwo04ix_4n88i3lx` → Josh + MC
- 3rd: `plr_moarxquf_72mbr7gn` + `plr_moatcw1h_hxloueq3` → Bryce + Sam
- 4th: `plr_monbd0h3_4eagsogj` + `plr_mpet31ut_135gounc` → Dennis + unresolved identity
- Other participants: `plr_mpet2fep_pbgast0q` + `plr_mpet2v09_qhelf1kz`; second maps to Esme, first still unresolved

This event should eventually count once the two unresolved IDs are mapped.

## Known structural corruption / inconsistencies

1. `2026-04-29_location` is an empty duplicate shell and is not a real second event.
2. Later events can contain champion and runner-up data while `completed=false`, so completion flags cannot be used as truth.
3. Only 9 archive records survived, despite many more tournament weeks.
4. `seriesSeasons/hotdogshop-2026` stopped being maintained consistently after June.
5. V29 player aggregate statistics are not reliable as a reconstruction source because aggregate update paths could execute more than once.
6. Duplicate player IDs exist for many people; results must be joined by canonical identity, not raw Firebase ID alone.
7. Administrative placeholders such as `BUY BACK` must not become player identities.

## Provisional inclusion policy for standings

For the first reconstructed preview, use:

- **Include:** Confirmed + Recovered events
- **Show separately, not official:** Probable events
- **Exclude:** Disputed + Unknown

This prevents the known-bad August 27 result and completely missing weeks from contaminating the trusted baseline while still preserving likely later results for review.

## Review order

For organizer review, work newest to oldest:

1. 2026-08-27 — disputed
2. 2026-08-20 — unknown
3. 2026-08-13 — probable
4. 2026-08-06 — probable
5. 2026-07-30 — probable
6. 2026-07-23 — probable
7. 2026-07-16 — unknown
8. 2026-07-09 — probable
9. 2026-07-02 — probable
10. 2026-06-25 — probable
11. 2026-06-17 backward — mostly high-confidence historical baseline

Corrections should be stored as reviewed overrides in the reconstruction ledger and never destructively rewrite the raw Firebase evidence.
