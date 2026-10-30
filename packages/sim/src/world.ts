import { BUILDINGS, GAIA, MAX_POP, NODES, START_RESOURCES, TILE, UNITS, isBuilding, isNode, type Res } from "./defs";

/** Default unit radius, for code that doesn't care about the unit type. */
export const UNIT_RADIUS = 16;

export const Terrain = { Grass: 0, Water: 1 } as const;

export interface Point {
  x: number;
  y: number;
}

export type Order =
  | { k: "idle" }
  | { k: "move"; x: number; y: number }
  | { k: "attackMove"; x: number; y: number }
  | { k: "gather"; target: number; res: Res }
  | { k: "build"; target: number }
  | { k: "attack"; target: number; resume: Point | null };

/** One struct for units, buildings and resource nodes; unused fields stay at their defaults. */
export interface Entity {
  id: number;
  type: number;
  owner: number;
  /** Center, in world units. Buildings and nodes sit on tile-aligned footprints. */
  x: number;
  y: number;
  hp: number;

  // Units
  order: Order;
  path: Point[];
  /** Tick the current path was computed (for re-pathing towards moving targets). */
  pathTick: number;
  carryRes: Res | null;
  carryAmt: number;
  cooldown: number;
  workTimer: number;
  /** Ticks left in the "just attacked" flag the client uses for a hit flash. */
  attackFlash: number;

  // Buildings
  /** Footprint top-left tile and size (buildings and nodes). */
  tx: number;
  ty: number;
  size: number;
  done: boolean;
  buildProgress: number;
  queue: number[];
  queueProgress: number;
  rally: Point | null;

  // Resource nodes and farms
  amount: number;
}

export interface PlayerState {
  slot: number;
  /** 0 = no team (free-for-all). */
  team: number;
  civ: number;
  food: number;
  wood: number;
  gold: number;
  age: 1 | 2;
  /** Set once the player has owned a Town Center; losing the last one after that is defeat. */
  hadTownCenter: boolean;
  defeated: boolean;
}

export interface World {
  tick: number;
  rng: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
  terrain: Uint8Array;
  /** Count of blocking things per tile (water counts once). 0 = walkable. */
  blocked: Uint8Array;
  entities: Map<number, Entity>;
  nextId: number;
  players: PlayerState[];
  /** Team id of the winners once the match is over. */
  winnerTeam: number | null;
  /** Route searches left this tick; units over budget wait a tick (keeps tick time flat). */
  pathBudget: number;
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
    cols: widthTiles,
    rows: heightTiles,
    width: widthTiles * TILE,
    height: heightTiles * TILE,
    terrain: new Uint8Array(widthTiles * heightTiles),
    blocked: new Uint8Array(widthTiles * heightTiles),
    entities: new Map(),
    nextId: 1,
    players: [],
    winnerTeam: null,
    pathBudget: 0,
  };
}

export function addPlayer(world: World, slot: number, team = 0, civ = 0): PlayerState {
  const p: PlayerState = { slot, team, civ, ...START_RESOURCES, age: 1, hadTownCenter: false, defeated: false };
  world.players[slot] = p;
  return p;
}

/** Effective team: players without a team are each on their own. */
export function teamOf(world: World, slot: number): number {
  if (slot === GAIA) return -1;
  const team = world.players[slot]?.team ?? 0;
  return team === 0 ? 1000 + slot : team;
}

export function isEnemy(world: World, a: number, b: number): boolean {
  return a !== GAIA && b !== GAIA && teamOf(world, a) !== teamOf(world, b);
}

function baseEntity(world: World, type: number, owner: number, x: number, y: number, hp: number): Entity {
  return {
    id: world.nextId++, type, owner, x, y, hp,
    order: { k: "idle" }, path: [], pathTick: 0, carryRes: null, carryAmt: 0, cooldown: 0, workTimer: 0, attackFlash: 0,
    tx: 0, ty: 0, size: 0, done: true, buildProgress: 0, queue: [], queueProgress: 0, rally: null,
    amount: 0,
  };
}

export function spawnUnit(world: World, owner: number, x: number, y: number, type: number = 1): Entity {
  const def = UNITS[type]!;
  const e = baseEntity(world, type, owner, Math.round(x), Math.round(y), def.hp);
  world.entities.set(e.id, e);
  return e;
}

/** Places a building (or foundation, when `done` is false) on a tile footprint. Caller checks the footprint is free. */
export function placeBuilding(world: World, owner: number, type: number, tx: number, ty: number, done: boolean): Entity {
  const def = BUILDINGS[type]!;
  const e = baseEntity(world, type, owner, (tx + def.size / 2) * TILE, (ty + def.size / 2) * TILE, done ? def.hp : 1);
  e.tx = tx;
  e.ty = ty;
  e.size = def.size;
  e.done = done;
  world.entities.set(e.id, e);
  if (!def.walkable) setBlocked(world, e, 1);
  return e;
}

