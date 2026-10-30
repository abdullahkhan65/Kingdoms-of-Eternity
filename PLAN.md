# Kingdoms of Eternity — Execution Plan v3

This is a revision of `requirement-doc.md` (v2.0). The vision, principles and "build → prove → raise" strategy stay the same. This plan changes **what we build first, in what order, and on what infrastructure**, so the first proof can be reached solo, part-time, for $0.

---

## 1. What changes and why

| v2.0 PRD | This plan | Why |
|---|---|---|
| Single-player systems first, multiplayer in weeks 7–10 | **Multiplayer from day one.** Every feature is built networked. | Retrofitting netcode onto a single-player RTS is the most common way these projects die. Multiplayer is the riskiest part, so we tackle it first. |
| 14 buildings, 12 units, 4 ages, 4 resources, 3–5 maps | **Vertical slice:** 6 buildings, 5 units, 2 ages, 3 resources, 1 map + 1 generator | One solo dev can't balance a full roster. A small game that's fun beats a big one that's broken. |
| Accounts, PostgreSQL, Redis, Docker, Sentry in MVP | **Guest names + room links. No database.** | Accounts don't prove that people want the game. They add auth, security and hosting cost. Add them once people come back for more. |
| 16-week calendar | **Milestones with "proof gates"**, not dates | Calendars slip; gates tell you if you're actually making progress. |
| 8 players as the launch requirement | **2 → 4 → 8**, each a gate | 8-player sync is the hardest target. Prove 2 first. |
| "No AI opponents" | **One simple scripted bot** | Friends won't always be online. A bot also acts as a test harness and a load generator. |
| $0–20/mo for private testing | **$0 at every stage up to the first public beta** (see §5) | Free tiers exist for every piece of this if the stack stays simple. |

---

## 2. Strategy: the "first proof"

**The first proof is not "a full RTS". It's this:**

> 4–8 friends open a link, join a lobby, play a 20–30 minute match with economy and combat, and **at least half of them ask to play again.**

Everything in the MVP serves that sentence. If a feature doesn't help reach it, it waits.

---

## 3. MVP scope (vertical slice)

### Included
- **Resources (3):** Food, Wood, Gold. *(Stone comes with walls, after MVP.)*
- **Ages (2):** Age I → Age II, plus one age-up research at the Town Center.
- **Buildings (6):** Town Center, House (population), Storehouse (one generic drop-off instead of separate lumber/mining camps), Farm, Barracks, Archery Range.
  - *Stable, Watchtower and Blacksmith come next, after MVP.*
- **Units (5):** Villager, Spearman, Swordsman, Archer, Scout cavalry. That gives a clear counter triangle: spear beats cavalry, archer beats spear, sword/cavalry beat archer.
- **Civilizations (2):** Original factions. Same roster, different colors/art, **one** unique bonus each.
- **Map:** 1 hand-made 4-player map and 1 simple random generator (2–8 players).
- **Fog of war:** explored vs. visible, filtered **on the server** so no player ever receives hidden data.
- **Victory:** destroy all enemy Town Centers *(or all buildings; decide in playtest)*.
- **Lobby:** create a room, share a link/code, pick name, civ, team and color, host starts the game. Public room list optional.
- **Reconnect:** a dropped player can rejoin within 60 s. Their units keep standing still in the meantime, and the match never pauses for the others.
- **Bot:** one scripted AI (build economy → mass army → attack at minute X).
- **Pop cap:** 75 per player. *(8 × 75 = 600 units is a realistic server budget; raise it later if measurements allow.)*

### Explicitly deferred
Accounts/login, persistent profiles, campaign, stone/walls/gates, siege, healers, ages III–IV, formations, market/trading, ranked play, leaderboards, chat beyond quick text, sound design beyond placeholder, mobile.

---

## 4. Tech stack (familiar + free)

All TypeScript, so one language runs across client, server, sim and tests.

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | Shared types end to end. |
| Monorepo | npm workspaces (or pnpm) | No Nx/Turborepo until it hurts. |
| Build/dev server | Vite | Fast, zero config. |
| Rendering | Phaser 3 | Mature, well documented, and Claude knows it well. Rendering only: **no game rules in Phaser code.** |
| Menus / HUD | Plain HTML/CSS (or React if you already know it) overlaid on the canvas | Avoids building UI widgets inside Phaser. |
| Networking | Colyseus (rooms, matchmaking, reconnection) | Use it for rooms, lobby and reconnect. Unit state goes through **custom compact snapshot messages** if schema sync turns out too heavy (we measure this in M0). |
| Simulation | Plain TS package, no dependencies | Runs on the server (authoritative), in tests and in the bot. |
| Pathfinding | Grid A* + flow fields for group moves | Write it in-house; it's core and it's small. |
| Tests | Vitest (sim/unit), Playwright (browser smoke) | Both free. |
| Analytics | Cloudflare Web Analytics or PostHog free tier | Only needed to measure the proof (§8). |
| Error reporting | Sentry free tier (later) | Optional before the public beta. |
| CI | GitHub Actions (free for public repos; 2,000 min/mo private) | Lint + typecheck + tests on every push. |

