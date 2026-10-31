// Original procedural art: every sprite is painted with Canvas 2D the first
// time it's needed, so there are no image files to download or license.
// Light comes from the top left; units and buildings are seen from the front
// and slightly above, like a stage, while the ground is seen straight down.
import type Phaser from "phaser";
import { BUILDINGS, T, TILE } from "@koe/sim";

/** Texture pixels per world unit, so sprites stay sharp when zoomed in. */
export const RES = 2;
const INK = "#24180f";
const TAU = Math.PI * 2;

type Ctx = CanvasRenderingContext2D;
type Fill = string | CanvasGradient;

// ------------------------------------------------------------ colour helpers

const ch = (c: number, shift: number) => (c >> shift) & 255;
export function mix(a: number, b: number, t: number): number {
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}
const light = (c: number, t: number) => mix(c, 0xffffff, t);
const dark = (c: number, t: number) => mix(c, 0x000000, t);
const css = (c: number, a = 1) => `rgba(${ch(c, 16)},${ch(c, 8)},${ch(c, 0)},${a})`;

/** Seeded RNG, so procedural details look the same on every load. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------ drawing helpers

function texture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: Ctx) => void): string {
  if (scene.textures.exists(key)) return key;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * RES);
  canvas.height = Math.ceil(h * RES);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(RES, RES);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  draw(ctx);
  scene.textures.addCanvas(key, canvas);
  return key;
}

function poly(ctx: Ctx, pts: number[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
  ctx.closePath();
}

function fill(ctx: Ctx, style: Fill, lw = 1.3): void {
  ctx.fillStyle = style;
  ctx.fill();
  if (lw > 0) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

function circle(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
}

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
}

function rect(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
}

function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, color: string, w: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
}

/** A line with a dark outline, for limbs, shafts and posts. */
function stick(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, color: number, w: number): void {
  line(ctx, x0, y0, x1, y1, INK, w + 2);
  line(ctx, x0, y0, x1, y1, css(color), w);
}

function vgrad(ctx: Ctx, y0: number, y1: number, top: number, bottom: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, css(top));
  g.addColorStop(1, css(bottom));
  return g;
}

function hgrad(ctx: Ctx, x0: number, x1: number, left: number, right: number): CanvasGradient {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, css(left));
  g.addColorStop(1, css(right));
  return g;
}

/** Lit from the top left: a highlight off-centre, darker at the rim. */
function ball(ctx: Ctx, x: number, y: number, r: number, base: number): CanvasGradient {
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.1, x, y, r);
  g.addColorStop(0, css(light(base, 0.35)));
  g.addColorStop(0.55, css(base));
  g.addColorStop(1, css(dark(base, 0.35)));
  return g;
}

