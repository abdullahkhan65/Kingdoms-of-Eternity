import { describe, expect, it } from "vitest";
import {
  AGE2_TIME, BUILDINGS, NODES, T, TECH_AGE2, TILE, UNITS,
  addPlayer, applyCommand, createWorld, entitiesVisibleTo, findPath, generateMatch, hashWorld, isWalkable,
  newBotMemory, placeBuilding, placeNode, population, runBot, spawnUnit, step, tileOf, BOT_INTERVAL,
  type Entity, type World,
} from "../src";

const at = (t: number) => t * TILE + TILE / 2;

function world(cols = 40): World {
  const w = createWorld({ seed: 42, widthTiles: cols, heightTiles: cols });
  addPlayer(w, 0);
  addPlayer(w, 1);
  return w;
}

function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(w);
}

const ok = { ok: true };

describe("commands are validated", () => {
  it.each([
    ["null", null],
    ["unknown type", { type: "teleport" }],
    ["empty ids", { type: "move", ids: [], x: 0, y: 0 }],
    ["non-integer target", { type: "move", ids: [1], x: 1.5, y: 0 }],
    ["string target", { type: "move", ids: [1], x: "0", y: 0 }],
    ["unknown unit", { type: "move", ids: [999], x: 0, y: 0 }],
    ["too many ids", { type: "move", ids: Array.from({ length: 201 }, () => 1), x: 0, y: 0 }],
  ])("rejects malformed payload: %s", (_, payload) => {
    const w = world();
    spawnUnit(w, 0, at(5), at(5));
    expect(applyCommand(w, 0, payload).ok).toBe(false);
  });

  it("rejects moving another player's unit, and the whole command with it", () => {
    const w = world();
    const mine = spawnUnit(w, 0, at(5), at(5));
    const theirs = spawnUnit(w, 1, at(6), at(5));
    expect(applyCommand(w, 0, { type: "move", ids: [mine.id, theirs.id], x: 100, y: 100 }).ok).toBe(false);
    expect(mine.order.k).toBe("idle");
  });

  it("rejects building without resources, on blocked tiles, or from a later age", () => {
    const w = world();
    const v = spawnUnit(w, 0, at(5), at(5));
    placeNode(w, T.Tree, 10, 10);
    expect(applyCommand(w, 0, { type: "build", ids: [v.id], building: T.House, tx: 9, ty: 9 }).ok).toBe(false); // tree in footprint
    expect(applyCommand(w, 0, { type: "build", ids: [v.id], building: T.ArcheryRange, tx: 20, ty: 20 }).ok).toBe(false); // age 2
    w.players[0]!.wood = 0;
    expect(applyCommand(w, 0, { type: "build", ids: [v.id], building: T.House, tx: 20, ty: 20 }).ok).toBe(false);
  });

  it("rejects training at the wrong building or from a later age, and refunds on cancel", () => {
    const w = world();
    const tc = placeBuilding(w, 0, T.TownCenter, 5, 5, true);
    const barracks = placeBuilding(w, 0, T.Barracks, 12, 5, true);
    expect(applyCommand(w, 0, { type: "train", building: tc.id, unit: T.Spearman }).ok).toBe(false);
    expect(applyCommand(w, 0, { type: "train", building: barracks.id, unit: T.Swordsman }).ok).toBe(false);
    expect(applyCommand(w, 1, { type: "train", building: tc.id, unit: T.Villager }).ok).toBe(false); // not theirs
    const food = w.players[0]!.food;
    expect(applyCommand(w, 0, { type: "train", building: tc.id, unit: T.Villager })).toEqual(ok);
    expect(w.players[0]!.food).toBe(food - 50);
    expect(applyCommand(w, 0, { type: "cancel", building: tc.id, index: 0 })).toEqual(ok);
    expect(w.players[0]!.food).toBe(food);
  });
});

describe("movement", () => {
  it("walks around a wall of trees and never stands on a blocked tile", () => {
    const w = world();
    for (let y = 2; y < 30; y++) placeNode(w, T.Tree, 15, y);
    const v = spawnUnit(w, 0, at(10), at(15));
    expect(applyCommand(w, 0, { type: "move", ids: [v.id], x: at(20), y: at(15) })).toEqual(ok);
    for (let i = 0; i < 1500; i++) {
      step(w);
      expect(isWalkable(w, tileOf(v.x), tileOf(v.y))).toBe(true);
    }
    expect(Math.hypot(v.x - at(20), v.y - at(15))).toBeLessThan(TILE / 2);
  });

  it("finds no path into a sealed box but still gets as close as it can", () => {
    const w = world();
    for (let i = 18; i <= 22; i++) for (const [x, y] of [[i, 18], [i, 22], [18, i], [22, i]]) placeNode(w, T.Tree, x!, y!);
    const path = findPath(w, at(5), at(5), at(20), at(20));
    const end = path[path.length - 1]!;
    expect(Math.hypot(end.x - at(20), end.y - at(20))).toBeLessThan(4 * TILE);
  });
});

