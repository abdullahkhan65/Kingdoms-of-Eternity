import { TILE } from "./defs";
import { isWalkable, tileOf, type Entity, type Point, type World } from "./world";

const MAX_EXPANSIONS = 8000;
const STRAIGHT = 10;
const DIAGONAL = 14;
const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, STRAIGHT], [-1, 0, STRAIGHT], [0, 1, STRAIGHT], [0, -1, STRAIGHT],
  [1, 1, DIAGONAL], [1, -1, DIAGONAL], [-1, 1, DIAGONAL], [-1, -1, DIAGONAL],
];

const center = (t: number) => t * TILE + TILE / 2;

/**
 * A* over walkable tiles, 8-directional without cutting corners. Returns world
 * waypoints ending exactly at (x, y) when that tile is walkable, otherwise at
 * the nearest walkable tile. Empty if there is no route.
 */
export function findPath(world: World, fromX: number, fromY: number, x: number, y: number): Point[] {
  let sx = tileOf(fromX), sy = tileOf(fromY);
  if (!isWalkable(world, sx, sy)) {
    const free = nearestWalkable(world, sx, sy, 3);
    if (!free) return [];
    [sx, sy] = free;
  }
  let gx = tileOf(x), gy = tileOf(y);
  let exact = true;
  if (!isWalkable(world, gx, gy)) {
    const free = nearestWalkable(world, gx, gy, 12, fromX, fromY);
    if (!free) return [];
    [gx, gy] = free;
    exact = false;
  }
  if (sx === gx && sy === gy) return exact ? [{ x, y }] : [{ x: center(gx), y: center(gy) }];

  const cols = world.cols;
  const start = sy * cols + sx;
  const goal = gy * cols + gx;
  const scratch = scratchFor(world);
  const gen = ++scratch.generation;
  const { g, parent, stamp, closed } = scratch;
  const open = new MinHeap();
  stamp[start] = gen;
  g[start] = 0;
  parent[start] = -1;
  open.push(start, heuristic(sx, sy, gx, gy));
  let best = start;
  let bestH = heuristic(sx, sy, gx, gy);

  let expansions = 0;
  while (open.size > 0 && expansions++ < MAX_EXPANSIONS) {
    const cur = open.pop();
    if (cur === goal) {
      best = goal;
      break;
    }
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    const cx = cur % cols, cy = (cur - cx) / cols;
    const h = heuristic(cx, cy, gx, gy);
    if (h < bestH) {
      bestH = h;
      best = cur;
    }
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!isWalkable(world, nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!isWalkable(world, cx + dx, cy) || !isWalkable(world, cx, cy + dy))) continue;
      const n = ny * cols + nx;
      const ng = g[cur]! + cost;
      if (stamp[n] !== gen || ng < g[n]!) {
        stamp[n] = gen;
        g[n] = ng;
        parent[n] = cur;
        open.push(n, ng + heuristic(nx, ny, gx, gy));
      }
    }
  }

  // Walk back from the goal (or the closest tile reached if the goal is unreachable).
  const tiles: number[] = [];
  for (let t = best; t !== start && t !== -1; t = parent[t]!) tiles.push(t);
  tiles.reverse();
  const points = tiles.map((t) => ({ x: center(t % cols), y: center(Math.floor(t / cols)) }));
  if (best === goal && exact && points.length > 0) points[points.length - 1] = { x, y };
  return smooth(world, { x: fromX, y: fromY }, points);
}

/**
 * Reusable per-map search buffers. A generation counter marks which entries
 * belong to the current search, so nothing has to be cleared between searches.
 */
interface Scratch {
  generation: number;
  g: Int32Array;
  parent: Int32Array;
  stamp: Uint32Array;
  closed: Uint32Array;
}
const scratchByWorld = new WeakMap<World, Scratch>();

function scratchFor(world: World): Scratch {
  let s = scratchByWorld.get(world);
  if (!s) {
    const n = world.cols * world.rows;
    s = { generation: 0, g: new Int32Array(n), parent: new Int32Array(n), stamp: new Uint32Array(n), closed: new Uint32Array(n) };
    scratchByWorld.set(world, s);
  }
  return s;
}

/**
 * Path to stand next to a building or resource node. Prefers tiles sharing an
 * edge with the footprint: from a diagonal corner tile the gap is too wide for
 * melee reach, so corners are only used when every side tile is blocked.
 */
