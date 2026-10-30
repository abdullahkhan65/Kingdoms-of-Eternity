# Backlog

Things noticed but deliberately not done in the current milestone.

## From M0
- Snapshot encoding is ~4 ms p99 for 8 clients (allocations per unit per client). Optimize before 8-player playtests if the Oracle numbers are tight: reuse buffers, share work between clients with identical visibility.
- Unit id recycling (or u32 ids) before matches can spawn more than 65,535 units in total.
- `npm audit` reports low/moderate issues in transitive deps (`elliptic`, `uuid`) via Colyseus. Re-check before public deploy.
- Measure with a network chaos proxy (latency/jitter/drop) once the browser client exists.

## Latency (from M0)
- Pakistan → Frankfurt is ~218 ms round trip, over the 150 ms target. Click-to-visible-move will be ~400 ms (RTT + tick wait + snapshot interval + interpolation) unless the client gives instant feedback: move marker, unit acknowledgement sound and facing turn on click, before the server confirms. Build that into M1.
- If most early players are in South Asia / the Gulf, consider a paid VPS nearer them (e.g. Dubai or Mumbai) once demand is proven. Free tier only works in the home region.

## Server ops
- The server on the VM runs under `nohup` (log: ~/koe-server.log). Move it to a systemd service with auto-restart before playtests.
- Oracle may reclaim idle Always Free VMs (very low CPU for 7 days). Watch for the warning email.

## Decide in M1
- Phaser 3 vs Phaser 4 (4.x is now stable on npm). Pick one before writing the client.
