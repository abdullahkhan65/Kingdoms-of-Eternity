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

### Oracle Cloud Always Free (Frankfurt, VM.Standard.A1.Flex 4 OCPU / 24 GB), bots on the same VM

Host: Neoverse-N1, 4 cores, Node v22.22.3

| Mode | Units | Sim Hz | Tick p50 / p99 / max (ms) | Snapshot build p99 (ms) | Server CPU | RSS | Per-client KB/s avg / max | Cmds ok / rejected | Tick budget | Bandwidth budget |
|---|---:|---:|---|---:|---:|---:|---|---|---|---|
| binary | 600 | 20.0 | 0.32 / 0.50 / 2.30 | 1.93 | 3.1% | 139 MB | 23.6 / 23.6 | 955 / 0 | PASS | PASS |
| schema | 600 | 20.0 | 0.60 / 0.76 / 1.21 | 0.00 | 2.4% | 105 MB | 48.3 / 48.3 | 956 / 0 | PASS | FAIL |

### Over the internet: 8 bots on a home connection in Pakistan → Oracle Frankfurt

TCP round-trip Pakistan → Frankfurt: min 211 / median 218 / max 252 ms.

| Mode | Units | Sim Hz | Tick p50 / p99 / max (ms) | Snapshot build p99 (ms) | Server CPU | RSS | Per-client KB/s avg / max | Cmds ok / rejected | Tick budget | Bandwidth budget |
|---|---:|---:|---|---:|---:|---:|---|---|---|---|
| binary | 600 | 20.0 | 0.36 / 0.50 / 0.66 | 2.99 | 4.3% | 103 MB | 23.7 / 23.7 | 960 / 0 | PASS | PASS |

**M0 verdict: server and bandwidth pass on the free VM. Latency from Pakistan (~218 ms) misses the 150 ms target. See backlog.**

### 2026-10-30 23:44 UTC: full game, 8 players × 75 units + towns + map, 30s

Host: remote ws://89.168.127.10:2567

| Mode | Entities | Sim Hz | Tick p50 / p99 / max (ms) | Snapshot build p99 (ms) | Server CPU | RSS | Per-client KB/s avg / max | Cmds ok / rejected | Tick budget | Bandwidth budget |
|---|---:|---:|---|---:|---:|---:|---|---|---|---|
| binary | 1841 | 20.0 | 6.94 / 19.53 / 23.70 | 7.33 | 24.0% | 147 MB | 2.1 / 3.4 | 476 / 0 | FAIL | PASS |

### 2026-10-30 23:45 UTC: full game, 8 players × 75 units + towns + map, 30s

Host: remote ws://89.168.127.10:2567

| Mode | Entities | Sim Hz | Tick p50 / p99 / max (ms) | Snapshot build p99 (ms) | Server CPU | RSS | Per-client KB/s avg / max | Cmds ok / rejected | Tick budget | Bandwidth budget |
|---|---:|---:|---|---:|---:|---:|---|---|---|---|
| binary | 1841 | 20.0 | 8.12 / 21.34 / 35.22 | 3.43 | 24.4% | 154 MB | 2.2 / 3.4 | 480 / 0 | PASS | PASS |
