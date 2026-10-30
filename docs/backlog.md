# Backlog

Things noticed but deliberately not done yet. Newest context first.

## Before inviting strangers (public beta)
- https/wss: the playtest URL is plain http (http://89.168.127.10:2567). Fine for friends; a public page (itch.io / Cloudflare Pages are https) needs TLS on the game server: Caddy + sslip.io, or Cloudflare Tunnel.
- Run `npm run smoke` in CI (needs `npx playwright install --with-deps chromium` in the workflow).
- Abuse limits: per-client command rate limit (Colyseus `maxMessagesPerSecond`), room creation limits.
- `npm audit` low/moderate issues in transitive deps (`elliptic`, `uuid`) via Colyseus.
- Client bundle is ~414 KB gzipped (Phaser). Fine on broadband; revisit for mobile data.

## Gameplay (from the first full build)
- Bot reads enemy Town Center positions directly instead of scouting through fog.
- Enemy buildings disappear when they leave vision; classic RTS keeps a "last seen" ghost.
- No projectiles: ranged hits land instantly. Add visible arrows (cosmetic) for readability.
- Units have no facing/animation; buildings have no damage states. Placeholder art throughout (shapes).
- Farms don't limit one villager each.
- Sound: none yet.
- Stone, walls, towers, siege, healers, Stable, Blacksmith, Market, ages III–IV (PLAN §3 "deferred").
- Formations are a simple square; no unit pushing through chokepoints beyond separation.

## Performance
- Extreme load test (8 players × 75 units marching and fighting, 400 orders/s) sits right at budget: 21.3 ms tick p99 + 3.4 ms snapshots on the Oracle VM. Real matches are far lighter. Next levers: cache per-team vision, flow fields for group moves, shorter path smoothing.
- Unit ids are u16 on the wire (encoder throws past 65,535). Fine for a match; recycle ids if matches ever get that long.

## Latency
- Pakistan → Frankfurt is ~210 ms round trip. Orders get instant cosmetic feedback; units start moving ~0.3 s after a click. If most players are in South Asia / the Gulf, consider a paid VPS nearer them once demand is proven.

## Server ops
- Oracle may reclaim idle Always Free VMs (very low CPU for 7 days). Watch for the warning email.
- Rooms live in one process; a deploy restarts the service and ends running matches. Deploy between playtests.
