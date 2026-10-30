import {
  AGE2_TIME, AURELIAN_CARRY_BONUS, BUILDINGS, CARRY_CAPACITY, FARM_FOOD, FARM_GATHER_TICKS, GAIA, NODES, T, TECH_AGE2, TILE, UNITS, isBuilding,
  type Res, type UnitDef,
} from "./defs";
import { findPath, lineOfWalk, nearestWalkable, pathToFootprint } from "./path";
import {
  gapBetween, isEnemy, isWalkable, population, removeEntity, removePlayerUnits, spawnUnit, teamOf, tileOf,
  type Entity, type PlayerState, type Point, type World,
} from "./world";
import { setOrder } from "./commands";

/** Reach for melee hits, gathering and building: a little slack beyond touching. */
const WORK_REACH = 12;
const CELL = TILE * 4;
const SEPARATION_PUSH = 1;
const RETARGET_EVERY = 5;
const REPATH_EVERY = 10;
/** Route searches per tick. A 25-unit order spreads over a couple of ticks instead of spiking one. */
const PATHS_PER_TICK = 12;

type Grid = Map<number, Entity[]>;

/** Advances the world by one tick. Commands must already be applied for this tick. */
export function step(world: World): void {
  if (world.winnerTeam !== null) {
    world.tick++;
    return;
  }
  world.pathBudget = PATHS_PER_TICK;
  const grid = buildGrid(world);
  const pops = new Map<number, { pop: number; cap: number }>();
  const popOf = (slot: number) => {
    let p = pops.get(slot);
    if (!p) pops.set(slot, (p = population(world, slot)));
    return p;
  };

  for (const e of [...world.entities.values()]) {
    if (!world.entities.has(e.id)) continue; // removed earlier this tick
    if (UNITS[e.type]) updateUnit(world, grid, e);
    else if (BUILDINGS[e.type]) updateBuilding(world, grid, e, popOf);
  }
  separateUnits(world);
  for (const e of [...world.entities.values()]) if (e.hp <= 0 && !NODES[e.type]) removeEntity(world, e);
  if (world.tick % 20 === 0) checkVictory(world);
  world.tick++;
}

// ---------------------------------------------------------------- units

function updateUnit(world: World, grid: Grid, u: Entity): void {
  const def = UNITS[u.type]!;
  if (u.cooldown > 0) u.cooldown--;
  if (u.attackFlash > 0) u.attackFlash--;
  const order = u.order;

  switch (order.k) {
    case "idle":
      if (u.type !== T.Villager && (world.tick + u.id) % RETARGET_EVERY === 0) {
        const enemy = nearestEnemy(world, grid, u, def.sight * TILE);
        if (enemy) setOrder(u, { k: "attack", target: enemy.id, resume: null });
      }
      return;
    case "move":
      if (moveTo(world, u, order.x, order.y)) setOrder(u, { k: "idle" });
      return;
    case "attackMove": {
      if ((world.tick + u.id) % RETARGET_EVERY === 0) {
        const enemy = nearestEnemy(world, grid, u, def.sight * TILE);
        if (enemy) {
          setOrder(u, { k: "attack", target: enemy.id, resume: { x: order.x, y: order.y } });
          return;
        }
      }
      if (moveTo(world, u, order.x, order.y)) setOrder(u, { k: "idle" });
      return;
    }
    case "attack": {
      const target = world.entities.get(order.target);
      if (!target || target.hp <= 0) {
        setOrder(u, order.resume ? { k: "attackMove", ...order.resume } : { k: "idle" });
        return;
      }
      if (gapBetween(u, target) <= def.range) {
        u.path = [];
        if (u.cooldown === 0) {
          hit(world, def, target);
          u.cooldown = def.cooldown;
          u.attackFlash = 4;
        }
      } else {
        approach(world, u, target);
      }
      return;
    }
    case "gather":
      gather(world, u, order.target, order.res);
      return;
    case "build": {
      const site = world.entities.get(order.target);
      if (!site || site.done) {
        if (site?.type === T.Farm && site.owner === u.owner) setOrder(u, { k: "gather", target: site.id, res: "food" });
        else setOrder(u, { k: "idle" });
        return;
      }
      if (gapBetween(u, site) <= WORK_REACH) {
        u.path = [];
        construct(site);
      } else {
        approach(world, u, site);
      }
      return;
    }
  }
}

