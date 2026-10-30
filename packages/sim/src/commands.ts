import { BUILD_MENU, BUILDINGS, GAIA, MAX_QUEUE, NODES, RESOURCES, T, TECH_AGE2, TILE, UNITS, costOf, type Cost } from "./defs";
import { canPlace, clampX, clampY, isEnemy, placeBuilding, removeEntity, tileOf, type Entity, type Order, type PlayerState, type World } from "./world";
import { nearestWalkable } from "./path";

export const MAX_UNITS_PER_COMMAND = 200;
const FORMATION_SPACING = TILE * 0.6;

export type Command =
  | { type: "move"; ids: number[]; x: number; y: number }
  | { type: "attackMove"; ids: number[]; x: number; y: number }
  /** Right-click on an entity: gather, build, attack or follow, decided per unit by the server. */
  | { type: "interact"; ids: number[]; target: number }
  | { type: "build"; ids: number[]; building: number; tx: number; ty: number }
  | { type: "train"; building: number; unit: number }
  | { type: "research"; building: number; tech: number }
  | { type: "cancel"; building: number; index: number }
  | { type: "rally"; building: number; x: number; y: number }
  | { type: "stop"; ids: number[] }
  | { type: "delete"; id: number }
  | { type: "resign" };

export type CommandResult = { ok: true } | { ok: false; reason: string };

const OK: CommandResult = { ok: true };
const reject = (reason: string): CommandResult => ({ ok: false, reason });
const isInt = (v: unknown): v is number => Number.isInteger(v);

/**
 * Validates an untrusted payload from the network and applies it for `slot`.
 * Anything malformed, out of range, unaffordable or not owned by `slot` is
 * rejected; the world is only mutated when the result is ok.
 */
export function applyCommand(world: World, slot: number, raw: unknown): CommandResult {
  if (typeof raw !== "object" || raw === null) return reject("not an object");
  const player = world.players[slot];
  if (!player || player.defeated || world.winnerTeam !== null) return reject("player not active");
  const cmd = raw as Record<string, unknown>;

  switch (cmd.type) {
    case "move":
    case "attackMove": {
      const units = ownedUnits(world, slot, cmd.ids);
      if (typeof units === "string") return reject(units);
      if (!isInt(cmd.x) || !isInt(cmd.y)) return reject("target must be integers");
      const kind = cmd.type;
      formation(world, units, cmd.x, cmd.y, (u, x, y) => setOrder(u, { k: kind, x, y }));
      return OK;
    }
    case "interact": {
      const units = ownedUnits(world, slot, cmd.ids);
      if (typeof units === "string") return reject(units);
      const target = isInt(cmd.target) ? world.entities.get(cmd.target) : undefined;
      if (!target) return reject("unknown target");
      for (const u of units) interact(world, u, target);
      return OK;
    }
    case "stop": {
      const units = ownedUnits(world, slot, cmd.ids);
      if (typeof units === "string") return reject(units);
      for (const u of units) setOrder(u, { k: "idle" });
      return OK;
    }
    case "build":
      return build(world, player, cmd);
    case "train":
    case "research":
      return enqueue(world, player, cmd);
    case "cancel": {
      const b = ownedBuilding(world, slot, cmd.building);
      if (!b || !isInt(cmd.index) || cmd.index < 0 || cmd.index >= b.queue.length) return reject("nothing to cancel");
      const [item] = b.queue.splice(cmd.index, 1);
      refund(player, costOf(item!));
      if (cmd.index === 0) b.queueProgress = 0;
      return OK;
    }
    case "rally": {
      const b = ownedBuilding(world, slot, cmd.building);
      if (!b || !isInt(cmd.x) || !isInt(cmd.y)) return reject("bad rally");
      b.rally = { x: clampX(world, cmd.x), y: clampY(world, cmd.y) };
      return OK;
    }
    case "delete": {
      const e = isInt(cmd.id) ? world.entities.get(cmd.id) : undefined;
      if (!e || e.owner !== slot) return reject("not yours");
      removeEntity(world, e);
      return OK;
    }
    case "resign":
      player.defeated = true;
      return OK;
    default:
      return reject("unknown command type");
  }
}

export function setOrder(u: Entity, order: Order): void {
  u.order = order;
  u.path = [];
  u.pathTick = -1; // "no route planned yet for this order"
  u.workTimer = 0;
}

/** What a unit does when right-clicked onto `target`. */
function interact(world: World, u: Entity, target: Entity): void {
  const villager = u.type === T.Villager;
  if (target.owner === GAIA && NODES[target.type]) {
    if (villager) setOrder(u, { k: "gather", target: target.id, res: NODES[target.type]!.res });
    else setOrder(u, { k: "move", x: target.x, y: target.y });
  } else if (isEnemy(world, u.owner, target.owner)) {
    setOrder(u, { k: "attack", target: target.id, resume: null });
  } else if (villager && BUILDINGS[target.type] && !target.done && !isEnemy(world, u.owner, target.owner)) {
    setOrder(u, { k: "build", target: target.id });
  } else if (villager && target.type === T.Farm && target.owner === u.owner) {
    setOrder(u, { k: "gather", target: target.id, res: "food" });
  } else if (villager && u.carryAmt > 0 && target.owner === u.owner && BUILDINGS[target.type]?.dropoff && target.done) {
    // Drop off and then go back to whatever they were carrying.
    setOrder(u, { k: "gather", target: -1, res: u.carryRes! });
  } else {
    setOrder(u, { k: "move", x: target.x, y: target.y });
  }
}