**Not used in the MVP:** PostgreSQL, Redis, Docker, Kubernetes, CDN config. If persistence is ever needed before real hosting, use a **JSON file on the server** or the **Supabase free tier**.

> **Familiarity check:** this stack assumes you're comfortable with TypeScript/JavaScript and Node. If you know a different stack better (e.g. C#/Unity, Godot), say so. The architecture below still applies, but the tools would change.

---

## 5. $0 hosting path

| Stage | Client (static) | Game server | Cost |
|---|---|---|---|
| **Dev** | `vite dev` on localhost | `node` on localhost; open 8 browser tabs | $0 |
| **Friends playtests** | Cloudflare Pages / GitHub Pages / itch.io | **Your own computer + Cloudflare Tunnel** (free, gives a public `wss://` URL, no port forwarding) | $0 |
| **Always-on beta** | Same | **Oracle Cloud Always Free** ARM VM (up to 4 cores / 24 GB RAM; a card is needed for verification) | $0 |
| **Growth** | Same | Paid VPS (Hetzner etc., ~€5–10/mo) once demand is proven | Low |

Notes:
- **itch.io** is free, hosts HTML5 games, and comes with an audience, comments and devlogs. Use it as the public home page for validation.
- Avoid free tiers that **sleep** (e.g. Render free); a sleeping server drops live matches.
- Free-tier terms change. Re-check them when we reach each stage.

---

## 6. Architecture

```
packages/
  sim/       Pure game rules. Deterministic tick(state, commands) -> state.
             No Phaser, no Colyseus, no Date.now(), no Math.random() (seeded RNG only).
  protocol/  Command + snapshot types, (de)serialization, versioning.
  server/    Colyseus rooms. Lobby room + Match room. Validates commands,
             runs sim at 20 Hz, sends per-player fog-filtered snapshots at 10 Hz.
  client/    Phaser renderer + HTML UI. Sends commands, interpolates snapshots.
             Never decides outcomes.
  bot/       Headless AI player. Talks to the server exactly like a client.
```

Key rules:
1. **One copy of the game logic** lives in `sim`. The server runs it. The client never re-implements rules: it only renders and interpolates. (This is how we satisfy "no duplicated logic" from the PRD.)
2. **Clients send intents only:** "move units [ids] to (x,y)", "train spearman at building N". The server validates ownership, cost and legality.
3. **Integer/fixed-point positions** in the sim. That makes replays and test snapshots reproducible.
4. **Bandwidth budget:** each player gets only *visible* entities, positions are quantized to int16, and we send deltas only. Target **< 30 KB/s per client** in an 8-player late game.
5. **Replays for free:** log `(seed, commands per tick)` for every match. Replaying a log reproduces the match exactly. That's the best bug-report tool we'll have.

---

## 7. Milestones and proof gates

Each milestone ends with a **gate**: a demo plus tests that must pass before moving on. Rough effort assumes ~15–20 h/week part-time.

### M0 — Risk spike (≈1 week)
Throwaway prototype. **Goal: find out if the server holds up before building anything real.**
- Colyseus server running a dummy sim with 600 moving units at 20 Hz.
- 8 headless bot clients connected.
- **Gate:** measure server CPU per match, bytes/sec per client and tick time (p50/p99) on your laptop **and** on the Oracle free VM. Write the numbers into `docs/perf-baseline.md`. If they miss the budget, adjust the pop cap or sync strategy *now*.

### M1 — Two players, one world (≈2–3 weeks)
- Monorepo, CI, the `sim` package with tick loop, tile map, camera (WASD/edge scroll/zoom).
- Select (click/drag box), right-click move, A* pathfinding, simple unit separation.
- 2 browser tabs see each other's units moving smoothly (interpolated).
- **Gate:** 2 players on different networks (via Cloudflare Tunnel) move units with no visible jitter at 150 ms simulated latency. Pathfinding and command validation have unit tests.

### M2 — Economy (≈2–3 weeks)
- Villagers gather food/wood/gold and walk back to drop-offs; resources are server-side.
- Build placement + construction; Town Center, House, Storehouse, Farm; train villagers; population.
- **Gate:** a scripted test drives a 10-minute economy and the resource totals exactly match the expected values. A forged client message ("give me 9999 gold", "move enemy unit") gets rejected, and a test proves it.

### M3 — Combat + win condition (≈2–3 weeks)
- Barracks and Archery Range, 4 military units, attack/attack-move, building damage and destruction, Age II.
- Victory/defeat, then a match results screen.
- Basic bot.
- **Gate:** you play a full match vs. the bot to victory. Combat math has unit tests. 2 humans finish a match with no desync or crash.