export function pathToFootprint(world: World, unit: Entity, target: Entity): Point[] {
  let best: [number, number] | null = null;
  let bestD = Infinity;
  const x0 = target.tx - 1, y0 = target.ty - 1, x1 = target.tx + target.size, y1 = target.ty + target.size;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const onRing = x === x0 || y === y0 || x === x1 || y === y1;
      if (!onRing || !isWalkable(world, x, y)) continue;
      const corner = (x === x0 || x === x1) && (y === y0 || y === y1);
      const d = (center(x) - unit.x) ** 2 + (center(y) - unit.y) ** 2 + (corner ? 1e12 : 0);
      if (d < bestD) {
        bestD = d;
        best = [x, y];
      }
    }
  }
  if (!best) return findPath(world, unit.x, unit.y, target.x, target.y);
  return findPath(world, unit.x, unit.y, center(best[0]), center(best[1]));
}

/** Nearest walkable tile within `radius` rings, preferring tiles closer to (biasX, biasY) on ties. */
export function nearestWalkable(world: World, tx: number, ty: number, radius: number, biasX?: number, biasY?: number): [number, number] | null {
  if (isWalkable(world, tx, ty)) return [tx, ty];
  for (let r = 1; r <= radius; r++) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let y = ty - r; y <= ty + r; y++) {
      for (let x = tx - r; x <= tx + r; x++) {
        if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== r || !isWalkable(world, x, y)) continue;
        const d = biasX === undefined ? (x - tx) ** 2 + (y - ty) ** 2 : (center(x) - biasX) ** 2 + (center(y) - biasY!) ** 2;
        if (d < bestD) {
          bestD = d;
          best = [x, y];
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** True if a straight walk between two points crosses only walkable tiles. */
export function lineOfWalk(world: World, a: Point, b: Point): boolean {
  const steps = Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / (TILE / 4));
  for (let i = 1; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps;
    const y = a.y + ((b.y - a.y) * i) / steps;
    // Check a unit-sized box, not just the center, so paths don't clip corners or squeeze between diagonal tiles.
    const r = TILE / 4;
    for (const [ox, oy] of [[0, 0], [r, r], [-r, -r], [r, -r], [-r, r]] as const) {
      if (!isWalkable(world, tileOf(x + ox), tileOf(y + oy))) return false;
    }
  }
  return true;
}

/** String-pulling: from each anchor, walk forward while a straight line still works, then keep that waypoint. */
function smooth(world: World, from: Point, points: Point[]): Point[] {
  const out: Point[] = [];
  let anchor = from;
  let i = 0;
  while (i < points.length) {
    let j = i;
    while (j + 1 < points.length && lineOfWalk(world, anchor, points[j + 1]!)) j++;
    out.push(points[j]!);
    anchor = points[j]!;
    i = j + 1;
  }
  return out;
}

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  return STRAIGHT * (dx + dy) + (DIAGONAL - 2 * STRAIGHT) * Math.min(dx, dy);
}

/**
 * Binary min-heap of tile indices. Priority and insertion order are packed into
 * one number (priority * 2^20 + seq) so ties break by insertion order, which
 * keeps searches deterministic, and the heap stays a flat array of numbers.
 */
class MinHeap {
  private keys: number[] = [];
  private nodes: number[] = [];
  private seq = 0;

  get size(): number {
    return this.keys.length;
  }

  push(node: number, priority: number): void {
    const { keys, nodes } = this;
    const key = priority * 1048576 + (this.seq++ & 0xfffff);
    let i = keys.length;
    keys.push(key);
    nodes.push(node);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      keys[i] = keys[p]!;
      nodes[i] = nodes[p]!;
      i = p;
    }
    keys[i] = key;
    nodes[i] = node;
  }

  pop(): number {
    const { keys, nodes } = this;
    const top = nodes[0]!;
    const lastKey = keys.pop()!;
    const lastNode = nodes.pop()!;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && keys[r]! < keys[l]! ? r : l;
        if (keys[m]! >= lastKey) break;
        keys[i] = keys[m]!;
        nodes[i] = nodes[m]!;
        i = m;
      }
      keys[i] = lastKey;
      nodes[i] = lastNode;
    }
    return top;
  }
}
