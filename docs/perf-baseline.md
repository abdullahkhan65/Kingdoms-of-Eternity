# Performance baseline (M0)

Produced by `npm run spike -- --write`. Each run: 8 headless bots join one match; every bot orders 25 of its units to a random point every 500 ms, so nearly all units are always moving. No fog of war: every client receives every unit. That's the worst case for bandwidth.

Budgets: sim tick + snapshot build p99 < 25 ms at a steady 20 Hz; per-client download < 30 KB/s. KB/s counts WebSocket payload only (add ~5–10% for framing/TCP).

Not yet included in the CPU cost: pathfinding, combat, fog of war, economy. Treat today's tick time as the floor, not the ceiling.

### 2026-10-30 21:26 UTC: 8 players × 75 units, 60s

Host: Apple M4, 10 cores, Node v22.22.3

| Mode | Units | Sim Hz | Tick p50 / p99 / max (ms) | Snapshot build p99 (ms) | Server CPU | RSS | Per-client KB/s avg / max | Cmds ok / rejected | Tick budget | Bandwidth budget |
|---|---:|---:|---|---:|---:|---:|---|---|---|---|
| binary | 600 | 20.0 | 0.71 / 0.88 / 1.68 | 2.76 | 4.5% | 128 MB | 23.6 / 23.6 | 960 / 0 | PASS | PASS |
| schema | 600 | 20.0 | 1.27 / 2.97 / 4.34 | 0.00 | 4.8% | 98 MB | 48.3 / 48.3 | 960 / 0 | PASS | FAIL |