function softShadow(ctx: Ctx, x: number, y: number, rx: number, ry: number, alpha = 0.3): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
  g.addColorStop(0, `rgba(0,0,0,${alpha})`);
  g.addColorStop(0.7, `rgba(0,0,0,${alpha * 0.6})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  ctx.translate(-x, -y);
  circle(ctx, x, y, rx);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------ units

export const UNIT_W = 88;
export const UNIT_H = 88;
const UNIT_FOOT = 78;
/** Units are drawn with their feet this far below their position, so the body sits on it. */
export const FOOT_OFFSET = 10;
/** Height of a unit's head above its feet, for health bars and picking. */
export const UNIT_HEIGHT = 54;
export const unitOrigin = { x: 0.5, y: UNIT_FOOT / UNIT_H };

/** 0 standing, 1-2 walking, 3 striking (or the swing of a tool). */
export type Frame = 0 | 1 | 2 | 3;

const UNIT_SCALE: Record<number, number> = {
  [T.Villager]: 1, [T.Spearman]: 1.08, [T.Swordsman]: 1.12, [T.Archer]: 1.06, [T.Scout]: 1.08,
};

const SKIN = 0xd9a77c;
const LEATHER = 0x6b4a2b;
const WOOD = 0x8a5a2e;
const STEEL = 0xb8c0c8;

export function unitTexture(scene: Phaser.Scene, type: number, slot: number, color: number, frame: Frame, carrying = false): string {
  const key = `u${type}_${slot}_${frame}${carrying ? "c" : ""}`;
  return texture(scene, key, UNIT_W, UNIT_H, (ctx) => {
    ctx.translate(UNIT_W / 2, UNIT_FOOT);
    const s = UNIT_SCALE[type] ?? 1;
    ctx.scale(s, s);
    if (type === T.Scout) drawRider(ctx, color, frame);
    else drawPerson(ctx, type, color, frame, carrying);
  });
}

function boot(ctx: Ctx, x: number, y: number): void {
  ellipse(ctx, x + 1.2, y, 3.2, 1.9);
  fill(ctx, css(0x3a2616), 1);
}

function hand(ctx: Ctx, x: number, y: number): void {
  circle(ctx, x, y, 2.1);
  fill(ctx, css(SKIN), 1);
}

/** Arm from shoulder to hand, sleeve-coloured. */
function arm(ctx: Ctx, sx: number, sy: number, hx: number, hy: number, sleeve: number): void {
  stick(ctx, sx, sy, hx, hy, sleeve, 3.6);
  hand(ctx, hx, hy);
}

function drawPerson(ctx: Ctx, type: number, color: number, frame: Frame, carrying: boolean): void {
  const villager = type === T.Villager;
  const tunic = villager ? mix(color, 0x9a7a52, 0.5) : color;
  const sleeve = type === T.Swordsman ? 0x8e969e : dark(tunic, 0.15);
  const legs = type === T.Swordsman ? 0x5b6168 : 0x4d3b28;
  const stride = frame === 1 ? 6 : frame === 2 ? -5 : frame === 3 ? 7 : 3;

  // Legs, the far one darker.
  stick(ctx, -1.5, -15, -stride - 0.5, -2, dark(legs, 0.25), 4.2);
  boot(ctx, -stride - 0.5, -1.5);
  stick(ctx, 1.5, -15, stride + 0.5, -2, legs, 4.2);
  boot(ctx, stride + 0.5, -1.5);

  // Things carried on the back.
  if (type === T.Archer) {
    ctx.save();
    ctx.translate(-6, -22);
    ctx.rotate(-0.35);
    rect(ctx, -3, -10, 6, 17);
    fill(ctx, css(LEATHER), 1.1);
    for (const fx of [-1.6, 0.4, 2.2]) line(ctx, fx, -10, fx, -14, css(0xe8e0d0), 1.6);
    ctx.restore();
  }
  if (carrying) {
    ellipse(ctx, -8, -23, 6, 7.5, -0.3);
    fill(ctx, ball(ctx, -8, -23, 7.5, 0xc9b07a), 1.1);
    line(ctx, -9, -29.5, -5, -30, INK, 1.1);
  }

  // Far arm.
  const farHand: [number, number] =
    type === T.Archer && frame === 3 ? [-1, -25] : type === T.Spearman || type === T.Swordsman ? [-6, -19] : [-5 - stride * 0.4, -16];
  arm(ctx, -3, -27, farHand[0], farHand[1], dark(sleeve, 0.2));

  // Body: a tunic, lit from the left, with a belt.
  poly(ctx, [-6.5, -29.5, 6.5, -29.5, 8.6, -11, -8.6, -11]);
  fill(ctx, hgrad(ctx, -8, 8, light(tunic, 0.25), dark(tunic, 0.22)));
  rect(ctx, -8, -18, 16, 2.6);
  fill(ctx, css(LEATHER), 0.8);
  if (type === T.Swordsman) {
    // Mail showing at the neck and hem.
    rect(ctx, -5.5, -30.5, 11, 3);
    fill(ctx, css(STEEL), 0.8);
    rect(ctx, -8.4, -12.5, 16.8, 2);
    fill(ctx, css(0x9aa2aa), 0.8);
    // White cross on the surcoat.
    line(ctx, 0, -27, 0, -19.5, css(0xf4efe4), 1.8);
    line(ctx, -3, -24, 3, -24, css(0xf4efe4), 1.8);
  }

  // Shields, held on the far arm, in front of the body.
  if (type === T.Spearman) {
    circle(ctx, -7, -20, 7);
    fill(ctx, ball(ctx, -7, -20, 7, color), 1.3);
    circle(ctx, -7, -20, 4.8);
    ctx.strokeStyle = css(dark(color, 0.4));
    ctx.lineWidth = 1;
    ctx.stroke();
    circle(ctx, -7, -20, 1.8);
    fill(ctx, css(STEEL), 0.8);
  }
  if (type === T.Swordsman) {
    poly(ctx, [-13.5, -28, -0.5, -28, -0.5, -19, -7, -10, -13.5, -19]);
    fill(ctx, hgrad(ctx, -14, 0, light(color, 0.2), dark(color, 0.25)), 1.4);
    line(ctx, -7, -26.5, -7, -13, css(0xf4efe4), 2);
    line(ctx, -12, -22, -2, -22, css(0xf4efe4), 2);
  }

  drawHead(ctx, type, color);

  // Near arm and the tool or weapon in that hand.
  switch (type) {
    case T.Villager:
      if (frame === 3) {
        arm(ctx, 3, -27, 11, -22, sleeve);
        stick(ctx, 10, -22, 22, -9, WOOD, 2);
        poly(ctx, [20, -12, 26, -10, 23, -5, 19, -8]);
        fill(ctx, css(STEEL), 1);
      } else {
        arm(ctx, 3, -27, 7, -21, sleeve);
        stick(ctx, 8, -19, -5, -40, WOOD, 2);
        poly(ctx, [-8, -38, -3, -42, -1, -37, -5, -35]);
        fill(ctx, css(STEEL), 1);
      }
      break;
    case T.Spearman:
      if (frame === 3) {
        stick(ctx, -8, -24, 28, -23, WOOD, 2);
        poly(ctx, [28, -25.5, 35, -23, 28, -20.5]);
        fill(ctx, css(STEEL), 1);
        arm(ctx, 3, -27, 13, -23.5, sleeve);
      } else {
        stick(ctx, 9.5, -3, 9.5, -52, WOOD, 2);
        poly(ctx, [7.5, -52, 9.5, -60, 11.5, -52]);
        fill(ctx, css(STEEL), 1);
        arm(ctx, 3, -27, 9, -20, sleeve);
      }
      break;
    case T.Swordsman:
      if (frame === 3) {
        arm(ctx, 3, -27, 13, -25, sleeve);
        stick(ctx, 14, -24.5, 31, -17, 0xdfe5ea, 2.4);
        line(ctx, 12, -29, 15, -21, INK, 2.6);
      } else {
        arm(ctx, 3, -27, 9, -19, sleeve);
        stick(ctx, 10, -21, 13, -42, 0xdfe5ea, 2.4);
        line(ctx, 6.5, -22.5, 13.5, -20.5, INK, 2.6);
      }
      break;
    case T.Archer:
      if (frame === 3) {
        ctx.beginPath();
        ctx.arc(7, -25, 14, -1.15, 1.15);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 3.6;
        ctx.stroke();
        ctx.strokeStyle = css(WOOD);
        ctx.lineWidth = 1.9;
        ctx.stroke();
        line(ctx, 12.7, -37.8, -1, -25, css(0xeee6d4), 0.8);
        line(ctx, 12.7, -12.2, -1, -25, css(0xeee6d4), 0.8);
        line(ctx, -1, -25, 24, -25, css(0x5a3d22), 1.3);
        poly(ctx, [24, -27, 28, -25, 24, -23]);
        fill(ctx, css(STEEL), 0.8);
        arm(ctx, 3, -27, 20, -25, sleeve);
      } else {
        ctx.beginPath();
        ctx.arc(3, -23, 15, -1.1, 1.1);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 3.6;
        ctx.stroke();
        ctx.strokeStyle = css(WOOD);
        ctx.lineWidth = 1.9;
        ctx.stroke();
        line(ctx, 9.8, -36.4, 9.8, -9.6, css(0xeee6d4), 0.8);
        arm(ctx, 3, -27, 13, -23, sleeve);
      }
      break;
  }
}

function drawHead(ctx: Ctx, type: number, color: number): void {
  const hx = 1, hy = -35.5;
  if (type === T.Archer) {
    // Hood with a little point at the back.
    poly(ctx, [hx - 8, hy + 1, hx - 11, hy + 6, hx - 5, hy + 7]);
    fill(ctx, css(0x4f5e30), 1);
    circle(ctx, hx - 0.5, hy, 7.2);
    fill(ctx, ball(ctx, hx - 0.5, hy, 7.2, 0x5b6b36), 1.2);
    ellipse(ctx, hx + 2.6, hy + 1, 3.8, 4.6);
    fill(ctx, css(SKIN), 0.9);
  } else {
    circle(ctx, hx, hy, 6.2);
    fill(ctx, ball(ctx, hx, hy, 6.2, SKIN), 1.2);
  }
  circle(ctx, hx + 3.6, hy - 0.2, 0.95);
  ctx.fillStyle = INK;
  ctx.fill();

  switch (type) {
    case T.Villager:
      // Straw hat.
      ellipse(ctx, hx, hy - 3.5, 10, 2.8);
      fill(ctx, css(0xd8b866), 1.1);
      ellipse(ctx, hx - 0.5, hy - 5.5, 5.5, 3.6);
      fill(ctx, ball(ctx, hx - 0.5, hy - 5.5, 5.5, 0xe2c677), 1.1);
      line(ctx, hx - 5.5, hy - 4, hx + 4.5, hy - 4, css(dark(color, 0.1)), 1.4);
      break;
    case T.Spearman:
      ctx.beginPath();
      ctx.arc(hx, hy - 0.5, 6.6, Math.PI * 1.02, Math.PI * 1.98);
      ctx.closePath();
      fill(ctx, css(0x7b5532), 1.1);
      line(ctx, hx - 6.6, hy - 0.7, hx + 6.6, hy - 0.7, css(0x5a3c22), 1.6);
      break;
    case T.Swordsman:
      ctx.beginPath();
      ctx.arc(hx, hy - 0.2, 6.9, Math.PI * 0.92, Math.PI * 2.02);
      ctx.lineTo(hx - 6.6, hy + 4);
      ctx.closePath();
      fill(ctx, ball(ctx, hx, hy - 2, 7, STEEL), 1.2);
      line(ctx, hx + 3.8, hy - 2, hx + 3.8, hy + 3.4, INK, 1.8);
      line(ctx, hx + 3.8, hy - 2, hx + 3.8, hy + 3.4, css(STEEL), 0.9);
      break;
  }
}

function drawRider(ctx: Ctx, color: number, frame: Frame): void {
  const coat = 0x8b5a34;
  const mane = 0x3b2516;
  const swing = frame === 1 || frame === 3 ? 5 : frame === 2 ? -4 : 0;

  // Tail and the far legs.
  ctx.beginPath();
  ctx.moveTo(-15, -25);
  ctx.quadraticCurveTo(-24, -22, -21, -9);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = css(mane);
  ctx.lineWidth = 3;
  ctx.stroke();
  stick(ctx, -11, -18, -11 - swing, -2, dark(coat, 0.3), 3);
  stick(ctx, 8, -18, 8 + swing, -2, dark(coat, 0.3), 3);
  for (const x of [-11 - swing, 8 + swing]) boot(ctx, x - 1, -1.5);

  // Body, near legs, neck and head.
  ellipse(ctx, -2, -22, 15.5, 7.8);
  fill(ctx, ball(ctx, -2, -22, 15.5, coat), 1.4);
  stick(ctx, -8, -18, -8 + swing, -2, coat, 3.2);
  stick(ctx, 11, -18, 11 - swing, -2, coat, 3.2);
  for (const x of [-8 + swing, 11 - swing]) boot(ctx, x - 1, -1.5);
  poly(ctx, [7, -26, 13, -41, 19.5, -38, 15, -21]);
  fill(ctx, hgrad(ctx, 7, 19, light(coat, 0.15), dark(coat, 0.15)), 1.3);
  ellipse(ctx, 20, -38.5, 7, 3.8, 0.45);
  fill(ctx, ball(ctx, 20, -38.5, 7, coat), 1.3);
  poly(ctx, [14, -42, 15.5, -47, 17.5, -41.5]);
  fill(ctx, css(coat), 1);
  ctx.beginPath();
  ctx.moveTo(8, -27);
  ctx.quadraticCurveTo(10, -38, 14.5, -42);
  ctx.strokeStyle = css(mane);
  ctx.lineWidth = 2.6;
  ctx.stroke();
  circle(ctx, 19.5, -40, 0.9);
  ctx.fillStyle = INK;
  ctx.fill();

  // Saddle cloth in the player's colour.
  ctx.beginPath();
  ctx.roundRect(-9, -30, 15, 11, 2.5);
  fill(ctx, hgrad(ctx, -9, 6, light(color, 0.15), dark(color, 0.2)), 1.2);
  line(ctx, -8, -21, 5, -21, css(light(color, 0.45)), 1.2);

  // Rider.
  stick(ctx, -1, -29, 2.5, -19, 0x4d3b28, 3.6);
  boot(ctx, 2.5, -18.5);
  poly(ctx, [-5, -44, 4, -44, 5.5, -28, -6, -28]);
  fill(ctx, hgrad(ctx, -6, 6, light(color, 0.25), dark(color, 0.22)));
  circle(ctx, 0, -49, 5.6);
  fill(ctx, ball(ctx, 0, -49, 5.6, SKIN), 1.2);
  ctx.beginPath();
  ctx.arc(0, -49.5, 6.2, Math.PI * 0.95, Math.PI * 2.02);
  ctx.closePath();
  fill(ctx, ball(ctx, 0, -52, 6, STEEL), 1.1);
  ctx.beginPath();
  ctx.moveTo(-2, -55.5);
  ctx.quadraticCurveTo(-7, -60, -11, -55);
  ctx.strokeStyle = css(light(color, 0.1));
  ctx.lineWidth = 2.6;
  ctx.stroke();
  circle(ctx, 3.2, -49.2, 0.9);
  ctx.fillStyle = INK;
  ctx.fill();

  if (frame === 3) {
    stick(ctx, -10, -38, 30, -31, WOOD, 1.9);
    poly(ctx, [30, -33, 36, -30.5, 30, -29]);
    fill(ctx, css(STEEL), 0.9);
    arm(ctx, 2, -41, 9, -35, dark(color, 0.15));
  } else {
    stick(ctx, 8, -24, 9, -62, WOOD, 1.9);
    poly(ctx, [7.3, -62, 9.1, -68, 10.8, -62]);
    fill(ctx, css(STEEL), 0.9);
    poly(ctx, [9.5, -60, 18, -58, 9.5, -55]);
    fill(ctx, css(color), 0.8);
    arm(ctx, 2, -41, 8.5, -36, dark(color, 0.15));
  }
}

// ------------------------------------------------------------ buildings

const RISE = 0.42;
const PAD = 18;

/** Texture size and where the footprint sits in it (buildings rise above their footprint). */
export function buildingGeometry(type: number): { F: number; rise: number; w: number; h: number; originX: number; originY: number } {
  const F = (BUILDINGS[type]?.size ?? 1) * TILE;
  const flat = type === T.Farm;
  const rise = flat ? 0 : Math.round(F * RISE);
  const pad = flat ? 0 : PAD;
  const w = F + pad, h = rise + F + pad / 2;
  return { F, rise, w, h, originX: F / 2 / w, originY: (rise + F) / h };
}

const roofOf = (color: number) => mix(color, 0x6e4c34, 0.38);
const PLASTER = 0xe7d8b4;
const TIMBER = 0x5e3d22;
const STONE = 0x9c968a;
const DIRT = 0x8f7350;

export function buildingTexture(scene: Phaser.Scene, type: number, slot: number, color: number): string {
  const g = buildingGeometry(type);
  return texture(scene, `b${type}_${slot}`, g.w, g.h, (ctx) => {
    const { F, rise } = g;
    if (type === T.Farm) return drawFarm(ctx, F);
    ctx.translate(0, rise);
    groundPatch(ctx, F);
    // Shadow falls to the bottom right, soft at the edges.
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.roundRect(F * 0.2 + i * 2, F * 0.22 + i * 2, F * 0.8 + 14 - i * 4, F * 0.76 - i * 4, 14);
      ctx.fillStyle = "rgba(0,0,0,0.05)";
      ctx.fill();
    }
    ctx.translate(0, -rise);
    switch (type) {
      case T.TownCenter: return drawTownCenter(ctx, F, rise, color);
      case T.House: return drawHouse(ctx, F, rise, color);
      case T.Storehouse: return drawStorehouse(ctx, F, rise, color);
      case T.Barracks: return drawBarracks(ctx, F, rise, color);
      case T.ArcheryRange: return drawArcheryRange(ctx, F, rise, color);
    }
  });
}

function groundPatch(ctx: Ctx, F: number): void {
  const g = ctx.createRadialGradient(F / 2, F * 0.62, F * 0.2, F / 2, F * 0.6, F * 0.62);
  g.addColorStop(0, css(DIRT, 0.85));
  g.addColorStop(0.75, css(DIRT, 0.55));
  g.addColorStop(1, css(DIRT, 0));
  ctx.beginPath();
  ctx.roundRect(0, F * 0.08, F, F * 0.92, F * 0.3);
  ctx.fillStyle = g;
  ctx.fill();
}

/** Front-facing gable roof: dark back slope above the ridge, tiled front slope below it. */
function gableRoof(ctx: Ctx, x0: number, x1: number, topY: number, ridgeY: number, eaveY: number, inset: number, color: number): void {
  poly(ctx, [x0 + inset * 1.6, topY, x1 - inset * 1.6, topY, x1 - inset, ridgeY, x0 + inset, ridgeY]);
  fill(ctx, vgrad(ctx, topY, ridgeY, dark(color, 0.45), dark(color, 0.3)));
  poly(ctx, [x0 + inset, ridgeY, x1 - inset, ridgeY, x1, eaveY, x0, eaveY]);
  fill(ctx, vgrad(ctx, ridgeY, eaveY, light(color, 0.18), dark(color, 0.18)));
  ctx.save();
  poly(ctx, [x0 + inset, ridgeY, x1 - inset, ridgeY, x1, eaveY, x0, eaveY]);
  ctx.clip();
  const step = 7.5;
  for (let y = ridgeY + step, row = 0; y < eaveY; y += step, row++) {
    line(ctx, x0, y, x1, y, css(dark(color, 0.45), 0.55), 1);
    for (let x = x0 + (row % 2) * 5; x < x1; x += 10) line(ctx, x, y - step, x, y, css(dark(color, 0.4), 0.35), 0.8);
  }
  ctx.restore();
  poly(ctx, [x0 + inset, ridgeY, x1 - inset, ridgeY, x1, eaveY, x0, eaveY]);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  stick(ctx, x0 + inset, ridgeY, x1 - inset, ridgeY, dark(color, 0.5), 2.4);
}

function stoneWall(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, base = STONE): void {
  rect(ctx, x0, y0, x1 - x0, y1 - y0);
  fill(ctx, vgrad(ctx, y0, y1, light(base, 0.12), dark(base, 0.2)));
  ctx.save();
  rect(ctx, x0, y0, x1 - x0, y1 - y0);
  ctx.clip();
  const rnd = seeded(Math.round(x0 * 31 + y0));
  for (let y = y0 + 7, row = 0; y < y1 + 7; y += 7, row++) {
    line(ctx, x0, y, x1, y, css(dark(base, 0.4), 0.6), 0.9);
    for (let x = x0 + (row % 2) * 6 + rnd() * 3; x < x1; x += 11 + rnd() * 3) line(ctx, x, y - 7, x, y, css(dark(base, 0.4), 0.6), 0.9);
  }
  ctx.restore();
  rect(ctx, x0, y0, x1 - x0, y1 - y0);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.3;
  ctx.stroke();
}

function timberWall(ctx: Ctx, x0: number, y0: number, x1: number, y1: number): void {
  rect(ctx, x0, y0, x1 - x0, y1 - y0);
  fill(ctx, vgrad(ctx, y0, y1, PLASTER, dark(PLASTER, 0.15)));
  const beam = css(TIMBER);
  line(ctx, x0, y0 + 1.5, x1, y0 + 1.5, beam, 3);
  line(ctx, x0, y1 - 1.5, x1, y1 - 1.5, beam, 3);
  const n = Math.max(2, Math.round((x1 - x0) / 30));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    line(ctx, x, y0, x, y1, beam, 2.6);
    if (i < n && i % 2 === 0) line(ctx, x, y1, x + (x1 - x0) / n, y0, beam, 2);
  }
  rect(ctx, x0, y0, x1 - x0, y1 - y0);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.3;
  ctx.stroke();
}

function door(ctx: Ctx, cx: number, bottom: number, w: number, h: number, arch = true): void {
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, bottom);
  ctx.lineTo(cx - w / 2, bottom - h + (arch ? w / 2 : 0));
  if (arch) ctx.arc(cx, bottom - h + w / 2, w / 2, Math.PI, 0);
  else ctx.lineTo(cx + w / 2, bottom - h);
  ctx.lineTo(cx + w / 2, bottom);
  ctx.closePath();
  fill(ctx, vgrad(ctx, bottom - h, bottom, 0x6a4526, 0x4a2f1a), 1.4);
  for (let x = cx - w / 2 + w / 4; x < cx + w / 2 - 1; x += w / 4) line(ctx, x, bottom - h + w / 3, x, bottom, css(0x3a2414, 0.8), 0.9);
  circle(ctx, cx + w / 4, bottom - h * 0.45, 1.2);
  ctx.fillStyle = css(0xd4b04a);
  ctx.fill();
}

function windowAt(ctx: Ctx, cx: number, cy: number, w: number, h: number): void {
  rect(ctx, cx - w / 2, cy - h / 2, w, h);
  fill(ctx, vgrad(ctx, cy - h / 2, cy + h / 2, 0x3d4a52, 0x1e262c), 1.2);
  line(ctx, cx, cy - h / 2, cx, cy + h / 2, css(TIMBER), 1.2);
  line(ctx, cx - w / 2, cy, cx + w / 2, cy, css(TIMBER), 1.2);
}

function banner(ctx: Ctx, x: number, top: number, len: number, color: number): void {
  stick(ctx, x, top + len, x, top, 0x4a3320, 1.6);
  circle(ctx, x, top - 1, 1.6);
  fill(ctx, css(0xd4b04a), 0.8);
  ctx.beginPath();
  ctx.moveTo(x + 1, top + 1);
  ctx.quadraticCurveTo(x + 9, top - 1, x + 17, top + 3);
  ctx.lineTo(x + 14, top + 7);
  ctx.lineTo(x + 17, top + 11);
  ctx.quadraticCurveTo(x + 9, top + 8, x + 1, top + 11);
  ctx.closePath();
  fill(ctx, hgrad(ctx, x, x + 17, light(color, 0.15), dark(color, 0.2)), 1.1);
}

function drawHouse(ctx: Ctx, F: number, rise: number, color: number): void {
  const wallTop = rise + F * 0.46, wallBottom = rise + F * 0.88;
  timberWall(ctx, 18, wallTop, F - 18, wallBottom);
  windowAt(ctx, 34, wallTop + (wallBottom - wallTop) * 0.45, 13, 12);
  windowAt(ctx, F - 34, wallTop + (wallBottom - wallTop) * 0.45, 13, 12);
  door(ctx, F / 2, wallBottom, 16, 27);
  gableRoof(ctx, 8, F - 8, rise * 0.25, rise * 0.62, wallTop + 3, 12, roofOf(color));
  stoneWall(ctx, F - 44, rise * 0.1, F - 32, rise * 0.62, 0x8a8478);
  rect(ctx, F - 46, rise * 0.06, 16, 4);
  fill(ctx, css(0x6f6a60), 1.1);
}

function drawTownCenter(ctx: Ctx, F: number, rise: number, color: number): void {
  const roof = roofOf(color);
  const wallTop = rise + F * 0.42, wallBottom = rise + F * 0.86;
  stoneWall(ctx, 30, wallTop, F - 30, wallBottom);
  door(ctx, F / 2, wallBottom, 30, 44);
  for (const x of [56, F - 56]) windowAt(ctx, x, wallTop + 22, 12, 16);
  // Steps in front of the door.
  rect(ctx, F / 2 - 22, wallBottom, 44, 5);
  fill(ctx, css(0xb3ad9f), 1.1);
  gableRoof(ctx, 22, F - 22, rise * 0.3, rise * 0.9, wallTop + 4, 26, roof);
  banner(ctx, F / 2, rise * 0.02, rise * 0.9, color);

  // Round towers on the front corners with cone roofs.
  for (const cx of [27, F - 27]) {
    const tw = 34, top = rise + F * 0.24, bottom = rise + F * 0.9;
    rect(ctx, cx - tw / 2, top, tw, bottom - top);
    fill(ctx, hgrad(ctx, cx - tw / 2, cx + tw / 2, light(STONE, 0.18), dark(STONE, 0.32)));
    ctx.save();
    rect(ctx, cx - tw / 2, top, tw, bottom - top);
    ctx.clip();
    for (let y = top + 8, row = 0; y < bottom; y += 8, row++) {
      line(ctx, cx - tw / 2, y, cx + tw / 2, y, css(dark(STONE, 0.45), 0.55), 0.9);
      for (let x = cx - tw / 2 + (row % 2) * 6; x < cx + tw / 2; x += 12) line(ctx, x, y - 8, x, y, css(dark(STONE, 0.45), 0.5), 0.9);
    }
    ctx.restore();
    ellipse(ctx, cx, bottom, tw / 2, 4.5);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.3;
    ctx.stroke();
    rect(ctx, cx - tw / 2, top, tw, bottom - top);
    ctx.stroke();
    rect(ctx, cx - 2.5, top + 22, 5, 12);
    fill(ctx, css(0x1e262c), 1);
    rect(ctx, cx - 2.5, top + 52, 5, 12);
    fill(ctx, css(0x1e262c), 1);
    // Cone roof.
    ctx.beginPath();
    ctx.moveTo(cx, rise * 0.05);
    ctx.lineTo(cx + tw / 2 + 5, top + 2);
    ctx.quadraticCurveTo(cx, top + 9, cx - tw / 2 - 5, top + 2);
    ctx.closePath();
    fill(ctx, hgrad(ctx, cx - tw / 2, cx + tw / 2, light(roof, 0.2), dark(roof, 0.35)), 1.4);
    banner(ctx, cx, rise * 0.05 - 14, 14, color);
  }
}

function drawStorehouse(ctx: Ctx, F: number, rise: number, color: number): void {
  const wallTop = rise + F * 0.44, wallBottom = rise + F * 0.86;
  rect(ctx, 14, wallTop, F - 28, wallBottom - wallTop);
  fill(ctx, hgrad(ctx, 14, F - 14, 0xa06a3a, 0x6e4626));
  for (let x = 20; x < F - 14; x += 7) line(ctx, x, wallTop, x, wallBottom, css(0x4a2e18, 0.6), 0.9);
  rect(ctx, 14, wallTop, F - 28, wallBottom - wallTop);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.3;
  ctx.stroke();
  // Open front with sacks inside.
  rect(ctx, F / 2 - 24, wallTop + 10, 48, wallBottom - wallTop - 10);
  fill(ctx, css(0x24170d), 1.3);
  for (const [x, y] of [[F / 2 - 12, wallBottom - 6], [F / 2 + 2, wallBottom - 5], [F / 2 + 14, wallBottom - 7]] as const) {
    ellipse(ctx, x, y, 7, 6);
    fill(ctx, ball(ctx, x, y, 7, 0xc9b07a), 1);
  }
  gableRoof(ctx, 6, F - 6, rise * 0.3, rise * 0.7, wallTop + 3, 12, 0x8a5e36);
  line(ctx, 6, wallTop + 2, F - 6, wallTop + 2, css(color), 3);
  // Crates and a barrel outside.
  for (const [x, y, s] of [[2, wallBottom - 14, 15], [6, wallBottom - 28, 13], [17, wallBottom - 9, 12]] as const) {
    rect(ctx, x, y, s, s);
    fill(ctx, vgrad(ctx, y, y + s, 0xb98652, 0x7c5531), 1.2);
    line(ctx, x, y, x + s, y + s, css(0x5a3c22), 1);
  }
  rect(ctx, F - 26, wallBottom - 20, 15, 20);
  fill(ctx, hgrad(ctx, F - 26, F - 11, 0xa8744a, 0x6a4526), 1.2);
  for (const y of [wallBottom - 16, wallBottom - 5]) line(ctx, F - 26, y, F - 11, y, css(0x55585c), 1.6);
}

function drawBarracks(ctx: Ctx, F: number, rise: number, color: number): void {
  const wallTop = rise + F * 0.42, wallBottom = rise + F * 0.86;
  const mid = wallTop + (wallBottom - wallTop) * 0.45;
  timberWall(ctx, 16, wallTop, F - 16, mid);
  stoneWall(ctx, 16, mid, F - 16, wallBottom, 0x8e877b);
  door(ctx, F / 2, wallBottom, 32, 40, false);
  line(ctx, F / 2, wallBottom - 40, F / 2, wallBottom, css(0x3a2414), 1.4);
  // Shields hung on the wall.
  for (const x of [40, F - 40, 64, F - 64]) {
    const y = wallTop + 16;
    circle(ctx, x, y, 7.5);
    fill(ctx, ball(ctx, x, y, 7.5, color), 1.2);
    circle(ctx, x, y, 2);
    fill(ctx, css(STEEL), 0.8);
  }
  gableRoof(ctx, 8, F - 8, rise * 0.25, rise * 0.8, wallTop + 4, 18, dark(roofOf(color), 0.12));
  banner(ctx, 30, rise * 0.1, rise * 0.7, color);
  // Weapon rack at the side.
  const rx = F - 12, ry = wallBottom + 2;
  stick(ctx, rx - 10, ry, rx + 6, ry, WOOD, 2);
  for (let i = 0; i < 3; i++) {
    stick(ctx, rx - 8 + i * 6, ry, rx - 4 + i * 6, ry - 30, WOOD, 1.4);
    poly(ctx, [rx - 5.5 + i * 6, ry - 30, rx - 3.6 + i * 6, ry - 36, rx - 2.4 + i * 6, ry - 30]);
    fill(ctx, css(STEEL), 0.8);
  }
}

function drawArcheryRange(ctx: Ctx, F: number, rise: number, color: number): void {
  // Fenced yard.
  const top = rise + F * 0.1, bottom = rise + F * 0.92;
  for (const y of [top, bottom]) stick(ctx, 6, y, F - 6, y, 0x9a6a3c, 1.6);
  for (const x of [6, F - 6]) stick(ctx, x, top, x, bottom, 0x9a6a3c, 1.6);
  for (let x = 6; x <= F - 6; x += 23) for (const y of [top, bottom]) stick(ctx, x, y + 2, x, y - 8, 0x7a5030, 2.4);

  // Long open shooting shed along the back.
  const eave = rise + F * 0.4;
  for (let x = 20; x <= F - 20; x += (F - 40) / 4) stick(ctx, x, eave, x, rise + F * 0.55, 0x6a4526, 3);
  rect(ctx, 20, eave, F - 40, F * 0.15);
  ctx.fillStyle = "rgba(20,12,6,0.4)";
  ctx.fill();
  gableRoof(ctx, 8, F - 8, rise * 0.45, rise * 0.95, eave + 2, 14, 0xbf9a52);
  line(ctx, 8, eave + 1, F - 8, eave + 1, css(color), 3);
  banner(ctx, F / 2, rise * 0.1, rise * 0.85, color);

  // Targets down the yard, and hay bales.
  for (const tx of [F * 0.3, F * 0.7]) {
    const ty = rise + F * 0.74;
    stick(ctx, tx - 6, ty + 10, tx - 9, ty + 19, WOOD, 1.8);
    stick(ctx, tx + 6, ty + 10, tx + 9, ty + 19, WOOD, 1.8);
    circle(ctx, tx, ty, 14);
    fill(ctx, ball(ctx, tx, ty, 14, 0xd9c48a), 1.4);
    for (const [r, c] of [[10.5, 0xf4efe4], [7.5, 0xc43a3a], [4.5, 0xf4efe4], [2, 0xd4a72c]] as const) {
      circle(ctx, tx, ty, r);
      ctx.fillStyle = css(c);
      ctx.fill();
    }
    line(ctx, tx - 3, ty - 2, tx - 9, ty - 12, css(0x5a3d22), 1.2);
  }
  for (const [x, y] of [[F * 0.5, rise + F * 0.82], [F - 22, rise + F * 0.66]] as const) {
    ctx.beginPath();
    ctx.roundRect(x - 9, y - 7, 18, 13, 3);
    fill(ctx, vgrad(ctx, y - 7, y + 6, 0xe2c677, 0xb3913f), 1.2);
  }
}

function drawFarm(ctx: Ctx, F: number): void {
  ctx.beginPath();
  ctx.roundRect(3, 3, F - 6, F - 6, 6);
  fill(ctx, vgrad(ctx, 0, F, 0x8a6a40, 0x6e5232), 0);
  const rnd = seeded(7);
  for (let y = 14; y < F - 8; y += 12) {
    line(ctx, 9, y + 3, F - 9, y + 3, css(0x5a4128, 0.8), 2.5);
    for (let x = 12; x < F - 10; x += 6 + rnd() * 3) {
      const h = 5 + rnd() * 3;
      line(ctx, x, y + 2, x - 1.5, y - h, css(0x8fa83a), 1.6);
      line(ctx, x, y + 2, x + 1.8, y - h + 1, css(0xb7b84a), 1.4);
      circle(ctx, x - 1.5, y - h, 1.4);
      ctx.fillStyle = css(0xd9c25a);
      ctx.fill();
    }
  }
  // Fence posts and rails.
  ctx.beginPath();
  ctx.roundRect(3, 3, F - 6, F - 6, 6);
  ctx.strokeStyle = css(0x7a5030);
  ctx.lineWidth = 2.2;
  ctx.stroke();
  for (let i = 0; i <= 4; i++) {
    const p = 4 + ((F - 8) * i) / 4;
    for (const [x, y] of [[p, 4], [p, F - 4], [4, p], [F - 4, p]] as const) {
      circle(ctx, x, y, 2.4);
      fill(ctx, css(0x6a4526), 1);
    }
  }
}

/** Staked-out ground shown while a building goes up. */
export function foundationTexture(scene: Phaser.Scene, size: number): string {
  const F = size * TILE;
  return texture(scene, `f${size}`, F, F, (ctx) => {
    ctx.beginPath();
    ctx.roundRect(4, 4, F - 8, F - 8, 8);
    fill(ctx, css(0x9a7c55, 0.9), 0);
    const rnd = seeded(size);
    for (let i = 0; i < size * 10; i++) {
      ellipse(ctx, 8 + rnd() * (F - 16), 8 + rnd() * (F - 16), 2 + rnd() * 3, 1.5 + rnd() * 2);
      ctx.fillStyle = css(rnd() > 0.5 ? 0x7d6343 : 0xb09670, 0.8);
      ctx.fill();
    }
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.rect(9, 9, F - 18, F - 18);
    ctx.strokeStyle = css(0xe8dcc0);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.setLineDash([]);
    for (const [x, y] of [[9, 9], [F - 9, 9], [9, F - 9], [F - 9, F - 9]] as const) stick(ctx, x, y + 2, x, y - 6, 0x8a5a2e, 2.4);
    // A pile of planks.
    for (let i = 0; i < 4; i++) stick(ctx, F - 44, F - 18 - i * 4, F - 18, F - 22 - i * 4, 0xb98652, 2.8);
  });
}

// ------------------------------------------------------------ nature

export const TREE_VARIANTS = 5;
export const TREE_W = 104;
export const TREE_H = 124;
export const treeOrigin = { x: 0.5, y: 108 / TREE_H };
/** Trees stand this far below their tile centre, so the canopy is centred on the tile. */
export const TREE_OFFSET = 24;

export function treeTexture(scene: Phaser.Scene, variant: number): string {
  return texture(scene, `tree${variant}`, TREE_W, TREE_H, (ctx) => {
    const bx = TREE_W / 2, by = 108;
    softShadow(ctx, bx + 12, by - 4, 34, 11, 0.32);
    if (variant >= 3) return drawPine(ctx, bx, by, variant);
    const palettes = [0x3f7d2e, 0x4c8a34, 0x5f8a2c];
    const base = palettes[variant] ?? 0x3f7d2e;
    stick(ctx, bx - 1, by, bx, by - 34, 0x5e3d22, 6);
    stick(ctx, bx, by - 22, bx + 9, by - 34, 0x5e3d22, 3);
    const rnd = seeded(variant * 97 + 13);
    const cx = bx, cy = by - 56;
    const blobs: Array<[number, number, number]> = [[cx, cy, 24]];
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd() * 0.5;
      const d = 15 + rnd() * 6;
      blobs.push([cx + Math.cos(a) * d * 1.1, cy + Math.sin(a) * d * 0.9, 13 + rnd() * 6]);
    }
    blobs.sort((a, b) => a[1] - b[1]);
    for (const [x, y, r] of blobs) {
      circle(ctx, x, y, r + 1.6);
      ctx.fillStyle = css(dark(base, 0.62));
      ctx.fill();
    }
    for (const [x, y, r] of blobs) {
      circle(ctx, x, y, r);
      ctx.fillStyle = ball(ctx, x, y, r, base);
      ctx.fill();
    }
    // Leaf speckle and sunlit clumps.
    for (let i = 0; i < 70; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * 34;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.85;
      const upperLeft = x - cx + (y - cy) < -6;
      circle(ctx, x, y, 1.6 + rnd() * 2);
      ctx.fillStyle = css(upperLeft ? light(base, 0.35) : dark(base, 0.3), 0.7);
      ctx.fill();
    }
  });
}

function drawPine(ctx: Ctx, bx: number, by: number, variant: number): void {
  const base = variant === 3 ? 0x2c5e34 : 0x34683a;
  stick(ctx, bx, by, bx, by - 22, 0x5a3a20, 5);
  const tiers = [[by - 14, 34], [by - 38, 28], [by - 60, 21], [by - 80, 13]] as const;
  for (const [y, w] of tiers) {
    const h = w * 1.35;
    ctx.beginPath();
    ctx.moveTo(bx, y - h);
    const teeth = 5;
    ctx.lineTo(bx + w, y);
    for (let i = teeth; i >= 0; i--) {
      const x = bx - w + ((2 * w) / teeth) * i;
      ctx.lineTo(x, y + (i % 2 === 0 ? 0 : 4));
    }
    ctx.closePath();
    fill(ctx, hgrad(ctx, bx - w, bx + w, light(base, 0.3), dark(base, 0.35)), 1.4);
    line(ctx, bx, y - h + 3, bx - w * 0.55, y - 2, css(light(base, 0.45), 0.6), 1.2);
  }
}

export function goldTexture(scene: Phaser.Scene): string {
  return texture(scene, "gold", 92, 80, (ctx) => {
    softShadow(ctx, 52, 64, 40, 12, 0.3);
    const rocks: Array<[number, number, number, number]> = [[30, 50, 22, 18], [60, 54, 20, 15], [46, 34, 22, 19]];
    for (const [x, y, rx, ry] of rocks) {
      ctx.beginPath();
      const rnd = seeded(x * 7 + y);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU;
        const r = 0.82 + rnd() * 0.2;
        const px = x + Math.cos(a) * rx * r, py = y + Math.sin(a) * ry * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      fill(ctx, ball(ctx, x, y, Math.max(rx, ry), 0x8a8478), 1.5);
    }
    // Gold veins and nuggets.
    const rnd = seeded(41);
    for (const [x, y] of [[34, 46], [50, 30], [62, 52], [42, 56]] as const) {
      line(ctx, x - 6, y + 3, x + 6, y - 3, css(0xb8862a), 2);
    }
    for (let i = 0; i < 14; i++) {
      const x = 18 + rnd() * 56, y = 26 + rnd() * 38, r = 2.4 + rnd() * 3;
      circle(ctx, x, y, r);
      fill(ctx, ball(ctx, x, y, r, 0xf0b92e), 0.9);
    }
    for (const [x, y] of [[44, 28], [26, 46], [64, 48]] as const) {
      line(ctx, x - 3.5, y, x + 3.5, y, "#fffbe0", 1.2);
      line(ctx, x, y - 3.5, x, y + 3.5, "#fffbe0", 1.2);
    }
  });
}

export function berriesTexture(scene: Phaser.Scene, full: boolean): string {
  return texture(scene, full ? "berries" : "berries-low", 72, 64, (ctx) => {
    softShadow(ctx, 40, 52, 30, 10, 0.3);
    const rnd = seeded(42);
    const blobs: Array<[number, number, number]> = [[36, 36, 18], [22, 40, 13], [50, 40, 13], [30, 26, 12], [44, 26, 12]];
    for (const [x, y, r] of blobs) {
      circle(ctx, x, y, r + 1.5);
      ctx.fillStyle = css(0x183a16);
      ctx.fill();
    }
    for (const [x, y, r] of blobs) {
      circle(ctx, x, y, r);
      ctx.fillStyle = ball(ctx, x, y, r, 0x3f7a2e);
      ctx.fill();
    }
    const n = full ? 22 : 8;
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * 22;
      const x = 36 + Math.cos(a) * d * 1.2, y = 35 + Math.sin(a) * d * 0.8;
      circle(ctx, x, y, 2.6);
      fill(ctx, ball(ctx, x, y, 2.6, 0xc4283f), 0.8);
    }
  });
}

// ------------------------------------------------------------ effects and decals

export function effectTextures(scene: Phaser.Scene): void {
  texture(scene, "shadow", 48, 18, (ctx) => softShadow(ctx, 24, 9, 22, 8, 0.4));
  texture(scene, "puff", 32, 32, (ctx) => {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(0.5, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    circle(ctx, 16, 16, 16);
    ctx.fillStyle = g;
    ctx.fill();
  });
  texture(scene, "flame", 20, 30, (ctx) => {
    const g = ctx.createRadialGradient(10, 21, 1, 10, 18, 14);
    g.addColorStop(0, "rgba(255,246,170,1)");
    g.addColorStop(0.4, "rgba(255,170,40,0.95)");
    g.addColorStop(1, "rgba(200,40,10,0)");
    ctx.beginPath();
    ctx.moveTo(10, 1);
    ctx.quadraticCurveTo(20, 16, 16, 24);
    ctx.quadraticCurveTo(10, 31, 4, 24);
    ctx.quadraticCurveTo(0, 16, 10, 1);
    ctx.fillStyle = g;
    ctx.fill();
  });
  texture(scene, "arrow", 30, 6, (ctx) => {
    line(ctx, 3, 3, 25, 3, css(0x6b4a2b), 1.4);
    poly(ctx, [24, 1, 30, 3, 24, 5]);
    fill(ctx, css(0xc8ccd0), 0);
    poly(ctx, [0, 0.5, 6, 3, 0, 5.5]);
    fill(ctx, css(0xeee6d4), 0);
  });
  texture(scene, "stump", 30, 22, (ctx) => {
    softShadow(ctx, 17, 14, 13, 6, 0.3);
    rect(ctx, 7, 8, 16, 6);
    fill(ctx, css(0x5e3d22), 1.1);
    ellipse(ctx, 15, 8, 8, 3.5);
    fill(ctx, css(0xc8a06a), 1.1);
    ellipse(ctx, 15, 8, 4, 1.6);
    ctx.strokeStyle = css(0x8a6a40);
    ctx.lineWidth = 0.8;
    ctx.stroke();
  });
  for (const size of [2, 3]) {
    const F = size * TILE;
    texture(scene, `rubble${size}`, F, F, (ctx) => {
      const g = ctx.createRadialGradient(F / 2, F / 2, 4, F / 2, F / 2, F / 2);
      g.addColorStop(0, "rgba(30,24,18,0.75)");
      g.addColorStop(1, "rgba(30,24,18,0)");
      circle(ctx, F / 2, F / 2, F / 2);
      ctx.fillStyle = g;
      ctx.fill();
      const rnd = seeded(size * 5);
      for (let i = 0; i < size * 12; i++) {
        const x = 10 + rnd() * (F - 20), y = 10 + rnd() * (F - 20), r = 2 + rnd() * 5;
        ellipse(ctx, x, y, r, r * 0.7, rnd() * 3);
        fill(ctx, css(rnd() > 0.3 ? 0x8a8478 : 0x4a2f1a), 0.9);
      }
      for (let i = 0; i < size * 2; i++) {
        const x = 14 + rnd() * (F - 28), y = 14 + rnd() * (F - 28), a = rnd() * 3;
        stick(ctx, x, y, x + Math.cos(a) * 20, y + Math.sin(a) * 20, 0x3a2414, 2.6);
      }
    });
  }
}