function construct(site: Entity): void {
  const def = BUILDINGS[site.type]!;
  const before = Math.floor((site.buildProgress * def.hp) / def.buildTime);
  site.buildProgress++;
  site.hp += Math.floor((site.buildProgress * def.hp) / def.buildTime) - before;
  if (site.buildProgress >= def.buildTime) {
    site.done = true;
    site.hp = Math.max(1, Math.min(def.hp, site.hp));
    if (site.type === T.Farm) site.amount = FARM_FOOD;
  }
}

function gather(world: World, u: Entity, targetId: number, res: Res): void {
  const capacity = world.players[u.owner]?.civ === 0 ? CARRY_CAPACITY + AURELIAN_CARRY_BONUS : CARRY_CAPACITY;
  const node = world.entities.get(targetId);
  const nodeOk = node && node.amount > 0 && (node.type !== T.Farm || node.done);

  // Full, or nothing left to gather here: take what we carry home first.
  if (u.carryAmt >= capacity || (!nodeOk && u.carryAmt > 0)) {
    const drop = nearestDropoff(world, u);
    if (!drop) return setOrder(u, { k: "idle" });
    if (gapBetween(u, drop) <= WORK_REACH) {
      world.players[u.owner]![u.carryRes!] += u.carryAmt;
      u.carryAmt = 0;
      u.path = [];
      u.pathTick = -1;
    } else {
      approach(world, u, drop);
    }
    return;
  }

  if (!nodeOk) {
    const next = nearestNode(world, u, res);
    if (next) setOrder(u, { k: "gather", target: next.id, res });
    else setOrder(u, { k: "idle" });
    return;
  }

  if (u.carryRes !== res) {
    u.carryRes = res;
    u.carryAmt = 0;
  }
  if (gapBetween(u, node) <= WORK_REACH) {
    u.path = [];
    const ticks = node.type === T.Farm ? FARM_GATHER_TICKS : NODES[node.type]!.gatherTicks;
    if (++u.workTimer >= ticks) {
      u.workTimer = 0;
      node.amount--;
      u.carryAmt++;
      if (node.amount <= 0) removeEntity(world, node);
    }
  } else {
    approach(world, u, node);
  }
}

