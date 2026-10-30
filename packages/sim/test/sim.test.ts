import { describe, expect, it } from "vitest";
import { applyCommand, createWorld, hashWorld, randomInt, spawnPlayerStart, spawnUnit, step, TILE, type World } from "../src";

function world(): World {
  return createWorld({ seed: 42, widthTiles: 64, heightTiles: 64 });
}

describe("move command", () => {
  it("moves an owned unit to the target and stops", () => {
    const w = world();
    const u = spawnUnit(w, 0, 100, 100);
    expect(applyCommand(w, 0, { type: "move", ids: [u.id], x: 400, y: 100 })).toEqual({ ok: true });
    for (let i = 0; i < 200; i++) step(w);
    expect(u).toMatchObject({ x: 400, y: 100, moving: false });
  });

  it("rejects moving another player's unit", () => {
    const w = world();
    const u = spawnUnit(w, 1, 100, 100);
    expect(applyCommand(w, 0, { type: "move", ids: [u.id], x: 400, y: 100 })).toMatchObject({ ok: false });
    expect(u.moving).toBe(false);
  });

  it("rejects the whole command if any unit is not owned", () => {
    const w = world();
    const mine = spawnUnit(w, 0, 100, 100);
    const theirs = spawnUnit(w, 1, 200, 100);
    expect(applyCommand(w, 0, { type: "move", ids: [mine.id, theirs.id], x: 400, y: 100 }).ok).toBe(false);
    expect(mine.moving).toBe(false);
  });

  it.each([
    ["null", null],
    ["unknown type", { type: "teleport", ids: [1], x: 0, y: 0 }],
    ["empty ids", { type: "move", ids: [], x: 0, y: 0 }],
    ["non-integer target", { type: "move", ids: [1], x: 1.5, y: 0 }],
    ["string target", { type: "move", ids: [1], x: "0", y: 0 }],
    ["unknown unit", { type: "move", ids: [999], x: 0, y: 0 }],
    ["too many ids", { type: "move", ids: Array.from({ length: 201 }, () => 1), x: 0, y: 0 }],
  ])("rejects malformed payload: %s", (_, payload) => {
    const w = world();
    spawnUnit(w, 0, 100, 100);
    expect(applyCommand(w, 0, payload).ok).toBe(false);
  });

  it("clamps targets to the map", () => {
    const w = world();
    const u = spawnUnit(w, 0, 100, 100);
    applyCommand(w, 0, { type: "move", ids: [u.id], x: -5000, y: 999999 });
    expect(u.tx).toBe(0);
    expect(u.ty).toBe(w.height - 1);
  });
});

describe("separation", () => {
  it("pushes stacked units apart", () => {
    const w = world();
    const a = spawnUnit(w, 0, 500, 500);
    const b = spawnUnit(w, 0, 500, 500);
    for (let i = 0; i < 40; i++) step(w);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(TILE / 2 - 2);
  });
});

describe("determinism", () => {
  function playMatch(): number {
    const w = createWorld({ seed: 7, widthTiles: 128, heightTiles: 128 });
    for (let p = 0; p < 8; p++) spawnPlayerStart(w, p, 75);
    const cmdRng = { rng: 99 };
    for (let t = 0; t < 600; t++) {
      if (t % 10 === 0) {
        const player = randomInt(cmdRng, 0, 8);
        const ids = [...w.units.values()].filter((u) => u.owner === player).slice(0, 20).map((u) => u.id);
        applyCommand(w, player, { type: "move", ids, x: randomInt(cmdRng, 0, w.width), y: randomInt(cmdRng, 0, w.height) });
      }
      step(w);
    }
    return hashWorld(w);
  }

  it("same seed and commands give the same world", () => {
    expect(playMatch()).toBe(playMatch());
  });
});