describe("economy", () => {
  it("villagers gather berries, walk them to the Town Center and add them to the stockpile", () => {
    const w = world();
    placeBuilding(w, 0, T.TownCenter, 5, 5, true);
    const bush = placeNode(w, T.Berries, 11, 6);
    const v = spawnUnit(w, 0, at(9), at(6));
    w.players[0]!.food = 0;
    applyCommand(w, 0, { type: "interact", ids: [v.id], target: bush.id });
    run(w, 20 * 60);
    expect(w.players[0]!.food).toBeGreaterThanOrEqual(40);
    expect(bush.amount).toBeLessThan(NODES[T.Berries]!.amount);
  });

  it("builds a House, which raises the population cap by 5", () => {
    const w = world();
    placeBuilding(w, 0, T.TownCenter, 5, 5, true);
    const v = spawnUnit(w, 0, at(10), at(10));
    expect(population(w, 0).cap).toBe(5);
    expect(applyCommand(w, 0, { type: "build", ids: [v.id], building: T.House, tx: 12, ty: 10 })).toEqual(ok);
    run(w, BUILDINGS[T.House]!.buildTime + 100);
    expect(population(w, 0).cap).toBe(10);
    expect(v.order.k).toBe("idle");
  });

  it("finished farms feed the villager who built them", () => {
    const w = world();
    placeBuilding(w, 0, T.TownCenter, 5, 5, true);
    const v = spawnUnit(w, 0, at(10), at(6));
    applyCommand(w, 0, { type: "build", ids: [v.id], building: T.Farm, tx: 10, ty: 9 });
    run(w, BUILDINGS[T.Farm]!.buildTime + 50);
    expect(v.order).toMatchObject({ k: "gather", res: "food" });
  });
});

describe("production and ages", () => {
  it("trains units, but waits when housed", () => {
    const w = world();
    const tc = placeBuilding(w, 0, T.TownCenter, 5, 5, true);
    for (let i = 0; i < 4; i++) spawnUnit(w, 0, at(15 + i), at(15));
    applyCommand(w, 0, { type: "train", building: tc.id, unit: T.Villager });
    applyCommand(w, 0, { type: "train", building: tc.id, unit: T.Villager });
    run(w, UNITS[T.Villager]!.trainTime * 3);
    expect(population(w, 0)).toEqual({ pop: 5, cap: 5 });
    expect(tc.queue).toHaveLength(1); // second villager is waiting for a House
  });

  it("advancing an age unlocks Swordsmen", () => {
    const w = world();
    const tc = placeBuilding(w, 0, T.TownCenter, 5, 5, true);
    const barracks = placeBuilding(w, 0, T.Barracks, 12, 5, true);
    Object.assign(w.players[0]!, { food: 1000, gold: 1000 });
    expect(applyCommand(w, 0, { type: "research", building: tc.id, tech: TECH_AGE2 })).toEqual(ok);
    expect(applyCommand(w, 0, { type: "research", building: tc.id, tech: TECH_AGE2 }).ok).toBe(false); // only once
    run(w, AGE2_TIME + 1);
    expect(w.players[0]!.age).toBe(2);
    expect(applyCommand(w, 0, { type: "train", building: barracks.id, unit: T.Swordsman })).toEqual(ok);
  });
});

describe("combat", () => {
  function duel(a: number, b: number): Entity | null {
    const w = world();
    const ua = spawnUnit(w, 0, at(10), at(10), a);
    const ub = spawnUnit(w, 1, at(13), at(10), b);
    applyCommand(w, 0, { type: "interact", ids: [ua.id], target: ub.id });
    applyCommand(w, 1, { type: "interact", ids: [ub.id], target: ua.id });
    run(w, 20 * 60);
    return w.entities.has(ua.id) ? ua : w.entities.has(ub.id) ? ub : null;
  }

  it("Spearmen beat Scout Riders", () => expect(duel(T.Spearman, T.Scout)?.type).toBe(T.Spearman));
  it("Scout Riders beat Archers", () => expect(duel(T.Scout, T.Archer)?.type).toBe(T.Scout));
  it("Archers beat Spearmen", () => expect(duel(T.Archer, T.Spearman)?.type).toBe(T.Archer));

  it("idle soldiers defend themselves against nearby enemies", () => {
    const w = world();
    const guard = spawnUnit(w, 0, at(10), at(10), T.Spearman);
    const raider = spawnUnit(w, 1, at(12), at(10), T.Villager);
    step(w);
    run(w, 10);
    expect(guard.order).toMatchObject({ k: "attack", target: raider.id });
  });

  it("losing your Town Center is defeat, and the last team standing wins", () => {
    const w = world();
    const tc0 = placeBuilding(w, 0, T.TownCenter, 5, 5, true);
    placeBuilding(w, 1, T.TownCenter, 30, 30, true);
    spawnUnit(w, 0, at(7), at(9));
    run(w, 1); // both players register their Town Centers
    tc0.hp = 0;
    run(w, 21);
    expect(w.players[0]!.defeated).toBe(true);
    expect([...w.entities.values()].some((e) => e.owner === 0)).toBe(false);
    expect(w.winnerTeam).not.toBeNull();
  });
});