function nearestDropoff(world: World, u: Entity): Entity | null {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of world.entities.values()) {
    if (e.owner !== u.owner || !e.done || !BUILDINGS[e.type]?.dropoff) continue;
    const d = (e.x - u.x) ** 2 + (e.y - u.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** Closest resource of the same kind within 12 tiles (farms are never picked automatically). */
function nearestNode(world: World, u: Entity, res: Res): Entity | null {
  let best: Entity | null = null;
  let bestD = (12 * TILE) ** 2;
  for (const e of world.entities.values()) {
    if (e.owner !== GAIA || NODES[e.type]?.res !== res || e.amount <= 0) continue;
    const d = (e.x - u.x) ** 2 + (e.y - u.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

function hit(world: World, def: UnitDef | { attack: number; bonus?: UnitDef["bonus"] }, target: Entity): void {
  const cls = isBuilding(target.type) ? "building" : UNITS[target.type]!.cls;
  const armor = UNITS[target.type]?.armor ?? BUILDINGS[target.type]?.armor ?? 0;
  target.hp -= Math.max(1, def.attack + (def.bonus?.[cls] ?? 0) - armor);
}

// ---------------------------------------------------------------- movement

/** Walks towards (x, y). Returns true on arrival (or when there's no way to get closer). */
function moveTo(world: World, u: Entity, x: number, y: number): boolean {
  if (u.path.length === 0) {
    if (u.pathTick !== -1) return true; // already walked the planned route
    if (world.pathBudget <= 0) return false; // plan next tick
    world.pathBudget--;
    u.path = findPath(world, u.x, u.y, x, y);
    u.pathTick = world.tick;
    if (u.path.length === 0) return true;
  }
  followPath(u);
  return false;
}

/** Walks towards an entity, re-planning periodically if it's a moving unit. */
function approach(world: World, u: Entity, target: Entity): void {
  const moving = UNITS[target.type] !== undefined;
  const stale = moving && world.tick - u.pathTick >= REPATH_EVERY;
  if (u.path.length === 0 || stale) {
    if (world.pathBudget <= 0) {
      if (u.path.length > 0) followPath(u); // keep walking the old route meanwhile
      return;
    }
    world.pathBudget--;
    if (moving && Math.abs(target.x - u.x) + Math.abs(target.y - u.y) < TILE * 4 && lineOfWalk(world, u, target)) {
      u.path = [{ x: target.x, y: target.y }];
    } else {
      u.path = target.size > 0 ? pathToFootprint(world, u, target) : findPath(world, u.x, u.y, target.x, target.y);
    }
    u.pathTick = world.tick;
    if (u.path.length === 0) return;
  }
  followPath(u);
}

function followPath(u: Entity): void {
  const speed = UNITS[u.type]!.speed;
  const next = u.path[0]!;
  const dx = next.x - u.x;
  const dy = next.y - u.y;
  // Math.sqrt is correctly rounded by IEEE 754, so this stays deterministic across engines.
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= speed) {
    u.x = next.x;
    u.y = next.y;
    u.path.shift();
  } else {
    u.x += Math.trunc((dx * speed) / dist);
    u.y += Math.trunc((dy * speed) / dist);
  }
}

/** Pushes overlapping units apart (never into blocked tiles). */
function separateUnits(world: World): void {
  const buckets = new Map<number, Entity[]>();
  for (const u of world.entities.values()) {
    if (!UNITS[u.type]) continue;
    const key = tileOf(u.y) * world.cols + tileOf(u.x);
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, (bucket = []));
    bucket.push(u);
  }
  for (const bucketList of buckets.values()) {
    for (const u of bucketList) {
      const r = UNITS[u.type]!.radius;
      const cx = tileOf(u.x), cy = tileOf(u.y);
      let pushX = 0, pushY = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          for (const other of buckets.get((cy + oy) * world.cols + (cx + ox)) ?? []) {
            if (other === u) continue;
            const min = r + UNITS[other.type]!.radius;
            const dx = u.x - other.x, dy = u.y - other.y;
            if (dx * dx + dy * dy >= min * min) continue;
            // Exact overlap: break the tie by id so the result doesn't depend on iteration luck.
            pushX += Math.sign(dx) || (u.id < other.id ? -1 : 1);
            pushY += Math.sign(dy);
          }
        }
      }
      const nx = u.x + Math.sign(pushX) * SEPARATION_PUSH;
      const ny = u.y + Math.sign(pushY) * SEPARATION_PUSH;
      if (isWalkable(world, tileOf(nx), tileOf(ny))) {
        u.x = nx;
        u.y = ny;
      }
    }
  }
}

// ---------------------------------------------------------------- buildings

function updateBuilding(world: World, grid: Grid, b: Entity, popOf: (slot: number) => { pop: number; cap: number }): void {
  if (!b.done) return;
  const def = BUILDINGS[b.type]!;

  if (b.queue.length > 0) {
    const item = b.queue[0]!;
    const player = world.players[b.owner]!;
    const time = queueItemTime(player, item);
    if (b.queueProgress < time) b.queueProgress++;
    if (b.queueProgress >= time) {
      if (item === TECH_AGE2) {
        player.age = 2;
        finishQueueItem(b);
      } else {
        const pop = popOf(b.owner);
        if (pop.pop < pop.cap) {
          spawnFrom(world, b, item);
          pop.pop++;
          finishQueueItem(b);
        } // else: housed, wait for a House
      }
    }
  }

  if (def.attack) {
    if (b.cooldown > 0) b.cooldown--;
    if (b.cooldown === 0 && (world.tick + b.id) % RETARGET_EVERY === 0) {
      const enemy = nearestEnemy(world, grid, b, def.attack.range, true);
      if (enemy && Math.sqrt((enemy.x - b.x) ** 2 + (enemy.y - b.y) ** 2) <= def.attack.range + (def.size * TILE) / 2) {
        hit(world, { attack: def.attack.damage }, enemy);
        b.cooldown = def.attack.cooldown;
        b.attackFlash = 4;
      }
    }
    if (b.attackFlash > 0) b.attackFlash--;
  }
}

/** Ticks to train a unit or research a tech, including the Thornmarch training bonus. */
export function queueItemTime(player: PlayerState, item: number): number {
  if (item === TECH_AGE2) return AGE2_TIME;
  const unit = UNITS[item]!;
  return player.civ === 1 && unit.cls !== "villager" ? Math.round(unit.trainTime * 0.75) : unit.trainTime;
}

function finishQueueItem(b: Entity): void {
  b.queue.shift();
  b.queueProgress = 0;
}

function spawnFrom(world: World, b: Entity, type: number): void {
  // First walkable tile on the ring around the footprint, starting from the bottom edge.
  const free = nearestWalkable(world, b.tx + Math.floor(b.size / 2), b.ty + b.size, b.size + 3);
  if (!free) return;
  const u = spawnUnit(world, b.owner, free[0] * TILE + TILE / 2, free[1] * TILE + TILE / 2, type);
  if (b.rally) setOrder(u, { k: "move", x: b.rally.x, y: b.rally.y });
}

// ---------------------------------------------------------------- combat helpers

function buildGrid(world: World): Grid {
  const grid: Grid = new Map();
  const cols = Math.ceil(world.width / CELL);
  for (const e of world.entities.values()) {
    if (e.owner === GAIA) continue;
    const key = Math.floor(e.y / CELL) * cols + Math.floor(e.x / CELL);
    let cell = grid.get(key);
    if (!cell) grid.set(key, (cell = []));
    cell.push(e);
  }
  return grid;
}

/** Nearest enemy within `radius` of `from`, preferring units over buildings. */
function nearestEnemy(world: World, grid: Grid, from: Entity, radius: number, unitsOnly = false): Entity | null {
  const cols = Math.ceil(world.width / CELL);
  const reach = radius + 2 * TILE;
  const x0 = Math.floor((from.x - reach) / CELL), x1 = Math.floor((from.x + reach) / CELL);
  const y0 = Math.floor((from.y - reach) / CELL), y1 = Math.floor((from.y + reach) / CELL);
  let best: Entity | null = null;
  let bestScore = Infinity;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      for (const e of grid.get(cy * cols + cx) ?? []) {
        if (e.hp <= 0 || !isEnemy(world, from.owner, e.owner)) continue;
        const building = e.size > 0;
        if (building && unitsOnly) continue;
        const d = building ? distFootprint(e, from) : Math.sqrt((e.x - from.x) ** 2 + (e.y - from.y) ** 2);
        if (d > radius) continue;
        const score = d + (building ? 3 * TILE : 0);
        if (score < bestScore) {
          bestScore = score;
          best = e;
        }
      }
    }
  }
  return best;
}

