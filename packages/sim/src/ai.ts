import { BUILDINGS, GAIA, NODES, T, TECH_AGE2, TILE, UNITS, costOf, isBuilding, type Res } from "./defs";
import { applyCommand, canAfford, type Command } from "./commands";
import { canPlace, isEnemy, isWalkable, population, type Entity, type World } from "./world";

/** How often bots think, in ticks. */
export const BOT_INTERVAL = 10;

export interface BotMemory {
  attacking: boolean;
  lastWave: number;
}

export const newBotMemory = (): BotMemory => ({ attacking: false, lastWave: 0 });

/**
 * A simple scripted opponent: boom economy, add houses, barracks, age up,
 * then send waves at the nearest enemy Town Center. It acts only through
 * applyCommand, so it obeys exactly the same rules as a human.
 * (It does read enemy positions directly; fog-respecting scouting is future work.)
 */
export function runBot(world: World, slot: number, memory: BotMemory): void {
  const player = world.players[slot];
  if (!player || player.defeated || world.winnerTeam !== null) return;
  const mine = [...world.entities.values()].filter((e) => e.owner === slot);
  const tc = mine.find((e) => e.type === T.TownCenter && e.done);
  if (!tc) return;
  const send = (cmd: Command) => applyCommand(world, slot, cmd).ok;
  const villagers = mine.filter((e) => e.type === T.Villager);
  const army = mine.filter((e) => UNITS[e.type] && e.type !== T.Villager);
  const has = (type: number) => mine.some((e) => e.type === type);
  const building = (type: number) => mine.filter((e) => e.type === type);
  const { pop, cap } = population(world, slot);
  const minute = world.tick / (20 * 60);

  // --- houses before anything else, so production never stalls
  const housesInProgress = mine.some((e) => e.type === T.House && !e.done);
  if (cap - pop <= 3 && cap < 75 && !housesInProgress && player.wood >= 30) placeNear(world, slot, villagers, T.House, tc.x, tc.y, send);

  // --- villagers
  const villagerTarget = player.age === 1 ? 18 : 28;
  if (villagers.length < villagerTarget && tc.queue.length < 2 && !tc.queue.includes(TECH_AGE2)) send({ type: "train", building: tc.id, unit: T.Villager });

  // --- buildings
  if (villagers.length >= 9 && !has(T.Barracks) && player.wood >= 150) placeNear(world, slot, villagers, T.Barracks, tc.x, tc.y, send);
  if (villagers.length >= 8 && !has(T.Storehouse) && player.wood >= 100) {
    const wood = nearestNodeTo(world, tc.x, tc.y, "wood");
    if (wood && Math.hypot(wood.x - tc.x, wood.y - tc.y) > 7 * TILE) placeNear(world, slot, villagers, T.Storehouse, wood.x, wood.y, send);
  }
  if (player.age === 2 && !has(T.ArcheryRange) && player.wood >= 175) placeNear(world, slot, villagers, T.ArcheryRange, tc.x, tc.y, send);

  // --- age up once the economy is going
  if (player.age === 1 && villagers.length >= 14 && canAfford(player, costOf(TECH_AGE2)) && !mine.some((e) => e.queue.includes(TECH_AGE2))) {
    send({ type: "research", building: tc.id, tech: TECH_AGE2 });
  }

  // --- farms when wild food runs out
  const berriesLeft = nearestNodeTo(world, tc.x, tc.y, "food", 14) !== null;
  const farms = building(T.Farm).length;
  const farmers = villagers.filter((v) => v.order.k === "gather" && v.order.res === "food").length;
  if (!berriesLeft && farms < Math.min(8, Math.max(2, farmers + 1)) && player.wood >= 60) placeNear(world, slot, villagers, T.Farm, tc.x, tc.y, send);

  // --- keep villagers busy
  const counts: Record<Res, number> = { food: 0, wood: 0, gold: 0 };
  for (const v of villagers) if (v.order.k === "gather") counts[v.order.res]++;
  const share: Record<Res, number> = player.age === 1 && !has(T.Barracks) ? { food: 0.55, wood: 0.4, gold: 0.05 } : { food: 0.45, wood: 0.35, gold: 0.2 };
  for (const v of villagers) {
    if (v.order.k !== "idle") continue;
    // Most under-staffed resource first; fall back to the next one if nothing of that kind is in reach.
    const byNeed = (["food", "wood", "gold"] as Res[]).sort((a, b) => counts[a] / (share[a] * villagers.length + 0.01) - counts[b] / (share[b] * villagers.length + 0.01));
    for (const res of byNeed) {
      const target = res === "food" ? (nearestNodeTo(world, v.x, v.y, "food", 14) ?? freeFarm(world, slot)) : nearestNodeTo(world, v.x, v.y, res, 40);
      if (!target) continue;
      send({ type: "interact", ids: [v.id], target: target.id });
      counts[res]++;
      break;
    }
  }

  // --- military production (leave food for villagers and houses)
  const reserve = { food: 60, wood: 40, gold: 0 };
  for (const b of [...building(T.Barracks), ...building(T.ArcheryRange)]) {
    if (!b.done || b.queue.length >= 2) continue;
    // Rotate through what this building offers, taking the first thing we can afford above the reserve.
    const options = BUILDINGS[b.type]!.trains.filter((u) => UNITS[u]!.age <= player.age);
    for (let i = 0; i < options.length; i++) {
      const unit = options[(army.length + b.id + i) % options.length]!;
      const cost = UNITS[unit]!.cost;
      if ((cost.food ?? 0) + reserve.food <= player.food && (cost.wood ?? 0) + reserve.wood <= player.wood && (cost.gold ?? 0) <= player.gold) {
        send({ type: "train", building: b.id, unit });
        break;
      }
    }
  }

  // --- defend the base, otherwise attack in waves
  const threat = [...world.entities.values()].find((e) => UNITS[e.type] && isEnemy(world, slot, e.owner) && Math.hypot(e.x - tc.x, e.y - tc.y) < 14 * TILE);
  const idleArmy = army.filter((u) => u.order.k === "idle");
  if (threat && army.length > 0) {
    send({ type: "attackMove", ids: army.map((u) => u.id).slice(0, 200), x: Math.round(threat.x), y: Math.round(threat.y) });
    return;
  }
  const waveSize = minute < 10 ? 8 : 12;
  if (army.length >= waveSize || (memory.attacking && idleArmy.length >= 4)) {
    const target = nearestEnemyTownCenter(world, slot, tc);
    if (target && world.tick - memory.lastWave >= 20 * 20) {
      send({ type: "attackMove", ids: army.map((u) => u.id).slice(0, 200), x: Math.round(target.x), y: Math.round(target.y) });
      memory.attacking = true;
      memory.lastWave = world.tick;
    }
  }
}

