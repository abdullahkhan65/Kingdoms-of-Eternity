# Backlog

Things noticed but deliberately not done in the current milestone.

## From M0
- Re-run `npm run spike` on the Oracle Cloud Always Free ARM VM (the remaining M0 gate item). Expect ~2–4× slower per core than an M4.
- Snapshot encoding is ~4 ms p99 for 8 clients (allocations per unit per client). Optimize before 8-player playtests if the Oracle numbers are tight: reuse buffers, share work between clients with identical visibility.
- Unit id recycling (or u32 ids) before matches can spawn more than 65,535 units in total.
- `npm audit` reports low/moderate issues in transitive deps (`elliptic`, `uuid`) via Colyseus. Re-check before public deploy.
- Measure with a network chaos proxy (latency/jitter/drop) once the browser client exists.

## Decide in M1
- Phaser 3 vs Phaser 4 (4.x is now stable on npm). Pick one before writing the client.
