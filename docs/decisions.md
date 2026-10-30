# Decisions

One line per decision, newest last. Don't re-argue these without new evidence.

- 2026-10-31: npm workspaces monorepo, TypeScript 5.9 strict, Vitest, tsx. (TS 7 native is out but new; revisit later.)
- 2026-10-31: `@colyseus/core` + `@colyseus/ws-transport` 0.18, not the `colyseus` meta-package (it pulls in auth, Redis, monitor, playground).
- 2026-10-31: Unit state goes over custom binary delta snapshots, not Colyseus schema sync. M0: schema used 2× the bandwidth (48 vs 24 KB/s per client, 600 units). Schema stays available for lobby/match metadata.
- 2026-10-31: The room runs its own 20 Hz accumulator loop. `Room.setFixedTimestep` ran at ~6 Hz when `patchRate = null` because Colyseus ticks the room clock from a second interval.
- 2026-10-31: 1 tile = 64 world units, 128×128 tile map, so positions fit in int16. Unit ids are u16 on the wire; the encoder throws past 65535 (id recycling is in the backlog).
- 2026-10-31: Network snapshots at 10 Hz (every 2nd sim tick); clients interpolate.
- 2026-10-31: Pop cap 75 per player for MVP. M0 worst case (all 600 units moving, no fog) is 23.6 KB/s per client, under the 30 KB/s budget; 150/player is 46.6 KB/s.
- 2026-10-31: Game server host = Oracle Cloud Always Free, Frankfurt (eu-frankfurt-1, AD-1), VM.Standard.A1.Flex 4 OCPU / 24 GB, Ubuntu 24.04, public IP 89.168.127.10, SSH key ~/.ssh/oracle_koe. Port 2567 open in the VCN security list and in iptables. AD-2 had no A1 capacity.
- 2026-10-31: M0 gate passed on that VM (0.50 ms tick p99, 23.7 KB/s per client over the internet). The free ARM VM is faster per tick than the M4 dev machine.
- 2026-10-31: express (already a dependency of @colyseus/ws-transport) is declared directly in @koe/server to serve the built client when CLIENT_DIST is set. One URL, one open port; no separate static host needed for playtests.
- 2026-10-31: Client uses Phaser 4.2 (WebGL) + Vite; HUD is plain HTML over the canvas. Clients render ~150 ms in the past (1.5 snapshot intervals) and interpolate; move orders get instant cosmetic feedback (marker + order lines).
- 2026-10-31: VM runs the server as systemd unit `koe` (deploy/koe.service), deployed with `npm run deploy`. Game + client page on one port: http://89.168.127.10:2567.
- 2026-10-31: Full MVP slice built (PLAN §3): 3 resources, 6 buildings, 5 units with a counter triangle (spear > scout > archer > spear; swordsman all-rounder), 2 ages ("Age of Hearth", "Age of Banners", original names), 2 civs, generated maps, fog of war, lobby with bots/teams/civs, reconnect.
- 2026-10-31: Defeat = losing your last Town Center (finished or not); last team standing wins. Defeated players' entities are removed.
- 2026-10-31: Fog of war is enforced on the server (`entitiesVisibleTo`): enemies outside vision are never sent. Resource nodes are always sent (terrain). Allies share vision.
- 2026-10-31: Civ balance tuned with `npm run balance` (bot vs bot, 4 seeds × swapped civs). Aurelian carry +3 won 6 of 7; +2 gives 4–4.
- 2026-10-31: Camera moved from WASD to arrows / screen edge / middle-drag so letter keys can be hotkeys (Q–Y command slots, A attack-move, S stop, H Town Center, . idle villager).
- 2026-10-31: Pathfinding is budgeted (12 route searches per tick, A* on reusable typed arrays, forward string-pulling). Snapshots are staggered by player slot across ticks.
- 2026-10-31: The room keeps a seat 60 s after an unexpected disconnect (Colyseus onDrop/allowReconnection); a tab refresh rejoins via a reconnection token in sessionStorage. Not back in time = resign.