describe("fog of war", () => {
  it("only sends enemies inside the player's vision", () => {
    const w = world();
    spawnUnit(w, 0, at(5), at(5));
    const far = spawnUnit(w, 1, at(30), at(30));
    const near = spawnUnit(w, 1, at(7), at(5));
    const tree = placeNode(w, T.Tree, 35, 35);
    const seen = new Set(entitiesVisibleTo(w, 0).map((e) => e.id));
    expect(seen.has(near.id)).toBe(true);
    expect(seen.has(far.id)).toBe(false);
    expect(seen.has(tree.id)).toBe(true); // terrain features are always known
  });

  it("allies share vision", () => {
    const w = world();
    w.players[0]!.team = 1;
    w.players[1]!.team = 1;
    addPlayer(w, 2);
    spawnUnit(w, 1, at(30), at(30));
    const enemy = spawnUnit(w, 2, at(31), at(30));
    expect(entitiesVisibleTo(w, 0).some((e) => e.id === enemy.id)).toBe(true);
  });
});

describe("maps", () => {
  const seats = (n: number) => Array.from({ length: n }, (_, slot) => ({ slot, team: 0, civ: slot % 2 }));

  it("same seed gives the same map", () => {
    expect(hashWorld(generateMatch(7, seats(4)))).toBe(hashWorld(generateMatch(7, seats(4))));
    expect(hashWorld(generateMatch(7, seats(4)))).not.toBe(hashWorld(generateMatch(8, seats(4))));
  });

  it.each([2, 4, 8])("every player starts with a Town Center and 3 villagers and can reach every other player (%i players)", (n) => {
    for (const seed of [1, 2, 3]) {
      const w = generateMatch(seed, seats(n));
      const tcs = [...w.entities.values()].filter((e) => e.type === T.TownCenter);
      expect(tcs).toHaveLength(n);
      for (let p = 0; p < n; p++) expect([...w.entities.values()].filter((e) => e.owner === p && e.type === T.Villager)).toHaveLength(3);
      const from = [...w.entities.values()].find((e) => e.owner === 0 && e.type === T.Villager)!;
      for (const tc of tcs.slice(1)) {
        const path = findPath(w, from.x, from.y, tc.x, tc.y + 2 * TILE);
        const end = path[path.length - 1]!;
        expect(Math.hypot(end.x - tc.x, end.y - (tc.y + 2 * TILE))).toBeLessThan(2 * TILE);
      }
    }
  });
});

describe("full match", () => {
  function botMatch(seed: number, minutes: number) {
    const w = generateMatch(seed, [{ slot: 0, team: 0, civ: 0 }, { slot: 1, team: 0, civ: 1 }]);
    const memories = [newBotMemory(), newBotMemory()];
    const snapshots: Array<{ minute: number; villagers: number[]; army: number[] }> = [];
    for (let t = 0; t < minutes * 60 * 20 && w.winnerTeam === null; t++) {
      if (t % BOT_INTERVAL === 0) for (const slot of [0, 1]) runBot(w, slot, memories[slot]!);
      step(w);
      if (t % (60 * 20) === 0) {
        const count = (slot: number, pred: (e: Entity) => boolean) => [...w.entities.values()].filter((e) => e.owner === slot && pred(e)).length;
        snapshots.push({
          minute: t / 1200,
          villagers: [0, 1].map((s) => count(s, (e) => e.type === T.Villager)),
          army: [0, 1].map((s) => count(s, (e) => !!UNITS[e.type] && e.type !== T.Villager)),
        });
      }
    }
    return { w, snapshots };
  }

  it("two bots grow an economy, age up, fight, and one of them wins", { timeout: 180_000 }, () => {
    const { w, snapshots } = botMatch(11, 40);
    const at8 = snapshots.find((s) => s.minute === 8)!;
    expect(Math.min(...at8.villagers)).toBeGreaterThanOrEqual(10);
    expect(snapshots.some((s) => Math.max(...s.army) >= 5)).toBe(true);
    expect(w.winnerTeam).not.toBeNull();
  });

  it("is deterministic: the same seed and bot decisions replay to the same world", { timeout: 60_000 }, () => {
    expect(hashWorld(botMatch(5, 4).w)).toBe(hashWorld(botMatch(5, 4).w));
  });
});
