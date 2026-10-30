import { GAIA, TILE, sightOf } from "./defs";
import { teamOf, type Entity, type World } from "./world";

const offsetsByRadius = new Map<number, Int16Array>();

/** (dx, dy) pairs of every tile within `r` tiles of the center. */
function circle(r: number): Int16Array {
  let offsets = offsetsByRadius.get(r);
  if (!offsets) {
    const list: number[] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r) list.push(dx, dy);
    offsetsByRadius.set(r, (offsets = Int16Array.from(list)));
  }
  return offsets;
}

/** Marks tiles seen by `viewers` into `out` (1 = visible now). */
export function markVision(world: World, viewers: Iterable<Entity>, out: Uint8Array): Uint8Array {
  for (const e of viewers) {
    const r = sightOf(e.type) + Math.floor(e.size / 2);
    if (r === 0) continue;
    const cx = Math.floor(e.x / TILE), cy = Math.floor(e.y / TILE);
    const offsets = circle(r);
    for (let i = 0; i < offsets.length; i += 2) {
      const x = cx + offsets[i]!, y = cy + offsets[i + 1]!;
      if (x >= 0 && y >= 0 && x < world.cols && y < world.rows) out[y * world.cols + x] = 1;
    }
  }
  return out;
}

/** Tiles currently visible to `slot`'s team (allies share vision). */
export function visibleTiles(world: World, slot: number): Uint8Array {
  const team = teamOf(world, slot);
  const viewers = [...world.entities.values()].filter((e) => e.owner !== GAIA && teamOf(world, e.owner) === team);
  return markVision(world, viewers, new Uint8Array(world.cols * world.rows));
}

/**
 * Everything `slot` is allowed to know about: its team's entities, all
 * resource nodes (terrain features), and enemies standing in visible tiles.
 * The server only ever sends this set, so hidden units can't leak to a client.
 */
export function entitiesVisibleTo(world: World, slot: number): Entity[] {
  const team = teamOf(world, slot);
  const visible = visibleTiles(world, slot);
  const out: Entity[] = [];
  for (const e of world.entities.values()) {
    if (e.owner === GAIA || teamOf(world, e.owner) === team) {
      out.push(e);
      continue;
    }
    const seen = e.size > 0 ? footprintVisible(world, e, visible) : visible[Math.floor(e.y / TILE) * world.cols + Math.floor(e.x / TILE)] === 1;
    if (seen) out.push(e);
  }
  return out;
}

function footprintVisible(world: World, e: Entity, visible: Uint8Array): boolean {
  for (let y = e.ty; y < e.ty + e.size; y++) for (let x = e.tx; x < e.tx + e.size; x++) if (visible[y * world.cols + x]) return true;
  return false;
}
