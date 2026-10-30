import Phaser from "phaser";
import { EF, type EntityView } from "@koe/protocol";
import {
  BUILDINGS, GAIA, MAX_UNITS_PER_COMMAND, NODES, T, TILE, UNITS, markVision,
  type Command, type Entity, type World,
} from "@koe/sim";
import type { Net } from "./net";

export const PLAYER_COLORS = [0x3b82f6, 0xef4444, 0x22c55e, 0xeab308, 0x06b6d4, 0xa855f7, 0xf97316, 0xe5e7eb];
export const colorCss = (slot: number) => `#${(PLAYER_COLORS[slot % PLAYER_COLORS.length] ?? 0xffffff).toString(16).padStart(6, "0")}`;

export const TOP_BAR = 36;
export const BOTTOM_PANEL = 168;
const MAX_ZOOM = 1.6;
const SCROLL_SPEED = 1100;
const EDGE_PX = 14;
const DRAG_THRESHOLD_PX = 6;
const FOG_EVERY_MS = 200;
const OCCUPANCY_EVERY_MS = 400;

type Mode = { k: "normal" } | { k: "place"; building: number } | { k: "attack" };

/**
 * Draws the match and turns input into commands. Everything shown comes from
 * the server; the only local "prediction" is cosmetic feedback (order markers)
 * so clicks feel instant despite latency.
 */
export class GameScene extends Phaser.Scene {
  readonly selected = new Set<number>();
  entities = new Map<number, EntityView>();
  mode: Mode = { k: "normal" };
  /** Per tile: 0 never seen, 1 explored, 2 visible now. */
  fog!: Uint8Array;
  onChange: () => void = () => {};
  onToast: (text: string) => void = () => {};
  /** Called at the end of create(), once the scene can be used. */
  onReady: () => void = () => {};

  private sprites = new Map<number, Phaser.GameObjects.Image>();
  private overlay!: Phaser.GameObjects.Graphics;
  private ghost!: Phaser.GameObjects.Graphics;
  private fogCanvas!: Phaser.Textures.CanvasTexture;
  private occupancy!: Uint8Array;
  private groups = new Map<number, number[]>();
  private lastGroupKey = { n: 0, time: 0 };
  private dragStart: { x: number; y: number } | null = null;
  private dragNow: { x: number; y: number } | null = null;
  private panFrom: { x: number; y: number; sx: number; sy: number } | null = null;
  private pointerInside = false;
  private lastFog = 0;
  private lastOccupancy = 0;
  private lastClick = { time: 0, id: -1 };
  private centered = false;
  private arrows!: Phaser.Types.Input.Keyboard.CursorKeys;

  constructor(private readonly net: Net) {
    super("game");
  }

  get me(): number {
    return this.net.started!.you;
  }

  get cols(): number {
    return this.net.started!.cols;
  }

  get rows(): number {
    return this.net.started!.rows;
  }

  create(): void {
    this.fog = new Uint8Array(this.cols * this.rows);
    this.occupancy = new Uint8Array(this.cols * this.rows);
    this.createTerrain();
    this.createTextures();
    this.fogCanvas = this.textures.createCanvas("fog", this.cols, this.rows)!;
    this.add.image(0, 0, "fog").setOrigin(0, 0).setScale(TILE).setDepth(8);
    this.overlay = this.add.graphics().setDepth(9);
    this.ghost = this.add.graphics().setDepth(10);

    this.cameras.main.setBounds(0, 0, this.cols * TILE, this.rows * TILE);
    this.layout();
    this.scale.on("resize", () => this.layout());

    this.input.mouse?.disableContextMenu();
    this.input.on("gameover", () => (this.pointerInside = true));
    this.input.on("gameout", () => (this.pointerInside = false));
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => this.onPointerUp(p));
    this.input.on("wheel", (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => this.zoomAt(p, dy));
    this.arrows = this.input.keyboard!.createCursorKeys();
    this.onReady();
  }

