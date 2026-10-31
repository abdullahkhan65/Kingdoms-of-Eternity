// Paints the ground once per match: grass with patches of dry grass and dirt,
// soft sandy shores, and water that darkens with depth. Tiles stay square in
// the simulation; only the picture is smoothed.
import { seeded } from "./art";

/** Terrain texture pixels per tile. */
export const TERRAIN_PX = 20;

type RGB = [number, number, number];
const GRASS: RGB = [84, 126, 50];
const GRASS_LIGHT: RGB = [118, 152, 62];
const GRASS_DRY: RGB = [146, 150, 76];
const DIRT: RGB = [138, 112, 74];
const SAND: RGB = [204, 186, 128];
const WET_SAND: RGB = [160, 146, 104];
const SHALLOW: RGB = [62, 142, 168];
const DEEP: RGB = [24, 70, 118];
const FOAM: RGB = [214, 232, 232];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]; `period` makes it tile seamlessly. */
function noise(x: number, y: number, seed: number, period = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (n: number) => (period ? ((n % period) + period) % period : n);
  const a = hash(w(xi), w(yi), seed), b = hash(w(xi + 1), w(yi), seed);
  const c = hash(w(xi), w(yi + 1), seed), d = hash(w(xi + 1), w(yi + 1), seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

const DETAIL = 256;

/** A seamless tile of fine noise, sampled per pixel instead of computing noise for every pixel. */
function detailTile(seed: number): Float32Array {
  const out = new Float32Array(DETAIL * DETAIL);
  for (let y = 0; y < DETAIL; y++) {
    for (let x = 0; x < DETAIL; x++) {
      out[y * DETAIL + x] = noise(x / 8, y / 8, seed, DETAIL / 8) * 0.6 + noise(x / 3, y / 3, seed + 1, Math.round(DETAIL / 3)) * 0.4;
    }
  }
  return out;
}

export function paintTerrain(cols: number, rows: number, terrain: Uint8Array, seed = 1): HTMLCanvasElement {
  const P = TERRAIN_PX;
  const W = cols * P, H = rows * P;
  const water = (tx: number, ty: number) =>
    tx < 0 || ty < 0 || tx >= cols || ty >= rows ? 0 : terrain[ty * cols + tx] === 1 ? 1 : 0;

  // How much water surrounds each tile, for depth.
  const depth = new Float32Array(cols * rows);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      let n = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) n += water(tx + dx, ty + dy);
      depth[ty * cols + tx] = n / 25;
    }
  }
  const depthAt = (tx: number, ty: number) =>
    depth[Math.max(0, Math.min(rows - 1, ty)) * cols + Math.max(0, Math.min(cols - 1, tx))]!;

  const detail = detailTile(seed);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  const data = img.data;

  for (let py = 0; py < H; py++) {
    const v = py / P - 0.5;
    const ty = Math.floor(v), fy = v - ty;
    for (let px = 0; px < W; px++) {
      const u = px / P - 0.5;
      const tx = Math.floor(u), fx = u - tx;
      const d = detail[(py & (DETAIL - 1)) * DETAIL + (px & (DETAIL - 1))]!;
      const a = water(tx, ty), b = water(tx + 1, ty), c = water(tx, ty + 1), e = water(tx + 1, ty + 1);
      let w = lerp(lerp(a, b, fx), lerp(c, e, fx), fy);
      if (a + b + c + e !== 0 && a + b + c + e !== 4) w += (d - 0.5) * 0.36;

      let r: number, g: number, bl: number;
      if (w >= 0.5) {
        const deep = smooth(0.35, 0.95, lerp(lerp(depthAt(tx, ty), depthAt(tx + 1, ty), fx), lerp(depthAt(tx, ty + 1), depthAt(tx + 1, ty + 1), fx), fy));
        const ripple = 0.92 + detail[((py * 3) & (DETAIL - 1)) * DETAIL + (px & (DETAIL - 1))]! * 0.16;
        r = lerp(SHALLOW[0], DEEP[0], deep) * ripple;
        g = lerp(SHALLOW[1], DEEP[1], deep) * ripple;
        bl = lerp(SHALLOW[2], DEEP[2], deep) * ripple;
        const foam = 1 - smooth(0.5, 0.57, w);
        r = lerp(r, FOAM[0], foam * 0.65);
        g = lerp(g, FOAM[1], foam * 0.65);
        bl = lerp(bl, FOAM[2], foam * 0.65);
      } else {
        // Land: large soft patches, then fine grain.
        const m = noise(px / 140, py / 140, seed + 2);
        const dry = smooth(0.62, 0.8, noise(px / 220, py / 220, seed + 3));
        const dirt = smooth(0.74, 0.86, noise(px / 90, py / 90, seed + 4));
        r = lerp(GRASS[0], GRASS_LIGHT[0], m);
        g = lerp(GRASS[1], GRASS_LIGHT[1], m);
        bl = lerp(GRASS[2], GRASS_LIGHT[2], m);
        r = lerp(r, GRASS_DRY[0], dry * 0.7); g = lerp(g, GRASS_DRY[1], dry * 0.7); bl = lerp(bl, GRASS_DRY[2], dry * 0.7);
        r = lerp(r, DIRT[0], dirt * 0.8); g = lerp(g, DIRT[1], dirt * 0.8); bl = lerp(bl, DIRT[2], dirt * 0.8);
        const shore = smooth(0.3, 0.42, w);
        const wet = smooth(0.43, 0.5, w);
        r = lerp(lerp(r, SAND[0], shore), WET_SAND[0], wet);
        g = lerp(lerp(g, SAND[1], shore), WET_SAND[1], wet);
        bl = lerp(lerp(bl, SAND[2], shore), WET_SAND[2], wet);
        const grain = 0.84 + d * 0.3 + (hash(px, py, seed) - 0.5) * 0.08;
        r *= grain; g *= grain; bl *= grain;
      }
      const i = (py * W + px) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = bl;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  decorate(ctx, cols, rows, water, seed);
  return canvas;
}

/** Grass tufts, flowers and pebbles on land well away from the shore. */
function decorate(ctx: CanvasRenderingContext2D, cols: number, rows: number, water: (x: number, y: number) => number, seed: number): void {
  const P = TERRAIN_PX;
  const rnd = seeded(seed * 7919);
  const s = P / 64;
  ctx.lineCap = "round";
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      let wet = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) wet += water(tx + dx, ty + dy);
      if (wet > 0) continue;
      const n = Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const x = (tx + rnd()) * P, y = (ty + rnd()) * P;
        const roll = rnd();
        if (roll < 0.7) {
          ctx.strokeStyle = `rgba(${40 + rnd() * 30},${76 + rnd() * 30},${28},0.75)`;
          ctx.lineWidth = 3 * s;
          ctx.beginPath();
          for (const lean of [-1, 0, 1]) {
            ctx.moveTo(x + lean * 3 * s, y);
            ctx.lineTo(x + lean * 7 * s, y - (9 + rnd() * 5) * s);
          }
          ctx.stroke();
        } else if (roll < 0.86) {
          const c = ["#f4efe0", "#f2d45c", "#c79be0", "#e8857a"][Math.floor(rnd() * 4)]!;
          for (let f = 0; f < 3; f++) {
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(x + (rnd() - 0.5) * 14 * s, y + (rnd() - 0.5) * 10 * s, 2.6 * s, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          ctx.fillStyle = "rgba(0,0,0,0.25)";
          ctx.beginPath();
          ctx.ellipse(x + 2 * s, y + 2 * s, 6 * s, 4 * s, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#a39d90";
          ctx.beginPath();
          ctx.ellipse(x, y, 6 * s, 4 * s, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#c9c4b8";
          ctx.beginPath();
          ctx.ellipse(x - 1.5 * s, y - 1.2 * s, 2.5 * s, 1.5 * s, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
}
