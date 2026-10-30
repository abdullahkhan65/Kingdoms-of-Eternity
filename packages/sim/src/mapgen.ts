import { START_VILLAGERS, T, TILE } from "./defs";
import { nextRandom, randomInt } from "./rng";
import { addPlayer, createWorld, isWalkable, placeBuilding, placeNode, spawnUnit, Terrain, type World } from "./world";

export interface Seat {
  slot: number;
  team: number;
  civ: number;
}

/** 8 start positions on a ring, as fractions of map size (x1000). A table so it's engine-independent. */
const RING: ReadonlyArray<readonly [number, number]> = [
  [860, 500], [755, 755], [500, 860], [245, 755],
  [140, 500], [245, 245], [500, 140], [755, 245],
];
const START_CLEARING = 8;

export function mapSizeFor(players: number): number {
  return Math.min(128, Math.max(80, 64 + 8 * players));
}

/** Builds a ready-to-play world: terrain, resources, and each seat's starting town. Same seed + seats → same map. */
export function generateMatch(seed: number, seats: Seat[]): World {
  const size = mapSizeFor(seats.length);
  const world = createWorld({ seed, widthTiles: size, heightTiles: size });
  const starts = seats.map((_, i) => {
    const [fx, fy] = RING[Math.floor((i * RING.length) / Math.max(1, seats.length)) % RING.length]!;
    return [Math.floor((size * fx) / 1000), Math.floor((size * fy) / 1000)] as const;
  });
  const nearStart = (x: number, y: number, r: number) => starts.some(([sx, sy]) => (x - sx) ** 2 + (y - sy) ** 2 < r * r);

  // Lakes, kept away from starts.
  const lakes = 1 + Math.floor(seats.length / 2);
  for (let i = 0; i < lakes; i++) {
    const [cx, cy] = pickSpot(world, (x, y) => !nearStart(x, y, START_CLEARING + 10));
    blob(world, cx, cy, randomInt(world, 3, 6), (x, y) => {
      if (!nearStart(x, y, START_CLEARING + 4)) setWater(world, x, y);
    });
  }

  for (const [i, seat] of seats.entries()) {
    const [sx, sy] = starts[i]!;
    addPlayer(world, seat.slot, seat.team, seat.civ);
    placeBuilding(world, seat.slot, T.TownCenter, sx - 1, sy - 1, true);
    for (let v = 0; v < START_VILLAGERS; v++) spawnUnit(world, seat.slot, (sx - 1 + v) * TILE + TILE / 2, (sy + 2) * TILE + TILE / 2, T.Villager);

    // Starting resources in different directions around the Town Center.
    const base = nextRandom(world) * 8;
    const around = (k: number, dist: number) => {
      const a = Math.floor(base + k * 2.6) % 8;
      const [dx, dy] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]][a]!;
      return [sx + dx! * dist, sy + dy! * dist] as const;
    };
    const [bx, by] = around(0, 5);
    blob(world, bx, by, 1, (x, y) => tryNode(world, T.Berries, x, y));
    const [gx, gy] = around(1, 7);
    blob(world, gx, gy, 1, (x, y) => tryNode(world, T.GoldMine, x, y));
    for (const k of [2, 3]) {
      const [fx, fy] = around(k, 10);
      blob(world, fx, fy, 3, (x, y) => tryNode(world, T.Tree, x, y));
    }
  }

  // Scattered forests outside the start clearings, and contested gold in the middle.
  const forests = Math.floor((size * size) / 450);
  for (let i = 0; i < forests; i++) {
    const [cx, cy] = pickSpot(world, (x, y) => !nearStart(x, y, START_CLEARING + 3));
    blob(world, cx, cy, randomInt(world, 2, 5), (x, y) => {
      if (!nearStart(x, y, START_CLEARING)) tryNode(world, T.Tree, x, y);
    });
  }
  const mid = Math.floor(size / 2);
  for (const [ox, oy] of [[-4, -3], [4, 3]] as const) blob(world, mid + ox, mid + oy, 1, (x, y) => tryNode(world, T.GoldMine, x, y));

  ensureConnected(world, starts);
  return world;
}

function setWater(world: World, x: number, y: number): void {
  if (x < 1 || y < 1 || x >= world.cols - 1 || y >= world.rows - 1) return;
  const i = y * world.cols + x;
  if (world.terrain[i] === Terrain.Water || world.blocked[i] !== 0) return;
  world.terrain[i] = Terrain.Water;
  world.blocked[i] = 1;
}

function tryNode(world: World, type: number, x: number, y: number): void {
  if (isWalkable(world, x, y)) placeNode(world, type, x, y);
}

/** Irregular disc of tiles around (cx, cy). */
function blob(world: World, cx: number, cy: number, r: number, visit: (x: number, y: number) => void): void {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 <= r * r * (0.55 + 0.45 * nextRandom(world)) || d2 === 0) visit(x, y);
    }
  }
}

function pickSpot(world: World, ok: (x: number, y: number) => boolean): [number, number] {
  for (let attempt = 0; attempt < 200; attempt++) {
    const x = randomInt(world, 3, world.cols - 3);
    const y = randomInt(world, 3, world.rows - 3);
    if (ok(x, y)) return [x, y];
  }
  return [Math.floor(world.cols / 2), Math.floor(world.rows / 2)];
}

/** Flood fill from the first start; carve a corridor to any start it can't reach. */
function ensureConnected(world: World, starts: ReadonlyArray<readonly [number, number]>): void {
  const [first, ...rest] = starts;
  if (!first) return;
  for (const target of rest) {
    if (reachable(world, first, target)) continue;
    carve(world, first, target);
  }
}

function reachable(world: World, [ax, ay]: readonly [number, number], [bx, by]: readonly [number, number]): boolean {
  // Start just below each Town Center, where the villagers stand.
  const start = (ay + 2) * world.cols + ax;
  const goal = (by + 2) * world.cols + bx;
  const seen = new Uint8Array(world.cols * world.rows);
  const queue = [start];
  seen[start] = 1;
  while (queue.length > 0) {
    const cur = queue.pop()!;
    if (cur === goal) return true;
    const x = cur % world.cols, y = (cur - x) / world.cols;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      const n = ny * world.cols + nx;
      if (isWalkable(world, nx, ny) && !seen[n]) {
        seen[n] = 1;
        queue.push(n);
      }
    }
  }
  return false;
}

/** Clears trees and water along a 3-tile-wide straight corridor. */
function carve(world: World, [ax, ay]: readonly [number, number], [bx, by]: readonly [number, number]): void {
  const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
  for (let i = 0; i <= steps; i++) {
    const cx = Math.round(ax + ((bx - ax) * i) / steps);
    const cy = Math.round(ay + 2 + ((by - ay) * i) / steps);
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        if (x < 0 || y < 0 || x >= world.cols || y >= world.rows) continue;
        const idx = y * world.cols + x;
        if (world.terrain[idx] === Terrain.Water) {
          world.terrain[idx] = Terrain.Grass;
          world.blocked[idx] = 0;
        }
        for (const e of world.entities.values()) {
          if (e.type === T.Tree && e.tx === x && e.ty === y) {
            world.entities.delete(e.id);
            world.blocked[idx] = 0;
          }
        }
      }
    }
  }
}
