import Phaser from "phaser";
import { MAX_UNITS_PER_COMMAND, TILE, UNIT_RADIUS } from "@koe/sim";
import type { MatchConnection, UnitPos } from "./net";

export const PLAYER_COLORS = [0x3b82f6, 0xef4444, 0x22c55e, 0xeab308, 0x06b6d4, 0xa855f7, 0xf97316, 0xe5e7eb];

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 1.5;
const SCROLL_SPEED = 1200; // screen px per second at zoom 1
const EDGE_PX = 16;
const DRAG_THRESHOLD_PX = 6;
const CLICK_PICK_RADIUS = UNIT_RADIUS * 2;

export interface HudState {
  units: number;
  selected: number;
}

/**
 * Draws the match and turns mouse/keyboard input into commands. Everything
 * it shows comes from the server; the only local "prediction" is cosmetic
 * feedback (move marker, order lines) so clicks feel instant despite latency.
 */
export class GameScene extends Phaser.Scene {
  private sprites = new Map<number, Phaser.GameObjects.Image>();
  private positions = new Map<number, UnitPos>();
  private selected = new Set<number>();
  private overlay!: Phaser.GameObjects.Graphics;
  private dragStart: { x: number; y: number } | null = null;
  private dragNow: { x: number; y: number } | null = null;
  private pointerInside = false;
  private centeredOnStart = false;
  private keys!: Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d", Phaser.Input.Keyboard.Key>;

  constructor(
    private readonly net: MatchConnection,
    private readonly onHud: (state: HudState) => void,
  ) {
    super("game");
  }

  create(): void {
    const { mapWidth, mapHeight } = this.net.welcome;
    this.createTerrain(mapWidth, mapHeight);
    this.createUnitTexture();
    this.overlay = this.add.graphics().setDepth(10);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, mapWidth, mapHeight);
    cam.setZoom(0.5);
    cam.centerOn(mapWidth / 2, mapHeight / 2);

