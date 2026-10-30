import { describe, expect, it } from "vitest";
import { SnapshotDecoder, SnapshotEncoder, type EntityView } from "../src";

const sorted = (m: Map<number, EntityView>) => new Map([...m].sort(([a], [b]) => a - b));

describe("snapshot delta encoding", () => {
  it("round-trips adds, small moves, big jumps, hp/flag changes and removals", () => {
    const enc = new SnapshotEncoder();
    const dec = new SnapshotDecoder();
    const truth = new Map<number, EntityView>();
    let seed = 1;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);

    for (let tick = 0; tick < 300; tick++) {
      if (truth.size < 300 || rand(4) === 0) {
        const id = rand(2000) + 1;
        truth.set(id, { id, owner: rand(8), type: rand(50), x: rand(8000), y: rand(8000), hp: rand(1500), flags: rand(8) });
      }
      for (const e of truth.values()) {
        const r = rand(10);
        if (r === 0) e.x = rand(8000); // big jump: must be sent as absolute
        else if (r === 1) e.hp = rand(1500);
        else if (r === 2) e.flags = rand(8);
        else {
          e.x = Math.max(0, e.x + rand(13) - 6);
          e.y = Math.max(0, e.y + rand(13) - 6);
        }
      }
      if (rand(5) === 0) truth.delete([...truth.keys()][rand(truth.size)]!);

      dec.apply(enc.encode(tick, [...truth.values()].map((e) => ({ ...e }))));
      expect(dec.tick).toBe(tick);
      expect(sorted(dec.entities)).toEqual(sorted(truth));
    }
  });

  it("sends nothing per entity when nothing changed", () => {
    const enc = new SnapshotEncoder();
    const e = [{ id: 1, owner: 0, type: 1, x: 10, y: 10, hp: 25, flags: 0 }];
    expect(enc.encode(0, e).byteLength).toBeGreaterThan(12);
    expect(enc.encode(1, e).byteLength).toBe(12); // header + three empty counts
  });

  it("a fresh encoder sends a keyframe that clears stale client state (rejoin)", () => {
    const dec = new SnapshotDecoder();
    dec.apply(new SnapshotEncoder().encode(0, [{ id: 7, owner: 0, type: 1, x: 0, y: 0, hp: 1, flags: 0 }]));
    dec.apply(new SnapshotEncoder().encode(1, [{ id: 8, owner: 0, type: 1, x: 0, y: 0, hp: 1, flags: 0 }]));
    expect([...dec.entities.keys()]).toEqual([8]);
  });

  it("rejects ids that don't fit the wire format", () => {
    expect(() => new SnapshotEncoder().encode(0, [{ id: 70000, owner: 0, type: 1, x: 0, y: 0, hp: 1, flags: 0 }])).toThrow();
  });
});