function build(world: World, player: PlayerState, cmd: Record<string, unknown>): CommandResult {
  const type = cmd.building;
  if (!isInt(type) || !BUILD_MENU.includes(type as never)) return reject("unknown building");
  const def = BUILDINGS[type]!;
  if (def.age > player.age) return reject("requires a later age");
  if (!isInt(cmd.tx) || !isInt(cmd.ty)) return reject("bad tile");
  const units = ownedUnits(world, player.slot, cmd.ids);
  if (typeof units === "string") return reject(units);
  const builders = units.filter((u) => u.type === T.Villager);
  if (builders.length === 0) return reject("only villagers build");
  if (!canPlace(world, type, cmd.tx, cmd.ty)) return reject("can't build there");
  if (!canAfford(player, def.cost)) return reject("not enough resources");

  pay(player, def.cost);
  const placeTx = cmd.tx, placeTy = cmd.ty;
  const site = placeBuilding(world, player.slot, type, placeTx, placeTy, false);
  // Anyone standing on the new footprint steps aside.
  for (const e of world.entities.values()) {
    if (!UNITS[e.type] || def.walkable) continue;
    const tx = tileOf(e.x), ty = tileOf(e.y);
    if (tx >= placeTx && tx < placeTx + def.size && ty >= placeTy && ty < placeTy + def.size) {
      const free = nearestWalkable(world, tx, ty, def.size + 2);
      if (free) {
        e.x = free[0] * TILE + TILE / 2;
        e.y = free[1] * TILE + TILE / 2;
        e.path = [];
      }
    }
  }
  for (const u of builders) setOrder(u, { k: "build", target: site.id });
  return OK;
}

function enqueue(world: World, player: PlayerState, cmd: Record<string, unknown>): CommandResult {
  const b = ownedBuilding(world, player.slot, cmd.building);
  if (!b || !b.done) return reject("no such finished building");
  if (b.queue.length >= MAX_QUEUE) return reject("queue full");
  let item: number;
  if (cmd.type === "research") {
    if (cmd.tech !== TECH_AGE2 || b.type !== T.TownCenter) return reject("unknown research");
    if (player.age >= 2) return reject("already researched");
    for (const e of world.entities.values()) if (e.owner === player.slot && e.queue.includes(TECH_AGE2)) return reject("already researching");
    item = TECH_AGE2;
  } else {
    const unit = cmd.unit;
    if (!isInt(unit) || !BUILDINGS[b.type]!.trains.includes(unit)) return reject("can't train that here");
    if (UNITS[unit]!.age > player.age) return reject("requires a later age");
    item = unit;
  }
  const cost = costOf(item);
  if (!canAfford(player, cost)) return reject("not enough resources");
  pay(player, cost);
  b.queue.push(item);
  return OK;
}

function ownedUnits(world: World, slot: number, ids: unknown): Entity[] | string {
  if (!Array.isArray(ids) || ids.length === 0) return "ids must be a non-empty array";
  if (ids.length > MAX_UNITS_PER_COMMAND) return "too many units";
  const out: Entity[] = [];
  for (const id of ids) {
    const e = isInt(id) ? world.entities.get(id) : undefined;
    if (!e) return "unknown unit";
    if (e.owner !== slot) return "unit not owned by player";
    if (!UNITS[e.type]) return "not a unit";
    out.push(e);
  }
  return out;
}

function ownedBuilding(world: World, slot: number, id: unknown): Entity | undefined {
  const e = isInt(id) ? world.entities.get(id) : undefined;
  return e && e.owner === slot && BUILDINGS[e.type] ? e : undefined;
}

/** Square formation centered on the target so a group doesn't pile onto one point. */
function formation(world: World, units: Entity[], x: number, y: number, assign: (u: Entity, x: number, y: number) => void): void {
  const cols = Math.ceil(Math.sqrt(units.length));
  const half = ((cols - 1) * FORMATION_SPACING) / 2;
  units.forEach((u, i) => {
    assign(u, clampX(world, Math.trunc(x - half + (i % cols) * FORMATION_SPACING)), clampY(world, Math.trunc(y - half + Math.floor(i / cols) * FORMATION_SPACING)));
  });
}

export function canAfford(player: PlayerState, cost: Cost): boolean {
  return RESOURCES.every((r) => player[r] >= (cost[r] ?? 0));
}

function pay(player: PlayerState, cost: Cost): void {
  for (const r of RESOURCES) player[r] -= cost[r] ?? 0;
}

function refund(player: PlayerState, cost: Cost): void {
  for (const r of RESOURCES) player[r] += cost[r] ?? 0;
}
