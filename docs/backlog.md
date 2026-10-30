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
- Playtest URL is plain http (http://89.168.127.10:2567). Fine for friends; for a public page (itch.io / Cloudflare Pages are https) the server needs wss: TLS via Caddy + sslip.io, or Cloudflare Tunnel.
- Run `npm run smoke` in CI (needs `npx playwright install --with-deps chromium` in the workflow).
- Oracle may reclaim idle Always Free VMs (very low CPU for 7 days). Watch for the warning email.

## M1 remaining
- Terrain obstacles + A* pathfinding (units currently walk in straight lines through everything).
- Minimap, control groups (Ctrl+1–9), idle/selection hotkeys.
- Server-side room test for player-slot reuse (the clients.length bug fixed in MatchRoom.freePlayerSlot).
- Client bundle is ~414 KB gzipped (Phaser). OK for now; revisit before public launch.
