import Phaser from "phaser";
import { EF, type EntityView } from "@koe/protocol";
import {
  BUILDINGS, FARM_FOOD, GAIA, MAX_UNITS_PER_COMMAND, NODES, T, TILE, UNITS, markVision,
  type Command, type Entity, type World,
} from "@koe/sim";
import {
  FOOT_OFFSET, RES, TREE_OFFSET, TREE_VARIANTS, UNIT_HEIGHT, berriesTexture, buildingGeometry, buildingTexture,
  effectTextures, foundationTexture, goldTexture, mix, treeOrigin, treeTexture, unitOrigin, unitTexture, type Frame,
} from "./art";
import { DEPTH, Fx, worldDepth } from "./fx";
import type { Net } from "./net";
import { TERRAIN_PX, paintTerrain } from "./terrain";

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

/** What's drawn for one entity, plus what we remember about it between frames. */
interface View {
  main: Phaser.GameObjects.Image;
  shadow?: Phaser.GameObjects.Image;
  foundation?: Phaser.GameObjects.Image;
  last: EntityView;
  face: 1 | -1;
  movedAt: number;
  working: EntityView | null;
  workCheckAt: number;
  fxAt: number;
  frame: Frame;
}

const colorOf = (slot: number) => PLAYER_COLORS[slot % PLAYER_COLORS.length]!;
/** Stable per-entity variety (tree shape, mirroring) that every client agrees on. */
const variety = (id: number) => (Math.imul(id, 2654435761) >>> 0) % 997;

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

  private views = new Map<number, View>();
  private fx!: Fx;
  private overlay!: Phaser.GameObjects.Graphics;
  private ghost!: Phaser.GameObjects.Graphics;
  private ghostSprite!: Phaser.GameObjects.Image;
  /** Per tile: 1 + id of the building or resource on it, or 0. */
  private occupant!: Int32Array;
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
    this.occupant = new Int32Array(this.cols * this.rows);
    this.createTerrain();
    effectTextures(this);
    this.fx = new Fx(this);
    this.fogCanvas = this.textures.createCanvas("fog", this.cols, this.rows)!;
    this.add.image(0, 0, "fog").setOrigin(0, 0).setScale(TILE).setDepth(8);
    this.overlay = this.add.graphics().setDepth(9);
    this.ghost = this.add.graphics().setDepth(10);
    this.ghostSprite = this.add.image(0, 0, "puff").setScale(1 / RES).setDepth(10).setVisible(false);

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
      this.syncSprites(time);
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
    this.textures.addCanvas("terrain", paintTerrain(cols, rows, terrain));
    this.add.image(0, 0, "terrain").setOrigin(0, 0).setScale(TILE / TERRAIN_PX).setDepth(0);
  }

  private createView(e: EntityView): View {
    const v: View = { main: null!, last: { ...e }, face: variety(e.id) % 2 ? 1 : -1, movedAt: 0, working: null, workCheckAt: 0, fxAt: 0, frame: 0 };
    const unit = UNITS[e.type];
    if (unit) {
      const w = unit.radius * (e.type === T.Scout ? 3 : 2.4);
      v.shadow = this.add.image(e.x, e.y + FOOT_OFFSET, "shadow").setDisplaySize(w, w * 0.38).setDepth(DEPTH.shadow);
      v.main = this.add.image(e.x, e.y, unitTexture(this, e.type, e.owner, colorOf(e.owner), 0)).setOrigin(unitOrigin.x, unitOrigin.y);
    } else if (BUILDINGS[e.type]) {
      const g = buildingGeometry(e.type);
      v.main = this.add.image(e.x, e.y + g.F / 2, buildingTexture(this, e.type, e.owner, colorOf(e.owner)))
        .setOrigin(g.originX, g.originY)
        .setDepth(e.type === T.Farm ? DEPTH.farm : worldDepth(e.y + g.F / 2));
    } else if (e.type === T.Tree) {
      const n = variety(e.id);
      v.main = this.add.image(e.x, e.y + TREE_OFFSET, treeTexture(this, n % TREE_VARIANTS))
        .setOrigin(treeOrigin.x, treeOrigin.y).setFlipX(n % 2 === 0).setDepth(worldDepth(e.y + TREE_OFFSET));
    } else {
      const key = e.type === T.GoldMine ? goldTexture(this) : berriesTexture(this, true);
      v.main = this.add.image(e.x, e.y + 14, key).setOrigin(0.5, e.type === T.GoldMine ? 62 / 80 : 50 / 64).setDepth(worldDepth(e.y + 14));
    }
    const scale = e.type === T.Tree ? 0.9 + (variety(e.id) % 23) / 100 : 1;
    v.main.setScale(scale / RES);
    return v;
  }

  private syncSprites(now: number): void {
    for (const [id, e] of this.entities) {
      let v = this.views.get(id);
      if (!v) {
        v = this.createView(e);
        this.views.set(id, v);
        v.last.hp = -1; // force a first update
      }
      if (UNITS[e.type]) this.updateUnit(v, e, now);
      else if (BUILDINGS[e.type]) this.updateBuilding(v, e, now);
      else if (e.hp !== v.last.hp && e.type === T.Berries) v.main.setTexture(berriesTexture(this, e.hp > NODES[T.Berries]!.amount / 2));
      v.last.x = e.x;
      v.last.y = e.y;
      v.last.hp = e.hp;
      v.last.flags = e.flags;
    }
    for (const [id, v] of this.views) {
      if (this.entities.has(id)) continue;
      this.onGone(v);
      v.main.destroy();
      v.shadow?.destroy();
      v.foundation?.destroy();
      this.views.delete(id);
      if (this.selected.delete(id)) this.onChange();
    }
  }

  private updateUnit(v: View, e: EntityView, now: number): void {
    const dx = e.x - v.last.x, dy = e.y - v.last.y;
    if (dx * dx + dy * dy > 0.01) {
      v.movedAt = now;
      if (Math.abs(dx) > 0.05) v.face = dx > 0 ? 1 : -1;
    }
    const moving = now - v.movedAt < 150;
    const attacking = (e.flags & EF.Attacking) !== 0;
    if (attacking && !(v.last.flags & EF.Attacking)) this.onStrike(v, e);

    // A villager standing still with an order next to a resource or building site is working.
    if (e.type !== T.Villager || moving || e.flags & EF.Idle) v.working = null;
    else if (now > v.workCheckAt) {
      v.working = this.workTarget(e);
      v.workCheckAt = now + 400;
    }
    if (v.working && Math.abs(v.working.x - e.x) > 4) v.face = v.working.x > e.x ? 1 : -1;

    let frame: Frame = 0;
    if (attacking) frame = 3;
    else if (moving) frame = Math.floor(now / 150 + e.id * 0.5) % 2 ? 1 : 2;
    else if (v.working) frame = Math.floor(now / 400 + e.id * 0.3) % 2 ? 3 : 0;
    if (frame === 3 && v.frame !== 3 && v.working) this.workFx(v.working, e);
    v.frame = frame;

    const key = unitTexture(this, e.type, e.owner, colorOf(e.owner), frame, e.type === T.Villager && (e.flags & EF.Carrying) !== 0);
    if (v.main.texture.key !== key) v.main.setTexture(key);
    const y = e.y + FOOT_OFFSET;
    const lunge = attacking && e.type !== T.Archer ? v.face * 4 : 0;
    v.main.setPosition(e.x + lunge, y).setFlipX(v.face < 0).setDepth(worldDepth(y));
    v.shadow!.setPosition(e.x, y);
  }

  private updateBuilding(v: View, e: EntityView, now: number): void {
    const def = BUILDINGS[e.type]!;
    const g = buildingGeometry(e.type);
    const building = (e.flags & EF.UnderConstruction) !== 0;
    if (building) {
      if (!v.foundation) v.foundation = this.add.image(e.x, e.y, foundationTexture(this, def.size)).setScale(1 / RES).setDepth(DEPTH.foundation);
      if (e.hp !== v.last.hp) {
        const p = Phaser.Math.Clamp(e.hp / def.hp, 0, 1);
        if (e.type === T.Farm) v.main.setAlpha(0.25 + p * 0.75);
        else {
          // Rise from the ground up as the work progresses.
          const cut = Math.floor((g.rise + g.F) * RES * (1 - Math.max(0.04, p)));
          v.main.setCrop(0, cut, g.w * RES, g.h * RES - cut);
        }
        if (v.last.hp >= 0 && now > v.fxAt) {
          this.fx.dust(e.x + (Math.random() - 0.5) * g.F * 0.8, e.y + (Math.random() - 0.2) * g.F * 0.5);
          v.fxAt = now + 350;
        }
      }
      return;
    }
    if (v.foundation) {
      v.foundation.destroy();
      v.foundation = undefined;
      v.main.setCrop().setAlpha(1);
      if (v.last.hp >= 0) for (let i = 0; i < 6; i++) this.fx.dust(e.x + (Math.random() - 0.5) * g.F, e.y + g.F * 0.3);
    }
    if (e.type === T.Farm) {
      if (e.hp !== v.last.hp) v.main.setTint(mix(0x9a8060, 0xffffff, 0.3 + 0.7 * Phaser.Math.Clamp(e.hp / FARM_FOOD, 0, 1)));
      return;
    }
    if (e.flags & EF.Attacking && !(v.last.flags & EF.Attacking)) this.onStrike(v, e);
    // Smoke, then fire, as a building takes damage.
    const health = e.hp / def.hp;
    if (health < 0.66 && now > v.fxAt) {
      const x = e.x + (Math.random() - 0.5) * g.F * 0.6, y = e.y - g.F * 0.2 + (Math.random() - 0.5) * g.F * 0.4;
      this.fx.smoke(x, y);
      if (health < 0.4) this.fx.flame(x, y + 6);
      v.fxAt = now + (health < 0.4 ? 160 : 450);
    }
  }

  /** A unit or Town Center just struck: face the target and show the blow or the arrow. */
  private onStrike(v: View, e: EntityView): void {
    const unit = UNITS[e.type];
    const tc = BUILDINGS[e.type]?.attack;
    const reach = unit ? unit.range + unit.radius + 80 : (tc?.range ?? 0) + 120;
    const target = this.nearestHostile(e, reach);
    if (!target) return;
    const ty = target.y - (UNITS[target.type] ? 14 : 0);
    if (unit) v.face = target.x >= e.x ? 1 : -1;
    if (e.type === T.Archer) this.fx.arrow(e.x + v.face * 14, e.y - 10, target.x, ty);
    else if (tc) this.fx.arrow(e.x, e.y - buildingGeometry(e.type).F * 0.55, target.x, ty);
    else this.fx.hit((e.x + target.x) / 2, (e.y + ty) / 2 - 6);
  }

  private nearestHostile(e: EntityView, reach: number): EntityView | null {
    let best: EntityView | null = null;
    let bestD = reach * reach;
    for (const o of this.entities.values()) {
      if (o.owner === GAIA || o.owner === e.owner || this.sameTeam(o.owner, e.owner)) continue;
      const pad = (BUILDINGS[o.type]?.size ?? 0) * TILE * 0.5;
      const d = (o.x - e.x) ** 2 + (o.y - e.y) ** 2 - pad * pad;
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  private sameTeam(a: number, b: number): boolean {
    const seats = this.net.started!.seats;
    const ta = seats.find((s) => s.slot === a)?.team ?? 0;
    return ta !== 0 && ta === seats.find((s) => s.slot === b)?.team;
  }

  /** The resource, field or building site next to a villager, if any. */
  private workTarget(e: EntityView): EntityView | null {
    const tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
    for (let y = ty - 1; y <= ty + 1; y++) {
      for (let x = tx - 1; x <= tx + 1; x++) {
        if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) continue;
        const o = this.entities.get(this.occupant[y * this.cols + x]! - 1);
        if (o && (NODES[o.type] || o.type === T.Farm || o.flags & EF.UnderConstruction)) return o;
      }
    }
    return null;
  }

  private workFx(target: EntityView, e: EntityView): void {
    const x = (e.x + target.x) / 2, y = e.y - 4;
    if (target.type === T.Tree) this.fx.chips(x, y - 8, 0xd8b07a);
    else if (target.type === T.GoldMine) this.fx.chips(x, y - 6, 0xffd75a);
    else if (target.type === T.Farm || target.flags & EF.UnderConstruction) this.fx.dust(e.x + this.face(e) * 10, e.y + 10);
  }

  private face(e: EntityView): number {
    return this.views.get(e.id)?.face ?? 1;
  }

  /** What's left when an entity disappears: a fallen unit, rubble, a stump. */
  private onGone(v: View): void {
    const e = v.last;
    if (e.hp < 0) return;
    const tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
    // Everything near this spot is in sight, so it didn't just walk into the fog.
    let inSight = true;
    for (let y = ty - 1; y <= ty + 1 && inSight; y++) {
      for (let x = tx - 1; x <= tx + 1; x++) if (this.fog[Math.max(0, Math.min(this.rows - 1, y)) * this.cols + Math.max(0, Math.min(this.cols - 1, x))] !== 2) inSight = false;
    }
    const unit = UNITS[e.type];
    const building = BUILDINGS[e.type];
    if (unit) {
      if (this.isFriendly(e.owner) || (inSight && e.hp <= unit.hp * 0.5)) this.fx.corpse(v.main);
    } else if (building) {
      if (e.type !== T.Farm && (this.isFriendly(e.owner) || inSight)) this.fx.collapse(v.main, e.x, e.y, building.size);
    } else if (e.type === T.Tree) {
      this.fx.stump(e.x, e.y + 10);
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
    this.occupant.fill(0);
    for (const e of (this.net.latest() ?? this.entities).values()) {
      const size = BUILDINGS[e.type]?.size ?? (NODES[e.type] ? 1 : 0);
      if (size === 0) continue;
      const tx = Math.round(e.x / TILE - size / 2), ty = Math.round(e.y / TILE - size / 2);
      for (let y = ty; y < ty + size; y++) {
        for (let x = tx; x < tx + size; x++) {
          if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
          this.occupancy[y * cols + x] = 1;
          this.occupant[y * cols + x] = e.id + 1;
        }
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
      const radius = UNITS[e.type]?.radius ?? 16;
      if (selected) {
        g.lineStyle(px(2), e.owner === this.me ? 0xffffff : e.owner === GAIA ? 0xe8e0b0 : 0xff6b6b, 0.95);
        if (size) g.strokeRect(e.x - size / 2 - 3, e.y - size / 2 - 3, size + 6, size + 6);
        else g.strokeEllipse(e.x, e.y + FOOT_OFFSET, radius * 2.8, radius * 1.3);
      }
      // Health bars for selected or damaged units and buildings.
      const max = UNITS[e.type]?.hp ?? BUILDINGS[e.type]?.hp;
      if (!max || e.owner === GAIA || (e.type === T.Farm && !(e.flags & EF.UnderConstruction))) continue;
      if (!selected && e.hp >= max) continue;
      const w = size ? size * 0.8 : 30;
      const above = e.flags & EF.UnderConstruction ? 0 : buildingGeometry(e.type).rise * 0.8;
      const y = size ? e.y - size / 2 - above - 8 : e.y + FOOT_OFFSET - UNIT_HEIGHT - 8;
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
    if (this.mode.k !== "place") {
      this.ghostSprite.setVisible(false);
      return;
    }
    const type = this.mode.building;
    const p = this.input.activePointer;
    const size = BUILDINGS[type]!.size;
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    const tx = Math.round(w.x / TILE - size / 2), ty = Math.round(w.y / TILE - size / 2);
    const ok = this.canPlaceHere(type, tx, ty);
    const geo = buildingGeometry(type);
    this.ghostSprite
      .setTexture(buildingTexture(this, type, this.me, colorOf(this.me)))
      .setOrigin(geo.originX, geo.originY)
      .setPosition((tx + size / 2) * TILE, (ty + size) * TILE)
      .setTint(ok ? 0xffffff : 0xff7070)
      .setAlpha(0.7)
      .setVisible(true);
    g.fillStyle(ok ? 0x4ade80 : 0xef4444, 0.25).fillRect(tx * TILE, ty * TILE, size * TILE, size * TILE);
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
      // Sprites rise above the ground they stand on, so the clickable area does too.
      const unit = UNITS[e.type];
      const size = (BUILDINGS[e.type]?.size ?? 1) * TILE;
      const above = unit ? 0 : BUILDINGS[e.type] ? buildingGeometry(e.type).rise * 0.8 : e.type === T.Tree ? 50 : 16;
      const hit = unit
        ? Math.abs(wx - e.x) <= unit.radius + 4 && wy <= e.y + FOOT_OFFSET + 4 && wy >= e.y + FOOT_OFFSET - UNIT_HEIGHT
        : Math.abs(wx - e.x) <= size / 2 && wy <= e.y + size / 2 && wy >= e.y - size / 2 - above;
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
