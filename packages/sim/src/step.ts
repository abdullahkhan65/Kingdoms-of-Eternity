import { TILE, UNIT_RADIUS, clampX, clampY, type Unit, type World } from "./world";

const SEPARATION_PUSH = 1;
const MIN_DIST = UNIT_RADIUS * 2;

/** Advances the world by one tick. Commands must already be applied for this tick. */
export function step(world: World): void {
  moveUnits(world);
  separateUnits(world);
  world.tick++;
}

function moveUnits(world: World): void {
  for (const u of world.units.values()) {
    if (!u.moving) continue;
    const dx = u.tx - u.x;
    const dy = u.ty - u.y;
    // Math.sqrt is correctly rounded by IEEE 754, so this stays deterministic across engines.
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= u.speed) {
      u.x = u.tx;
      u.y = u.ty;
      u.moving = false;
    } else {
      u.x += Math.trunc((dx * u.speed) / dist);
      u.y += Math.trunc((dy * u.speed) / dist);
    }
  }
}

/**
 * Pushes overlapping units apart using a one-tile spatial hash. This is also
 * the neighbor query that combat target-finding will reuse.
 */
function separateUnits(world: World): void {
  const cols = Math.ceil(world.width / TILE);
  const buckets = new Map<number, Unit[]>();
  for (const u of world.units.values()) {
    const key = Math.floor(u.y / TILE) * cols + Math.floor(u.x / TILE);
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, (bucket = []));
    bucket.push(u);
  }

  for (const u of world.units.values()) {
    const cx = Math.floor(u.x / TILE);
    const cy = Math.floor(u.y / TILE);
    let pushX = 0;
    let pushY = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const bucket = buckets.get((cy + oy) * cols + (cx + ox));
        if (!bucket) continue;
        for (const other of bucket) {
          if (other === u) continue;
          const dx = u.x - other.x;
          const dy = u.y - other.y;
          if (dx * dx + dy * dy >= MIN_DIST * MIN_DIST) continue;
          // Exact overlap: break the tie by id so the result doesn't depend on iteration luck.
          pushX += Math.sign(dx) || (u.id < other.id ? -1 : 1);
          pushY += Math.sign(dy);
        }
      }
    }
    u.x = clampX(world, u.x + Math.sign(pushX) * SEPARATION_PUSH);
    u.y = clampY(world, u.y + Math.sign(pushY) * SEPARATION_PUSH);
  }
}