function nearestNodeTo(world: World, x: number, y: number, res: Res, maxTiles = 30): Entity | null {
  let best: Entity | null = null;
  let bestD = (maxTiles * TILE) ** 2;
  for (const e of world.entities.values()) {
    if (e.owner !== GAIA || NODES[e.type]?.res !== res) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

function freeFarm(world: World, slot: number): Entity | null {
  const taken = new Set<number>();
  for (const e of world.entities.values()) if (e.owner === slot && e.order.k === "gather") taken.add(e.order.target);
  for (const e of world.entities.values()) if (e.owner === slot && e.type === T.Farm && e.done && !taken.has(e.id)) return e;
  return null;
}

function nearestEnemyTownCenter(world: World, slot: number, from: Entity): Entity | null {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of world.entities.values()) {
    if (e.type !== T.TownCenter || !isEnemy(world, slot, e.owner)) continue;
    const d = (e.x - from.x) ** 2 + (e.y - from.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** Finds a free spot near (x, y) with a walkable 1-tile border, and sends the nearest non-building villager. */
function placeNear(world: World, slot: number, villagers: Entity[], type: number, x: number, y: number, send: (c: Command) => boolean): boolean {
  if (!canAfford(world.players[slot]!, costOf(type))) return false;
  const builder = villagers
    .filter((v) => v.order.k !== "build")
    .sort((a, b) => (a.x - x) ** 2 + (a.y - y) ** 2 - ((b.x - x) ** 2 + (b.y - y) ** 2))[0];
  if (!builder) return false;
  const size = BUILDINGS[type]!.size;
  const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
  for (let r = 2; r <= 14; r++) {
    for (let ty = cy - r; ty <= cy + r; ty++) {
      for (let tx = cx - r; tx <= cx + r; tx++) {
        if (Math.max(Math.abs(tx - cx), Math.abs(ty - cy)) !== r) continue;
        if (!canPlace(world, type, tx, ty) || !hasWalkableBorder(world, tx, ty, size)) continue;
        return send({ type: "build", ids: [builder.id], building: type, tx, ty });
      }
    }
  }
  return false;
}

function hasWalkableBorder(world: World, tx: number, ty: number, size: number): boolean {
  for (let y = ty - 1; y <= ty + size; y++) {
    for (let x = tx - 1; x <= tx + size; x++) {
      const edge = x === tx - 1 || y === ty - 1 || x === tx + size || y === ty + size;
      if (!edge) continue;
      if (!isWalkable(world, x, y)) return false;
      // Keep farms and other buildings from packing so tightly that villagers get walled in.
      for (const e of world.entities.values()) if (isBuilding(e.type) && x >= e.tx && x < e.tx + e.size && y >= e.ty && y < e.ty + e.size) return false;
    }
  }
  return true;
}
