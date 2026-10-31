# Kingdoms of Eternity

Browser RTS, up to 8 players, authoritative server. Read `PLAN.md` for scope and milestones; `requirement-doc.md` is the original PRD (superseded where PLAN.md differs).

## Layout

- `packages/sim`: all game rules. Pure TypeScript, no dependencies. `defs.ts` holds every tunable number; `step.ts` the per-tick systems; `ai.ts` the computer opponent.
- `packages/protocol`: wire formats and message names shared by server and clients.
- `packages/server`: Colyseus rooms. Runs the sim, validates commands, sends snapshots.
- `packages/bot`: headless network player, load test (`npm run spike`) and civ balance check (`npm run balance`).
- `packages/client`: Phaser 4 renderer + HTML HUD. Renders interpolated snapshots, sends commands. No game rules. All art is painted in code (`art.ts` sprites, `terrain.ts` ground, `fx.ts` effects); there are no image files.

## Commands

- `npm test`: Vitest, all packages
- `npm run typecheck`
- `npm run server`: dev server on :2567
- `npm run client`: Vite dev client on :5173 (connects to :2567; `?server=ws://host:port` overrides)
- `npm run smoke`: two-player browser test (real server + client via Playwright)
- `npm run look [-- <dir>]`: screenshots of the art in a live match (base, gallery of every sprite, villagers working, a fight) for eyeballing changes
- `npm run spike [-- --units 75 --seconds 60 --endpoint ws://host:2567 --write]`: 8-player load test
- `npm run balance`: bot-vs-bot matches across seeds with civs swapped
- `npm run deploy`: rsync to the Oracle VM, build, restart the `koe` systemd service (serves game + page on :2567)

## Rules

1. Game logic lives only in `sim`. Server runs it; the client renders and interpolates, never decides outcomes.
2. `sim` is deterministic: integer positions, seeded RNG (`rng.ts`), no `Math.random`, `Date.now`, `Math.sin/cos` or iteration over unordered keys.
3. Every client message is untrusted: validate shape, range and ownership in `sim` (see `applyCommand`) and test the rejection.
4. A feature is done when its tests pass and its milestone gate in PLAN.md is met, not before.
5. Small, reviewable changes. No new dependency without a line in `docs/decisions.md`.
6. Anything outside the current milestone goes in `docs/backlog.md`.
7. Wire format changes bump `SNAPSHOT_VERSION`.