  override update(time: number, deltaMs: number): void {
    const entities = this.net.sample(performance.now());
    if (entities) {
      this.entities = entities;
      this.syncSprites();
      if (!this.centered) this.centerOnHome();
    }
    if (time - this.lastFog > FOG_EVERY_MS) {
      this.lastFog = time;
      this.updateFog();
    }
    if (time - this.lastOccupancy > OCCUPANCY_EVERY_MS) {
      this.lastOccupancy = time;
      this.updateOccupancy();
    }
    this.scrollCamera(deltaMs / 1000);
    this.drawOverlay();
    this.drawGhost();
  }

  // ------------------------------------------------------------ actions used by the HUD

  issue(cmd: Command): void {
    this.net.send(cmd);
  }

  selectedEntities(): EntityView[] {
    return [...this.selected].map((id) => this.entities.get(id)).filter((e): e is EntityView => !!e);
  }

  mySelectedUnits(): EntityView[] {
    return this.selectedEntities().filter((e) => e.owner === this.me && UNITS[e.type]);
  }

  startPlacement(building: number): void {
    this.mode = { k: "place", building };
    this.onChange();
  }

  startAttackMove(): void {
    if (this.mySelectedUnits().length > 0) this.mode = { k: "attack" };
  }

  cancelMode(): void {
    this.mode = { k: "normal" };
    this.ghost.clear();
    this.onChange();
  }

  centerOn(x: number, y: number): void {
    this.cameras.main.centerOn(x, y);
  }

  select(ids: number[]): void {
    this.selected.clear();
    for (const id of ids) this.selected.add(id);
    this.onChange();
  }

  isIdle(e: EntityView): boolean {
    return (e.flags & EF.Idle) !== 0;
  }

  idleVillagers(): EntityView[] {
    return [...this.entities.values()].filter((e) => e.owner === this.me && e.type === T.Villager && this.isIdle(e));
  }

  selectIdleVillager(): void {
    const idle = this.idleVillagers();
    if (idle.length === 0) return this.onToast("No idle villagers");
    const current = [...this.selected][0];
    const next = idle[(idle.findIndex((e) => e.id === current) + 1) % idle.length]!;
    this.select([next.id]);
    this.centerOn(next.x, next.y);
  }

  selectTownCenter(): void {
    const tc = [...this.entities.values()].find((e) => e.owner === this.me && e.type === T.TownCenter);
    if (!tc) return;
    this.select([tc.id]);
    this.centerOn(tc.x, tc.y);
  }

  deleteSelected(): void {
    for (const e of this.selectedEntities()) if (e.owner === this.me) this.issue({ type: "delete", id: e.id });
    this.select([]);
  }

  /** Global hotkeys. Returns true if the key was used. */
  handleKey(ev: KeyboardEvent): boolean {
    const key = ev.key.toLowerCase();
    if (key === "escape") {
      if (this.mode.k !== "normal") this.cancelMode();
      else this.select([]);
      return true;
    }
    if (/^[1-9]$/.test(key)) {
      const n = Number(key);
      if (ev.ctrlKey || ev.metaKey) {
        this.groups.set(n, [...this.selected]);
        this.onToast(`Group ${n} set`);
      } else {
        const ids = (this.groups.get(n) ?? []).filter((id) => this.entities.has(id));
        if (ids.length) {
          this.select(ids);
          if (this.lastGroupKey.n === n && performance.now() - this.lastGroupKey.time < 400) this.centerOnSelection();
        }
        this.lastGroupKey = { n, time: performance.now() };
      }
      return true;
    }
    switch (key) {
      case ".": this.selectIdleVillager(); return true;
      case "h": this.selectTownCenter(); return true;
      case " ": this.centerOnSelection(); return true;
      case "delete": this.deleteSelected(); return true;
      case "a": this.startAttackMove(); return true;
      case "s": {
        const ids = this.mySelectedUnits().map((e) => e.id);
        if (ids.length) this.issue({ type: "stop", ids });
        return ids.length > 0;
      }
    }
    return false;
  }

