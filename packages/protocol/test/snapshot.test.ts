import { describe, expect, it } from "vitest";
import { SnapshotDecoder, SnapshotEncoder, type UnitView } from "../src";

function snapshot(units: Map<number, UnitView>): UnitView[] {
  return [...units.values()].map((u) => ({ ...u }));
}

describe("snapshot delta encoding", () => {
  it("round-trips adds, small moves, big jumps and removals", () => {
    const enc = new SnapshotEncoder();
    const dec = new SnapshotDecoder();
    const truth = new Map<number, UnitView>();
    let seed = 1;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);

    for (let tick = 0; tick < 300; tick++) {
      if (truth.size < 300 || rand(4) === 0) {
        const id = rand(2000) + 1;
        truth.set(id, { id, owner: rand(8), x: rand(8000), y: rand(8000) });
      }
      for (const u of truth.values()) {
        if (rand(10) === 0) u.x = rand(8000); // big jump: must be sent as absolute
        else {
          u.x = Math.max(0, u.x + rand(13) - 6);
          u.y = Math.max(0, u.y + rand(13) - 6);
        }
      }
      if (rand(5) === 0) truth.delete([...truth.keys()][rand(truth.size)]!);

      dec.apply(enc.encode(tick, snapshot(truth)));
      expect(dec.tick).toBe(tick);
      expect(new Map([...dec.units].sort(([a], [b]) => a - b))).toEqual(new Map([...truth].sort(([a], [b]) => a - b)));
    }
  });

  it("sends nothing per unit when nothing changed", () => {
    const enc = new SnapshotEncoder();
    const units = [{ id: 1, owner: 0, x: 10, y: 10 }];
    expect(enc.encode(0, units).byteLength).toBeGreaterThan(11);
    expect(enc.encode(1, units).byteLength).toBe(11); // header + three empty counts
  });

  it("rejects ids that don't fit the wire format", () => {
    expect(() => new SnapshotEncoder().encode(0, [{ id: 70000, owner: 0, x: 0, y: 0 }])).toThrow();
  });
});
