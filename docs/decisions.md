# Decisions

One line per decision, newest last. Don't re-argue these without new evidence.

- 2026-10-31: npm workspaces monorepo, TypeScript 5.9 strict, Vitest, tsx. (TS 7 native is out but new; revisit later.)
- 2026-10-31: `@colyseus/core` + `@colyseus/ws-transport` 0.18, not the `colyseus` meta-package (it pulls in auth, Redis, monitor, playground).
- 2026-10-31: Unit state goes over custom binary delta snapshots, not Colyseus schema sync. M0: schema used 2× the bandwidth (48 vs 24 KB/s per client, 600 units). Schema stays available for lobby/match metadata.
- 2026-10-31: The room runs its own 20 Hz accumulator loop. `Room.setFixedTimestep` ran at ~6 Hz when `patchRate = null` because Colyseus ticks the room clock from a second interval.
- 2026-10-31: 1 tile = 64 world units, 128×128 tile map, so positions fit in int16. Unit ids are u16 on the wire; the encoder throws past 65535 (id recycling is in the backlog).
- 2026-10-31: Network snapshots at 10 Hz (every 2nd sim tick); clients interpolate.
- 2026-10-31: Pop cap 75 per player for MVP. M0 worst case (all 600 units moving, no fog) is 23.6 KB/s per client, under the 30 KB/s budget; 150/player is 46.6 KB/s.