  centerOnSelection(): void {
    const sel = this.selectedEntities();
    if (sel.length) this.centerOn(sel.reduce((s, e) => s + e.x, 0) / sel.length, sel.reduce((s, e) => s + e.y, 0) / sel.length);
  }

  isFriendly(owner: number): boolean {
    if (owner === this.me) return true;
    const seats = this.net.started!.seats;
    const mine = seats.find((s) => s.slot === this.me)?.team ?? 0;
    const theirs = seats.find((s) => s.slot === owner)?.team ?? 0;
    return mine !== 0 && mine === theirs;
  }

  /** Visible part of the map in world coordinates (for the minimap). */
  view(): Phaser.Geom.Rectangle {
    return this.cameras.main.worldView;
  }

  // ------------------------------------------------------------ world rendering

  private layout(): void {
    const cam = this.cameras.main;
    cam.setViewport(0, TOP_BAR, this.scale.width, Math.max(100, this.scale.height - TOP_BAR - BOTTOM_PANEL));
    // Never zoom out past the point where the map stops filling the view.
    cam.setZoom(Phaser.Math.Clamp(cam.zoom, this.minZoom(), MAX_ZOOM));
  }

  private minZoom(): number {
    const cam = this.cameras.main;
    return Math.max(cam.width / (this.cols * TILE), cam.height / (this.rows * TILE));
  }