    this.input.mouse?.disableContextMenu();
    this.input.on("gameover", () => (this.pointerInside = true));
    this.input.on("gameout", () => (this.pointerInside = false));
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (this.dragStart) this.dragNow = { x: p.x, y: p.y };
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => this.onPointerUp(p));
    this.input.on("wheel", (p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => this.zoomAt(p, dy));

    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      up: kb.addKey(K.UP), down: kb.addKey(K.DOWN), left: kb.addKey(K.LEFT), right: kb.addKey(K.RIGHT),
      w: kb.addKey(K.W), a: kb.addKey(K.A), s: kb.addKey(K.S), d: kb.addKey(K.D),
    };
  }

  override update(_time: number, deltaMs: number): void {
    const positions = this.net.sample(performance.now());
    if (positions) {
      this.positions = positions;
      this.syncSprites();
      this.centerOnMyUnitsOnce();
    }
    this.scrollCamera(deltaMs / 1000);
    this.drawOverlay();
    this.onHud({ units: this.countMine(), selected: this.selected.size });
  }

  // ---- rendering ----

  private createTerrain(width: number, height: number): void {
    // One pixel per tile, scaled up: a blocky cosmetic grass map at almost no cost.
    const cols = width / TILE;
    const rows = height / TILE;
    const canvas = document.createElement("canvas");
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d")!;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const n = (Math.sin(x * 0.31) + Math.cos(y * 0.27) + Math.sin((x + y) * 0.13)) / 3;
        const g = 105 + Math.round(n * 18) + ((x * 7 + y * 13) % 5);
        ctx.fillStyle = `rgb(${Math.round(g * 0.45)}, ${g}, ${Math.round(g * 0.35)})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    this.textures.addCanvas("terrain", canvas)!.setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.add.image(0, 0, "terrain").setOrigin(0, 0).setScale(TILE).setDepth(0);
  }

  private createUnitTexture(): void {
    const r = UNIT_RADIUS;
    const g = this.make.graphics({}, false);
    g.fillStyle(0x111111, 1).fillCircle(r + 2, r + 2, r + 2);
    g.fillStyle(0xffffff, 1).fillCircle(r + 2, r + 2, r);
    g.generateTexture("unit", (r + 2) * 2, (r + 2) * 2);
    g.destroy();
  }

  private syncSprites(): void {
    for (const [id, u] of this.positions) {
      let sprite = this.sprites.get(id);
      if (!sprite) {
        sprite = this.add.image(u.x, u.y, "unit").setTint(PLAYER_COLORS[u.owner % PLAYER_COLORS.length]!).setDepth(5);
        this.sprites.set(id, sprite);
      }
      sprite.setPosition(u.x, u.y);
    }
    for (const [id, sprite] of this.sprites) {
      if (this.positions.has(id)) continue;
      sprite.destroy();
      this.sprites.delete(id);
      this.selected.delete(id);
    }
  }

  private drawOverlay(): void {
    const g = this.overlay.clear();
    const zoom = this.cameras.main.zoom;
    g.lineStyle(2 / zoom, 0xffffff, 0.9);
    for (const id of this.selected) {
      const u = this.positions.get(id);
      if (u) g.strokeCircle(u.x, u.y, UNIT_RADIUS + 6);
    }
    if (this.dragStart && this.dragNow && this.isDrag()) {
      const a = this.cameras.main.getWorldPoint(this.dragStart.x, this.dragStart.y);
      const b = this.cameras.main.getWorldPoint(this.dragNow.x, this.dragNow.y);
      g.fillStyle(0x22c55e, 0.12).fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      g.lineStyle(1.5 / zoom, 0x22c55e, 1).strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    }
  }

  /** Instant, purely cosmetic acknowledgement of a move order (the server hasn't answered yet). */
  private showMoveFeedback(x: number, y: number, ids: number[]): void {
    const zoom = this.cameras.main.zoom;
    const ring = this.add.circle(x, y, 28, 0x000000, 0).setStrokeStyle(3 / zoom, 0x4ade80).setDepth(11);
    this.tweens.add({ targets: ring, scale: 0.2, alpha: 0, duration: 450, ease: "Quad.easeIn", onComplete: () => ring.destroy() });

    const lines = this.add.graphics().setDepth(9);
    lines.lineStyle(1.5 / zoom, 0x4ade80, 0.5);
    for (const id of ids) {
      const u = this.positions.get(id);
      if (u) lines.lineBetween(u.x, u.y, x, y);
    }
    this.tweens.add({ targets: lines, alpha: 0, duration: 500, onComplete: () => lines.destroy() });
  }

  // ---- input ----

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (p.rightButtonDown()) {
      this.orderMove(p);
    } else if (p.leftButtonDown()) {
      this.dragStart = { x: p.x, y: p.y };
      this.dragNow = { x: p.x, y: p.y };
    }
  }

  private onPointerUp(p: Phaser.Input.Pointer): void {
    if (!this.dragStart) return;
    const additive = p.event.shiftKey;
    if (!additive) this.selected.clear();
    if (this.isDrag()) this.selectInBox();
    else this.selectNearest(p);
    this.dragStart = null;
    this.dragNow = null;
  }

  private isDrag(): boolean {
    if (!this.dragStart || !this.dragNow) return false;
    return Math.abs(this.dragNow.x - this.dragStart.x) > DRAG_THRESHOLD_PX || Math.abs(this.dragNow.y - this.dragStart.y) > DRAG_THRESHOLD_PX;
  }

  private selectInBox(): void {
    const a = this.cameras.main.getWorldPoint(this.dragStart!.x, this.dragStart!.y);
    const b = this.cameras.main.getWorldPoint(this.dragNow!.x, this.dragNow!.y);
    const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
    for (const [id, u] of this.positions) {
      if (u.owner === this.net.welcome.player && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1) this.selected.add(id);
    }
  }

  private selectNearest(p: Phaser.Input.Pointer): void {
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    let best: number | null = null;
    let bestDist = CLICK_PICK_RADIUS;
    for (const [id, u] of this.positions) {
      if (u.owner !== this.net.welcome.player) continue;
      const d = Math.hypot(u.x - w.x, u.y - w.y);
      if (d <= bestDist) {
        best = id;
        bestDist = d;
      }
    }
    if (best !== null) this.selected.add(best);
  }

  private orderMove(p: Phaser.Input.Pointer): void {
    if (this.selected.size === 0) return;
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    const ids = [...this.selected].slice(0, MAX_UNITS_PER_COMMAND);
    const x = Math.round(w.x);
    const y = Math.round(w.y);
    this.net.send({ type: "move", ids, x, y });
    this.showMoveFeedback(x, y, ids);
  }

  // ---- camera ----

  private scrollCamera(dt: number): void {
    const cam = this.cameras.main;
    const k = this.keys;
    let dx = 0;
    let dy = 0;
    if (k.left.isDown || k.a.isDown) dx -= 1;
    if (k.right.isDown || k.d.isDown) dx += 1;
    if (k.up.isDown || k.w.isDown) dy -= 1;
    if (k.down.isDown || k.s.isDown) dy += 1;

    const p = this.input.activePointer;
    if (this.pointerInside && !this.dragStart) {
      if (p.x <= EDGE_PX) dx -= 1;
      if (p.x >= this.scale.width - EDGE_PX) dx += 1;
      if (p.y <= EDGE_PX) dy -= 1;
      if (p.y >= this.scale.height - EDGE_PX) dy += 1;
    }
    const speed = (SCROLL_SPEED * dt) / cam.zoom;
    cam.scrollX += Math.sign(dx) * speed;
    cam.scrollY += Math.sign(dy) * speed;
  }

  private zoomAt(p: Phaser.Input.Pointer, wheelDy: number): void {
    const cam = this.cameras.main;
    const before = cam.getWorldPoint(p.x, p.y);
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * (wheelDy > 0 ? 0.9 : 1.1), MIN_ZOOM, MAX_ZOOM));
    cam.preRender(); // refresh the camera matrix so getWorldPoint uses the new zoom
    const after = cam.getWorldPoint(p.x, p.y);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
  }

  private centerOnMyUnitsOnce(): void {
    if (this.centeredOnStart) return;
    const mine = [...this.positions.values()].filter((u) => u.owner === this.net.welcome.player);
    if (mine.length === 0) return;
    const cx = mine.reduce((s, u) => s + u.x, 0) / mine.length;
    const cy = mine.reduce((s, u) => s + u.y, 0) / mine.length;
    this.cameras.main.centerOn(cx, cy);
    this.centeredOnStart = true;
  }

  private countMine(): number {
    let n = 0;
    for (const u of this.positions.values()) if (u.owner === this.net.welcome.player) n++;
    return n;
  }
}