function distFootprint(b: Entity, p: Point): number {
  const x0 = b.tx * TILE, y0 = b.ty * TILE, x1 = x0 + b.size * TILE, y1 = y0 + b.size * TILE;
  const dx = Math.max(x0 - p.x, 0, p.x - x1), dy = Math.max(y0 - p.y, 0, p.y - y1);
  return Math.sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------- victory

/** A player who loses their last Town Center (finished or not) is defeated; the last team standing wins. */
function checkVictory(world: World): void {
  const hasTownCenter = new Set<number>();
  for (const e of world.entities.values()) if (e.type === T.TownCenter) hasTownCenter.add(e.owner);
  for (const p of world.players) {
    if (!p || p.defeated) continue;
    if (hasTownCenter.has(p.slot)) p.hadTownCenter = true;
    else if (p.hadTownCenter) p.defeated = true;
  }
  for (const p of world.players) if (p?.defeated) removePlayerUnits(world, p.slot);

  const allTeams = new Set(world.players.filter(Boolean).map((p) => teamOf(world, p.slot)));
  const aliveTeams = new Set(world.players.filter((p) => p && !p.defeated).map((p) => teamOf(world, p.slot)));
  if (allTeams.size >= 2 && aliveTeams.size <= 1) world.winnerTeam = aliveTeams.values().next().value ?? -1;
}
