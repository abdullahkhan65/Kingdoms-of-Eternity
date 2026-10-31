// Short-lived cosmetic effects. None of this affects the game: arrows don't
// carry damage (the server already applied it), they only show it happening.
import Phaser from "phaser";
import { TILE } from "@koe/sim";
import { RES } from "./art";

export const DEPTH = { farm: 1, decal: 1.5, foundation: 1.6, shadow: 2, fx: 7 } as const;
/** Sprites that stand on the ground are drawn back to front by their foot position. */
export const worldDepth = (y: number) => 3 + y / 100_000;

const MAX_STUMPS = 400;
const MAX_LIVE = 250;

export class Fx {
  private stumps: Phaser.GameObjects.Image[] = [];
  private live = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  private onScreen(x: number, y: number, margin = 160): boolean {
    const v = this.scene.cameras.main.worldView;
    return x > v.x - margin && x < v.right + margin && y > v.y - margin && y < v.bottom + margin;
  }

  /** An image that runs one tween and then removes itself. */
  private spawn(x: number, y: number, key: string, tween: Omit<Phaser.Types.Tweens.TweenBuilderConfig, "targets">, depth: number = DEPTH.fx) {
    if (this.live >= MAX_LIVE || !this.onScreen(x, y)) return null;
    this.live++;
    const img = this.scene.add.image(x, y, key).setScale(1 / RES).setDepth(depth);
    this.scene.tweens.add({
      ...tween,
      targets: img,
      onComplete: () => {
        this.live--;
        img.destroy();
      },
    });
    return img;
  }

  arrow(x0: number, y0: number, x1: number, y1: number): void {
    if (this.live >= MAX_LIVE || !(this.onScreen(x0, y0) || this.onScreen(x1, y1))) return;
    this.live++;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const lift = Math.min(70, dist * 0.22);
    const img = this.scene.add.image(x0, y0, "arrow").setScale(1 / RES).setDepth(DEPTH.fx);
    const state = { t: 0 };
    this.scene.tweens.add({
      targets: state,
      t: 1,
      duration: 160 + dist * 1.2,
      onUpdate: () => {
        const t = state.t;
        const vy = y1 - y0 - lift * 4 * (1 - 2 * t);
        img.setPosition(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - lift * 4 * t * (1 - t)).setRotation(Math.atan2(vy, x1 - x0));
      },
      onComplete: () => {
        this.live--;
        img.destroy();
        this.hit(x1, y1);
      },
    });
  }

  hit(x: number, y: number): void {
    this.spawn(x, y, "puff", { scale: { from: 0.12, to: 0.4 }, alpha: { from: 0.9, to: 0 }, duration: 220 });
  }

  chips(x: number, y: number, tint: number): void {
    for (let i = 0; i < 3; i++) {
      const dx = (Math.random() - 0.5) * 24;
      this.spawn(x, y, "puff", {
        x: x + dx, y: y - 8 - Math.random() * 10, scale: { from: 0.12, to: 0.06 }, alpha: { from: 1, to: 0 }, duration: 380, ease: "Quad.easeOut",
      })?.setTint(tint);
    }
  }

  dust(x: number, y: number): void {
    this.spawn(x, y, "puff", { y: y - 10, scale: { from: 0.3, to: 0.9 }, alpha: { from: 0.55, to: 0 }, duration: 800 })?.setTint(0xc8b48a);
  }

  smoke(x: number, y: number): void {
    this.spawn(x, y, "puff", {
      x: x + 10 + Math.random() * 16, y: y - 50 - Math.random() * 20, scale: { from: 0.5, to: 1.6 }, alpha: { from: 0.5, to: 0 }, duration: 1800,
    })?.setTint(0x4a4440);
  }

  flame(x: number, y: number): void {
    this.spawn(x, y, "flame", { y: y - 14, scale: { from: 0.5, to: 0.25 }, alpha: { from: 1, to: 0 }, duration: 520 })?.setBlendMode(Phaser.BlendModes.ADD);
  }

  /** A unit falls over and fades into the ground. */
  corpse(source: Phaser.GameObjects.Image): void {
    if (!this.onScreen(source.x, source.y)) return;
    const body = this.scene.add.image(source.x, source.y, source.texture.key)
      .setOrigin(source.originX, source.originY).setScale(1 / RES).setFlipX(source.flipX).setDepth(DEPTH.decal).setTint(0x9a9a9a);
    const side = source.flipX ? -1 : 1;
    this.scene.tweens.add({ targets: body, rotation: side * -1.45, duration: 260, ease: "Quad.easeIn" });
    this.scene.tweens.add({ targets: body, alpha: 0, delay: 6000, duration: 3000, onComplete: () => body.destroy() });
  }

  /** A destroyed building sinks into dust and leaves rubble behind. */
  collapse(source: Phaser.GameObjects.Image, x: number, y: number, size: number): void {
    if (!this.onScreen(x, y, 300)) return;
    const half = (size * TILE) / 2;
    if (size >= 2) {
      const rubble = this.scene.add.image(x, y, `rubble${Math.min(3, size)}`).setScale(1 / RES).setDepth(DEPTH.decal);
      this.scene.tweens.add({ targets: rubble, alpha: 0, delay: 20000, duration: 8000, onComplete: () => rubble.destroy() });
    }
    const ghost = this.scene.add.image(source.x, source.y, source.texture.key)
      .setOrigin(source.originX, source.originY).setScale(1 / RES).setDepth(source.depth);
    this.scene.tweens.add({ targets: ghost, y: source.y + half * 0.5, alpha: 0, duration: 700, ease: "Quad.easeIn", onComplete: () => ghost.destroy() });
    for (let i = 0; i < 8 + size * 3; i++) this.dust(x + (Math.random() - 0.5) * half * 1.8, y + (Math.random() - 0.5) * half * 1.6);
  }

  stump(x: number, y: number): void {
    const img = this.scene.add.image(x, y, "stump").setScale(1 / RES).setDepth(DEPTH.decal);
    this.stumps.push(img);
    if (this.stumps.length > MAX_STUMPS) this.stumps.shift()!.destroy();
  }
}