### M4 — Fog, lobby, reconnect, 4 players (≈2–3 weeks)
- Server-side fog filtering (tested: a client snapshot **never** contains enemy entities outside its vision).
- Lobby: room link, civ/team/color selection, start. Reconnect within 60 s.
- 2 civilizations with one bonus each, and the random map generator.
- **Gate — FIRST PLAYTEST:** 4 real people, at least 2 matches, over the Tunnel. Collect feedback with a 5-question form (Google Forms, free).

### M5 — 8 players + polish (≈2–3 weeks)
- Performance pass against the M0 budget, with 8 humans or 4 humans + 4 bots.
- Hotkeys (control groups, idle-villager key), minimap, basic sound, a tutorial tooltip pass.
- Placeholder art replaced with a consistent CC0 set (e.g. Kenney.nl) recolored to the game's identity.
- **Gate:** an 8-player match runs 30 min with p99 server tick < 25 ms and no crashes.

### M6 — Public proof (ongoing)
- Deploy the server to the Oracle free VM and the client to itch.io.
- Discord server (free), weekly scheduled "game night", devlog posts.
- **Gate = the first proof (§2)**, measured with the metrics in §8.

**Total to first playtest: ~10–13 weeks part-time. To public proof: ~16–20 weeks.**

---

## 8. How we "prove ourselves" (validation metrics)

Measure only what an investor or a collaborator would believe:

| Metric | Early signal | Strong signal |
|---|---|---|
| Playtest sessions held | 5 | 20+ |
| Unique players who finished a match | 30 | 200+ |
| **Players who came back for a 2nd session** | 30% | 50%+ |
| Average match length | 15 min | 25 min+ |
| Discord members | 50 | 500+ |
| itch.io followers / ratings | 25 | 250+ |

Also keep a **devlog** (itch.io/Reddit/X) with a short GIF every week. It costs nothing, builds an audience, and becomes the investor timeline later.

---

## 9. Testing plan (cheap but real)

- **Sim unit tests (Vitest):** economy, combat, construction, pathfinding, command validation. Must be fast enough to run on every save.
- **Replay tests:** saved command logs from real matches replay to the same final-state hash. Every crash bug gets its replay added as a regression test.
- **Bot soak test:** 8 bots play full matches headless in CI or overnight. Watch for crashes, memory growth and tick-time spikes.
- **Network chaos:** Chrome DevTools throttling + a small proxy in the dev server that adds latency/jitter/drop. Kill and reconnect clients mid-match.
- **Anti-cheat tests:** forged and out-of-turn commands, controlling another player's units, building without resources. All must be rejected.
- **Playwright smoke:** open lobby → create room → second tab joins → match starts.

---

## 10. Working with Claude Code (within an existing subscription)

- Put a `CLAUDE.md` in the repo with the architecture rules from §6 and the PRD's development rules. Claude reads it every session.
- **One milestone task per session**, scoped small: "add attack-move to sim with tests", not "build combat".
- Ask for **tests first or tests alongside**. A feature is done when its gate test passes, not when Claude says so.
- Keep a `docs/decisions.md` log (one line per decision) so later sessions don't re-argue settled questions.
- Subscription usage limits are real. Spend them on sim logic, netcode and tests; do repetitive asset or config work by hand or in batches.

---

## 11. Top risks

| Risk | Mitigation |
|---|---|
| Server can't handle 8 × N units on a free VM | M0 spike measures it first; pop cap and snapshot rate are tunable. |
| Pathfinding feels bad (units stuck, clumping) | Budget real time for it in M1; flow fields for groups; test maps with chokepoints. |
| Not enough players for playtests | Bots fill empty slots; scheduled weekly game nights; recruit from r/RealTimeStrategy and r/WebGames. |
| Too close to Age of Empires | Original names, factions, art and UI; no AoE assets, sounds or terms like "Feudal/Castle/Imperial Age". (The PRD's age names are AoE II's; use our own.) |
| Name conflict | Do a quick trademark/Steam/itch search for "Kingdoms of Eternity" before investing in branding. |
| Scope creep | Anything not in §3 goes to `docs/backlog.md`, not into the current milestone. |
| Burnout (solo) | Gates give visible wins; ship playable builds to friends early (M1), not at the end. |

---

## 12. Decisions needed from you

1. **Familiar stack:** are you comfortable with TypeScript + Node + Phaser? *(If not, what do you know best?)*
2. **Hours per week:** this plan assumes 15–20. Adjust the estimates if it's different.
3. **Victory condition:** destroy all Town Centers, or all buildings?
4. **Age names and the two starting civilizations:** the first piece of the original world to define.
5. **Repo visibility:** public (unlimited free CI, devlog credibility) or private?