  private createTerrain(): void {
    const { cols, rows, terrain } = this.net.started!;
    const scale = 4;
    const canvas = document.createElement("canvas");
    canvas.width = cols * scale;
    canvas.height = rows * scale;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(canvas.width, canvas.height);
    for (let py = 0; py < canvas.height; py++) {
      for (let px = 0; px < canvas.width; px++) {
        const water = terrain[Math.floor(py / scale) * cols + Math.floor(px / scale)] === 1;
        const n = Math.sin(px * 0.09) * Math.cos(py * 0.07) + Math.sin((px + py) * 0.031);
        const jitter = ((px * 73856093) ^ (py * 19349663)) & 7;
        const i = (py * canvas.width + px) * 4;
        if (water) {
          img.data[i] = 38 + jitter;
          img.data[i + 1] = 92 + n * 8 + jitter;
          img.data[i + 2] = 150 + n * 10;
        } else {
          const g = 108 + n * 10 + jitter;
          img.data[i] = g * 0.5;
          img.data[i + 1] = g;
          img.data[i + 2] = g * 0.34;
        }
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.textures.addCanvas("terrain", canvas);
    this.add.image(0, 0, "terrain").setOrigin(0, 0).setScale(TILE / scale).setDepth(0);
  }

  private createTextures(): void {
    const make = (key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void) => {
      const g = this.make.graphics({}, false);
      draw(g);
      g.generateTexture(key, w, h);
      g.destroy();
    };
    const dark = 0x1a1a1a;
    // Units: white bodies (tinted per player) with dark markings, which stay dark under the tint.
    const body = (g: Phaser.GameObjects.Graphics, r: number) => {
      g.fillStyle(dark, 1).fillCircle(r + 2, r + 2, r + 2);
      g.fillStyle(0xffffff, 1).fillCircle(r + 2, r + 2, r);
    };
    make(`u${T.Villager}`, 30, 30, (g) => { body(g, 13); g.fillStyle(dark, 1).fillCircle(15, 15, 3); });
    make(`u${T.Spearman}`, 34, 34, (g) => { body(g, 15); g.lineStyle(3, dark, 1).lineBetween(17, 6, 17, 30); g.fillStyle(dark, 1).fillTriangle(12, 10, 22, 10, 17, 2); });
    make(`u${T.Swordsman}`, 36, 36, (g) => { body(g, 16); g.lineStyle(3, dark, 1).lineBetween(10, 10, 26, 26).lineBetween(26, 10, 10, 26); });
    make(`u${T.Archer}`, 32, 32, (g) => { body(g, 14); g.lineStyle(2.5, dark, 1).beginPath().arc(13, 16, 9, -1.2, 1.2).strokePath(); g.lineBetween(16, 7, 16, 25); });
    make(`u${T.Scout}`, 38, 38, (g) => { body(g, 17); g.lineStyle(3, dark, 1).lineBetween(9, 14, 19, 25).lineBetween(19, 25, 29, 14); });
    // Buildings: white footprints with dark details, tinted per player.
    for (const [type, def] of Object.entries(BUILDINGS)) {
      const s = def.size * TILE;
      make(`b${type}`, s, s, (g) => {
        if (Number(type) === T.Farm) {
          g.fillStyle(0xb08d4a, 1).fillRect(2, 2, s - 4, s - 4);
          g.lineStyle(3, 0x7a5c2a, 1);
          for (let y = 12; y < s - 4; y += 14) g.lineBetween(6, y, s - 6, y);
          return;
        }
        g.fillStyle(dark, 1).fillRect(2, 2, s - 4, s - 4);
        g.fillStyle(0xffffff, 1).fillRect(6, 6, s - 12, s - 12);
        g.lineStyle(4, dark, 1);
        const c = s / 2;
        switch (Number(type)) {
          case T.TownCenter: g.strokeCircle(c, c, s * 0.28); g.fillStyle(dark, 1).fillCircle(c, c, s * 0.1); break;
          case T.House: g.lineBetween(14, c + 12, c, 16).lineBetween(c, 16, s - 14, c + 12); break;
          case T.Storehouse: g.strokeRect(c - 20, c - 15, 40, 30).lineBetween(c - 20, c, c + 20, c); break;
          case T.Barracks: g.lineBetween(c - 32, c - 32, c + 32, c + 32).lineBetween(c + 32, c - 32, c - 32, c + 32); break;
          case T.ArcheryRange: g.strokeCircle(c, c, 36); g.strokeCircle(c, c, 18); g.fillStyle(dark, 1).fillCircle(c, c, 6); break;
        }
      });
    }
    make(`n${T.Tree}`, 64, 64, (g) => {
      g.fillStyle(0x0f2e14, 1).fillCircle(32, 34, 27);
      g.fillStyle(0x1f5a26, 1).fillCircle(30, 30, 23);
      g.fillStyle(0x2f7a35, 1).fillCircle(25, 24, 11);
    });
    make(`n${T.GoldMine}`, 64, 64, (g) => {
      g.fillStyle(0x5b4a2a, 1).fillCircle(32, 34, 26);
      g.fillStyle(0xe8b33c, 1).fillCircle(25, 28, 9).fillCircle(39, 33, 8).fillCircle(30, 41, 7);
      g.fillStyle(0xfff1a8, 1).fillCircle(23, 26, 3);
    });
    make(`n${T.Berries}`, 64, 64, (g) => {
      g.fillStyle(0x24521f, 1).fillCircle(32, 32, 24);
      g.fillStyle(0xc0263e, 1);
      for (const [x, y] of [[22, 24], [36, 22], [42, 36], [28, 40], [33, 31], [20, 35]] as const) g.fillCircle(x, y, 4);
    });
  }

  private textureFor(e: EntityView): string {
    if (UNITS[e.type]) return `u${e.type}`;
    if (BUILDINGS[e.type]) return `b${e.type}`;
    return `n${e.type}`;
  }

  private syncSprites(): void {
    for (const [id, e] of this.entities) {
      let sprite = this.sprites.get(id);
      if (!sprite) {
        sprite = this.add.image(e.x, e.y, this.textureFor(e));
        if (e.owner !== GAIA && e.type !== T.Farm) sprite.setTint(PLAYER_COLORS[e.owner % PLAYER_COLORS.length]!);
        sprite.setDepth(UNITS[e.type] ? 5 : e.type === T.Farm ? 1 : BUILDINGS[e.type] ? 2 : 3);
        this.sprites.set(id, sprite);
      }
      sprite.setPosition(e.x, e.y);
      sprite.setAlpha(e.flags & EF.UnderConstruction ? 0.5 : 1);
      if (UNITS[e.type]) sprite.setScale(e.flags & EF.Attacking ? 1.15 : 1);
    }
    for (const [id, sprite] of this.sprites) {
      if (this.entities.has(id)) continue;
      sprite.destroy();
      this.sprites.delete(id);
      if (this.selected.delete(id)) this.onChange();
    }
  }

  private updateFog(): void {
    const { cols, rows } = this;
    const viewers = [...this.entities.values()]
      .filter((e) => e.owner !== GAIA && this.isFriendly(e.owner))
      .map((e) => ({ ...e, size: BUILDINGS[e.type]?.size ?? 0 }) as unknown as Entity);
    const visible = markVision({ cols, rows } as World, viewers, new Uint8Array(cols * rows));
    const reveal = this.net.players.winners !== null || this.net.players.defeated.includes(this.me);
    const ctx = this.fogCanvas.context;
    const img = ctx.createImageData(cols, rows);
    for (let i = 0; i < visible.length; i++) {
      if (visible[i] || reveal) this.fog[i] = 2;
      else if (this.fog[i] === 2) this.fog[i] = 1;
      img.data[i * 4 + 3] = this.fog[i] === 2 ? 0 : this.fog[i] === 1 ? 120 : 255;
    }
    ctx.putImageData(img, 0, 0);
    this.fogCanvas.refresh();
  }

  private updateOccupancy(): void {
    const { cols, rows } = this;
    this.occupancy.set(this.net.started!.terrain);
    for (const e of (this.net.latest() ?? this.entities).values()) {
      const size = BUILDINGS[e.type]?.size ?? (NODES[e.type] ? 1 : 0);
      if (size === 0) continue;
      const tx = Math.round(e.x / TILE - size / 2), ty = Math.round(e.y / TILE - size / 2);
      for (let y = ty; y < ty + size; y++) {
        for (let x = tx; x < tx + size; x++) if (x >= 0 && y >= 0 && x < cols && y < rows) this.occupancy[y * cols + x] = 1;
      }
    }
  }

  /** Client-side preview only; the server decides for real. */
  canPlaceHere(type: number, tx: number, ty: number): boolean {
    const size = BUILDINGS[type]!.size;
    for (let y = ty; y < ty + size; y++) {
      for (let x = tx; x < tx + size; x++) {
        if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return false;
        if (this.occupancy[y * this.cols + x] || this.fog[y * this.cols + x] === 0) return false;
      }
    }
    return true;
  }

  private drawOverlay(): void {
    const g = this.overlay.clear();
    const cam = this.cameras.main;
    const view = cam.worldView;
    const px = (w: number) => w / cam.zoom;

    for (const e of this.entities.values()) {
      const selected = this.selected.has(e.id);
      if (!selected && !Phaser.Geom.Rectangle.Contains(view, e.x, e.y)) continue;
      const size = (BUILDINGS[e.type]?.size ?? (NODES[e.type] ? 1 : 0)) * TILE;
      if (selected) {
        g.lineStyle(px(2), e.owner === this.me ? 0xffffff : e.owner === GAIA ? 0xe8e0b0 : 0xff6b6b, 0.95);
        if (size) g.strokeRect(e.x - size / 2 - 3, e.y - size / 2 - 3, size + 6, size + 6);
        else g.strokeCircle(e.x, e.y, (UNITS[e.type]?.radius ?? 16) + 5);
      }
      // Health bars for selected or damaged units and buildings.
      const max = UNITS[e.type]?.hp ?? BUILDINGS[e.type]?.hp;
      if (!max || e.owner === GAIA || (e.type === T.Farm && !(e.flags & EF.UnderConstruction))) continue;
      if (!selected && e.hp >= max) continue;
      const w = size ? size * 0.8 : 30;
      const y = e.y - (size ? size / 2 + 12 : (UNITS[e.type]?.radius ?? 16) + 10);
      const frac = Math.max(0, Math.min(1, e.hp / max));
      g.fillStyle(0x000000, 0.8).fillRect(e.x - w / 2, y, w, px(5));
      g.fillStyle(e.flags & EF.UnderConstruction ? 0x60a5fa : frac > 0.5 ? 0x4ade80 : frac > 0.25 ? 0xfacc15 : 0xef4444, 1)
        .fillRect(e.x - w / 2, y, w * frac, px(5));
    }

    // Rally points of selected buildings.
    const rallies = this.net.you?.rallies ?? {};
    for (const id of this.selected) {
      const r = rallies[id];
      const b = this.entities.get(id);
      if (!r || !b) continue;
      g.lineStyle(px(1.5), 0xffffff, 0.6).lineBetween(b.x, b.y, r.x, r.y);
      g.lineStyle(px(2), 0xffffff, 1).lineBetween(r.x, r.y, r.x, r.y - 24);
      g.fillStyle(PLAYER_COLORS[this.me % PLAYER_COLORS.length]!, 1).fillTriangle(r.x, r.y - 24, r.x + 16, r.y - 18, r.x, r.y - 12);
    }

    if (this.dragStart && this.dragNow && this.isDrag()) {
      const a = cam.getWorldPoint(this.dragStart.x, this.dragStart.y);
      const b = cam.getWorldPoint(this.dragNow.x, this.dragNow.y);
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      g.fillStyle(0x22c55e, 0.12).fillRect(x, y, w, h);
      g.lineStyle(px(1.5), 0x22c55e, 1).strokeRect(x, y, w, h);
    }
  }

  private drawGhost(): void {
    const g = this.ghost.clear();
    if (this.mode.k !== "place") return;
    const p = this.input.activePointer;
    const size = BUILDINGS[this.mode.building]!.size;
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    const tx = Math.round(w.x / TILE - size / 2), ty = Math.round(w.y / TILE - size / 2);
    const ok = this.canPlaceHere(this.mode.building, tx, ty);
    g.fillStyle(ok ? 0x4ade80 : 0xef4444, 0.35).fillRect(tx * TILE, ty * TILE, size * TILE, size * TILE);
    g.lineStyle(2 / this.cameras.main.zoom, ok ? 0x4ade80 : 0xef4444, 0.9).strokeRect(tx * TILE, ty * TILE, size * TILE, size * TILE);
  }

  /** Instant, purely cosmetic acknowledgement of an order (the server hasn't answered yet). */
  private feedback(x: number, y: number, color: number): void {
    const ring = this.add.circle(x, y, 26, 0x000000, 0).setStrokeStyle(3 / this.cameras.main.zoom, color).setDepth(11);
    this.tweens.add({ targets: ring, scale: 0.2, alpha: 0, duration: 420, ease: "Quad.easeIn", onComplete: () => ring.destroy() });
  }

  // ------------------------------------------------------------ input

  /** Entity under a world point: units first, then buildings, then resources. */
  private pick(wx: number, wy: number): EntityView | null {
    let best: EntityView | null = null;
    let bestRank = Infinity;
    for (const e of this.entities.values()) {
      const size = (BUILDINGS[e.type]?.size ?? (NODES[e.type] ? 1 : 0)) * TILE;
      const hit = size
        ? Math.abs(wx - e.x) <= size / 2 && Math.abs(wy - e.y) <= size / 2
        : Math.hypot(wx - e.x, wy - e.y) <= (UNITS[e.type]?.radius ?? 16) + 6;
      if (!hit) continue;
      const rank = UNITS[e.type] ? 0 : BUILDINGS[e.type] ? 1 : 2;
      if (rank < bestRank) {
        best = e;
        bestRank = rank;
      }
    }
    return best;
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (p.middleButtonDown()) {
      this.panFrom = { x: p.x, y: p.y, sx: this.cameras.main.scrollX, sy: this.cameras.main.scrollY };
      return;
    }
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    if (p.rightButtonDown()) {
      if (this.mode.k !== "normal") return this.cancelMode();
      return this.rightClick(w.x, w.y);
    }
    if (!p.leftButtonDown()) return;
    if (this.mode.k === "place") return this.place(w.x, w.y, p.event.shiftKey);
    if (this.mode.k === "attack") return this.attackClick(w.x, w.y, p.event.shiftKey);
    this.dragStart = { x: p.x, y: p.y };
    this.dragNow = { x: p.x, y: p.y };
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    if (this.panFrom) {
      const cam = this.cameras.main;
      cam.scrollX = this.panFrom.sx - (p.x - this.panFrom.x) / cam.zoom;
      cam.scrollY = this.panFrom.sy - (p.y - this.panFrom.y) / cam.zoom;
    } else if (this.dragStart) {
      this.dragNow = { x: p.x, y: p.y };
    }
  }

  private onPointerUp(p: Phaser.Input.Pointer): void {
    this.panFrom = null;
    if (!this.dragStart) return;
    if (this.isDrag()) this.selectInBox(p.event.shiftKey);
    else this.clickSelect(p, p.event.shiftKey);
    this.dragStart = null;
    this.dragNow = null;
  }

  private isDrag(): boolean {
    if (!this.dragStart || !this.dragNow) return false;
    return Math.abs(this.dragNow.x - this.dragStart.x) > DRAG_THRESHOLD_PX || Math.abs(this.dragNow.y - this.dragStart.y) > DRAG_THRESHOLD_PX;
  }

  private selectInBox(additive: boolean): void {
    const a = this.cameras.main.getWorldPoint(this.dragStart!.x, this.dragStart!.y);
    const b = this.cameras.main.getWorldPoint(this.dragNow!.x, this.dragNow!.y);
    const [x0, x1, y0, y1] = [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)];
    if (!additive) this.selected.clear();
    for (const e of this.entities.values()) {
      if (e.owner === this.me && UNITS[e.type] && e.x >= x0 && e.x <= x1 && e.y >= y0 && e.y <= y1) this.selected.add(e.id);
    }
    this.onChange();
  }

  private clickSelect(p: Phaser.Input.Pointer, additive: boolean): void {
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    const e = this.pick(w.x, w.y);
    const now = performance.now();
    if (!e) {
      if (!additive) this.select([]);
      return;
    }
    if (e.id === this.lastClick.id && now - this.lastClick.time < 350 && e.owner === this.me && UNITS[e.type]) {
      // Double-click: every unit of that type on screen.
      const view = this.cameras.main.worldView;
      this.select([...this.entities.values()].filter((o) => o.owner === this.me && o.type === e.type && Phaser.Geom.Rectangle.Contains(view, o.x, o.y)).map((o) => o.id));
    } else if (additive && e.owner === this.me && UNITS[e.type]) {
      if (this.selected.has(e.id)) this.selected.delete(e.id);
      else this.selected.add(e.id);
      this.onChange();
    } else {
      this.select([e.id]);
    }
    this.lastClick = { time: now, id: e.id };
  }

  private rightClick(x: number, y: number): void {
    const ids = this.mySelectedUnits().map((u) => u.id).slice(0, MAX_UNITS_PER_COMMAND);
    const target = this.pick(x, y);
    if (ids.length > 0) {
      if (target && !this.selected.has(target.id)) {
        this.issue({ type: "interact", ids, target: target.id });
        this.feedback(target.x, target.y, target.owner !== GAIA && !this.isFriendly(target.owner) ? 0xef4444 : 0xfacc15);
      } else {
        this.issue({ type: "move", ids, x: Math.round(x), y: Math.round(y) });
        this.feedback(x, y, 0x4ade80);
      }
      return;
    }
    // A building on its own: set its rally point.
    const building = this.selectedEntities().find((e) => e.owner === this.me && BUILDINGS[e.type]);
    if (building) {
      this.issue({ type: "rally", building: building.id, x: Math.round(x), y: Math.round(y) });
      this.feedback(x, y, 0xffffff);
    }
  }

  private attackClick(x: number, y: number, keep: boolean): void {
    const ids = this.mySelectedUnits().map((u) => u.id).slice(0, MAX_UNITS_PER_COMMAND);
    const target = this.pick(x, y);
    if (target && target.owner !== GAIA && !this.isFriendly(target.owner)) this.issue({ type: "interact", ids, target: target.id });
    else this.issue({ type: "attackMove", ids, x: Math.round(x), y: Math.round(y) });
    this.feedback(x, y, 0xef4444);
    if (!keep) this.mode = { k: "normal" };
  }

  private place(x: number, y: number, keep: boolean): void {
    if (this.mode.k !== "place") return;
    const type = this.mode.building;
    const size = BUILDINGS[type]!.size;
    const tx = Math.round(x / TILE - size / 2), ty = Math.round(y / TILE - size / 2);
    const builders = this.mySelectedUnits().filter((u) => u.type === T.Villager);
    if (builders.length === 0) return this.cancelMode();
    if (!this.canPlaceHere(type, tx, ty)) return this.onToast("Can't build there");
    this.issue({ type: "build", ids: builders.map((u) => u.id), building: type, tx, ty });
    this.feedback(x, y, 0x60a5fa);
    if (!keep) this.cancelMode();
  }

  // ------------------------------------------------------------ camera

  private scrollCamera(dt: number): void {
    const cam = this.cameras.main;
    let dx = 0, dy = 0;
    if (this.arrows.left.isDown) dx -= 1;
    if (this.arrows.right.isDown) dx += 1;
    if (this.arrows.up.isDown) dy -= 1;
    if (this.arrows.down.isDown) dy += 1;
    const p = this.input.activePointer;
    if (this.pointerInside && !this.dragStart && !this.panFrom) {
      if (p.x <= EDGE_PX) dx -= 1;
      if (p.x >= this.scale.width - EDGE_PX) dx += 1;
      if (p.y <= TOP_BAR + EDGE_PX && p.y >= TOP_BAR) dy -= 1;
      if (p.y >= this.scale.height - BOTTOM_PANEL - EDGE_PX && p.y <= this.scale.height - BOTTOM_PANEL) dy += 1;
    }
    const speed = (SCROLL_SPEED * dt) / cam.zoom;
    cam.scrollX += Math.sign(dx) * speed;
    cam.scrollY += Math.sign(dy) * speed;
  }

  private zoomAt(p: Phaser.Input.Pointer, wheelDy: number): void {
    const cam = this.cameras.main;
    const before = cam.getWorldPoint(p.x, p.y);
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * (wheelDy > 0 ? 0.9 : 1.1), this.minZoom(), MAX_ZOOM));
    cam.preRender(); // refresh the camera matrix so getWorldPoint uses the new zoom
    const after = cam.getWorldPoint(p.x, p.y);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
  }

  private centerOnHome(): void {
    const tc = [...this.entities.values()].find((e) => e.owner === this.me && e.type === T.TownCenter);
    if (!tc) return;
    this.cameras.main.setZoom(Phaser.Math.Clamp(0.6, this.minZoom(), MAX_ZOOM));
    this.centerOn(tc.x, tc.y);
    this.centered = true;
  }
}