export function placeNode(world: World, type: number, tx: number, ty: number): Entity {
  const e = baseEntity(world, type, GAIA, (tx + 0.5) * TILE, (ty + 0.5) * TILE, 1);
  e.tx = tx;
  e.ty = ty;
  e.size = 1;
  e.amount = NODES[type]!.amount;
  world.entities.set(e.id, e);
  setBlocked(world, e, 1);
  return e;
}

/** Removes an entity and frees its footprint. */
export function removeEntity(world: World, e: Entity): void {
  if (!world.entities.delete(e.id)) return;
  if (isNode(e.type) || (isBuilding(e.type) && !BUILDINGS[e.type]!.walkable)) setBlocked(world, e, -1);
}

function setBlocked(world: World, e: Entity, delta: 1 | -1): void {
  for (let y = e.ty; y < e.ty + e.size; y++) {
    for (let x = e.tx; x < e.tx + e.size; x++) world.blocked[y * world.cols + x]! += delta;
  }
}

/** Removes every entity owned by `owner` (player left or was defeated). Returns the removed ids. */
export function removePlayerUnits(world: World, owner: number): number[] {
  const doomed = [...world.entities.values()].filter((e) => e.owner === owner);
  for (const e of doomed) removeEntity(world, e);
  return doomed.map((e) => e.id);
}

export const tileOf = (v: number) => Math.floor(v / TILE);
export const inBounds = (world: World, tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < world.cols && ty < world.rows;
export const isWalkable = (world: World, tx: number, ty: number) => inBounds(world, tx, ty) && world.blocked[ty * world.cols + tx] === 0;

export function clampX(world: World, x: number): number {
  return Math.min(world.width - 1, Math.max(0, x));
}

export function clampY(world: World, y: number): number {
  return Math.min(world.height - 1, Math.max(0, y));
}

/** Can a building of `type` go at tile (tx, ty)? */
export function canPlace(world: World, type: number, tx: number, ty: number): boolean {
  const size = BUILDINGS[type]?.size ?? 0;
  if (size === 0) return false;
  for (let y = ty; y < ty + size; y++) {
    for (let x = tx; x < tx + size; x++) {
      if (!isWalkable(world, x, y) || world.terrain[y * world.cols + x] !== Terrain.Grass) return false;
      // Farms are walkable, so they don't mark `blocked`; don't let anything overlap them either.
      for (const e of world.entities.values()) {
        if (e.size > 0 && x >= e.tx && x < e.tx + e.size && y >= e.ty && y < e.ty + e.size) return false;
      }
    }
  }
  return true;
}

/** Distance from a point to the footprint rectangle of a building/node (0 inside). */
export function distToFootprint(e: Entity, x: number, y: number): number {
  const x0 = e.tx * TILE, y0 = e.ty * TILE, x1 = x0 + e.size * TILE, y1 = y0 + e.size * TILE;
  const dx = Math.max(x0 - x, 0, x - x1);
  const dy = Math.max(y0 - y, 0, y - y1);
  return Math.sqrt(dx * dx + dy * dy);
}

/** Edge-to-edge distance between a unit and any entity. */
export function gapBetween(unit: Entity, target: Entity): number {
  // Units path to the center of a tile next to a footprint, so standing anywhere
  // on an adjacent tile counts as touching it.
  if (target.size > 0) return Math.max(0, distToFootprint(target, unit.x, unit.y) - TILE / 2);
  const r = UNITS[unit.type]?.radius ?? UNIT_RADIUS;
  const tr = UNITS[target.type]?.radius ?? UNIT_RADIUS;
  return Math.max(0, Math.sqrt((unit.x - target.x) ** 2 + (unit.y - target.y) ** 2) - r - tr);
}

export function population(world: World, slot: number): { pop: number; cap: number } {
  let pop = 0;
  let cap = 0;
  for (const e of world.entities.values()) {
    if (e.owner !== slot) continue;
    if (UNITS[e.type]) pop++;
    else if (e.done) cap += BUILDINGS[e.type]?.pop ?? 0;
  }
  return { pop, cap: Math.min(cap, MAX_POP) };
}

/** FNV-1a over the authoritative state. Equal hashes mean identical worlds; used by replay tests. */
export function hashWorld(world: World): number {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h ^= n | 0;
    h = Math.imul(h, 0x01000193);
  };
  mix(world.tick);
  mix(world.rng);
  for (const e of world.entities.values()) {
    mix(e.id); mix(e.type); mix(e.owner); mix(e.x); mix(e.y); mix(e.hp); mix(e.amount); mix(e.carryAmt);
  }
  for (const p of world.players) if (p) { mix(p.food); mix(p.wood); mix(p.gold); mix(p.age); }
  return h >>> 0;
}
