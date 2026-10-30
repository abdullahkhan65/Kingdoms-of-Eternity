import { randomInt } from "./rng";

/** World units per tile. All positions are integers in world units. */
export const TILE = 64;
export const TICK_RATE = 20;
export const UNIT_RADIUS = 16;

export interface Unit {
  id: number;
  owner: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  /** World units per tick. */
  speed: number;
  moving: boolean;
}

export interface World {
  tick: number;
  rng: number;
  /** Map size in world units. */
  width: number;
  height: number;
  /** Insertion order is id order; systems iterate in this order for determinism. */
  units: Map<number, Unit>;
  nextId: number;
}

export interface WorldOptions {
  seed: number;
  widthTiles: number;
  heightTiles: number;
}

export function createWorld({ seed, widthTiles, heightTiles }: WorldOptions): World {
  return {
    tick: 0,
    rng: seed | 0,
    width: widthTiles * TILE,
    height: heightTiles * TILE,
    units: new Map(),
    nextId: 1,
  };
}

export function spawnUnit(world: World, owner: number, x: number, y: number, speed = 3): Unit {
  const unit: Unit = { id: world.nextId++, owner, x, y, tx: x, ty: y, speed, moving: false };
  world.units.set(unit.id, unit);
  return unit;
}

/** 8 start slots on a ring, as fractions of map size (x1000). A table, not Math.cos, so it's engine-independent. */
const START_SLOTS: ReadonlyArray<readonly [number, number]> = [
  [850, 500], [747, 747], [500, 850], [253, 747],
  [150, 500], [253, 253], [500, 150], [747, 253],
];

/** Spawns `count` units for `owner` clustered around one of 8 start slots. */
export function spawnPlayerStart(world: World, owner: number, count: number): Unit[] {
  const [sx, sy] = START_SLOTS[owner % START_SLOTS.length]!;
  const cx = Math.trunc((world.width * sx) / 1000);
  const cy = Math.trunc((world.height * sy) / 1000);
  const spread = TILE * 4;
  const units: Unit[] = [];
  for (let i = 0; i < count; i++) {
    units.push(spawnUnit(world, owner, cx + randomInt(world, -spread, spread), cy + randomInt(world, -spread, spread)));
  }
  return units;
}

/** Removes every unit owned by `owner` (player left the match). Returns the removed ids. */
export function removePlayerUnits(world: World, owner: number): number[] {
  const removed: number[] = [];
  for (const u of world.units.values()) {
    if (u.owner === owner) removed.push(u.id);
  }
  for (const id of removed) world.units.delete(id);
  return removed;
}

export function clampX(world: World, x: number): number {
  return Math.min(world.width - 1, Math.max(0, x));
}

export function clampY(world: World, y: number): number {
  return Math.min(world.height - 1, Math.max(0, y));
}

/** FNV-1a over the authoritative state. Equal hashes mean identical worlds; used by replay tests. */
export function hashWorld(world: World): number {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h ^= n;
    h = Math.imul(h, 0x01000193);
  };
  mix(world.tick);
  mix(world.rng);
  for (const u of world.units.values()) {
    mix(u.id);
    mix(u.owner);
    mix(u.x);
    mix(u.y);
    mix(u.tx);
    mix(u.ty);
  }
  return h >>> 0;
}
