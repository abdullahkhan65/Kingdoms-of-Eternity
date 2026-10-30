import { EF, type EntityView } from "@koe/protocol";
import {
  AGE_NAMES, BUILD_MENU, BUILDINGS, GAIA, NODES, RESOURCES, T, TECH_AGE2, TILE, UNITS, costOf, nameOf,
  type Cost,
} from "@koe/sim";
import { colorCss, type GameScene } from "./GameScene";
import type { Net } from "./net";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SLOT_KEYS = ["q", "w", "e", "r", "t", "y"];
const RES_ICON = { food: "🌾", wood: "🪵", gold: "🪙" } as const;

interface CommandButton {
  label: string;
  key: string;
  cost?: Cost;
  enabled: boolean;
  title: string;
  run: () => void;
}

const costText = (cost: Cost) => RESOURCES.filter((r) => cost[r]).map((r) => `${RES_ICON[r]}${cost[r]}`).join(" ");

/** The HTML parts of the game screen: top bar, selection panel, commands, minimap, toasts, end screen. */
export class Hud {
  private buttons: CommandButton[] = [];
  private commandsKey = "";
  private infoKey = "";
  private minimapTerrain: HTMLCanvasElement;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private endShown = false;

  constructor(private readonly scene: GameScene, private readonly net: Net) {
    scene.onChange = () => this.refresh(true);
    scene.onToast = (text) => this.toast(text);
    this.minimapTerrain = this.renderMinimapTerrain();
    this.bindMinimap();
    $("idle-btn").onclick = () => scene.selectIdleVillager();
    setInterval(() => this.refresh(false), 150);
    setInterval(() => this.drawMinimap(), 250);
  }

  handleKey(ev: KeyboardEvent): boolean {
    const key = ev.key.toLowerCase();
    const button = this.buttons.find((b) => b.key === key);
    if (!button) return false;
    if (button.enabled) button.run();
    else this.toast(button.title);
    return true;
  }

  toast(text: string): void {
    const el = $("toast");
    el.textContent = text;
    el.style.opacity = "1";
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (el.style.opacity = "0"), 1800);
  }

  refresh(force: boolean): void {
    const you = this.net.you;
    if (you) {
      $("r-food").textContent = `🌾 ${you.food}`;
      $("r-wood").textContent = `🪵 ${you.wood}`;
      $("r-gold").textContent = `🪙 ${you.gold}`;
      $("r-pop").textContent = `👥 ${you.pop}/${you.cap}`;
      $("r-pop").style.color = you.pop >= you.cap ? "var(--bad)" : "";
      $("r-age").textContent = AGE_NAMES[you.age] ?? "";
    }
    $("idle-btn").textContent = `Idle villagers: ${this.scene.idleVillagers().length}`;
    $("r-ping").textContent = `ping ${Math.round(this.net.rttMs)} ms`;
    this.renderInfo(force);
    this.renderCommands(force);
    this.checkEnd();
  }

  // ------------------------------------------------------------ selection panel

  private renderInfo(force: boolean): void {
    const sel = this.scene.selectedEntities();
    const queues = this.net.you?.queues ?? {};
    const key = JSON.stringify([sel.map((e) => [e.id, e.hp, e.flags]), sel.length === 1 ? queues[sel[0]!.id] : null]);
    if (!force && key === this.infoKey) return;
    this.infoKey = key;
    const info = $("info");

    if (sel.length === 0) {
      info.innerHTML = `<h3>${AGE_NAMES[this.net.you?.age ?? 1]}</h3><div class="small">Select units with a click or drag. Right-click to move, gather, build or attack. See <b>Help</b> for all keys.</div>`;
      return;
    }
    if (sel.length > 1) {
      const counts = new Map<number, number>();
      for (const e of sel) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
      info.innerHTML = `<h3>${sel.length} selected</h3><div class="multi">${[...counts].map(([t, n]) => `<span>${nameOf(t)} ×${n}</span>`).join("")}</div>`;
      return;
    }

    const e = sel[0]!;
    const owner = e.owner === GAIA ? "" : this.seatName(e.owner);
    let html = `<h3>${nameOf(e.type)}</h3>`;
    if (owner) html += `<div class="small"><span class="swatch" style="background:${colorCss(e.owner)}"></span>${owner}</div>`;
    if (NODES[e.type]) {
      html += `<div>${RES_ICON[NODES[e.type]!.res]} ${e.hp} left</div>`;
    } else if (e.type === T.Farm && !(e.flags & EF.UnderConstruction)) {
      html += `<div>🌾 ${e.hp} food left</div>`;
    } else {
      const max = UNITS[e.type]?.hp ?? BUILDINGS[e.type]?.hp ?? 1;
      html += `<div class="bar"><div style="width:${Math.max(0, (100 * e.hp) / max)}%"></div></div><div class="small">${e.hp} / ${max} HP</div>`;
      const unit = UNITS[e.type];
      if (unit) html += `<div class="small">Attack ${unit.attack} · Armor ${unit.armor} · Range ${unit.range > 20 ? Math.round(unit.range / TILE) + " tiles" : "melee"}</div>`;
      if (e.flags & EF.UnderConstruction) html += `<div class="small">Under construction · ${Math.round((100 * e.hp) / max)}%</div>`;
      if (e.flags & EF.Carrying) html += `<div class="small">Carrying resources</div>`;
    }
    const q = queues[e.id];
    if (q && e.owner === this.scene.me) {
      html += `<div class="bar"><div style="width:${Math.round(q.progress * 100)}%;background:var(--gold)"></div></div>`;
      html += `<div class="queue">${q.items.map((item, i) => `<button data-cancel="${i}" title="Cancel (refund)">${i === 0 ? "▶ " : ""}${nameOf(item)} ✕</button>`).join("")}</div>`;
    }
    info.innerHTML = html;
    info.querySelectorAll<HTMLButtonElement>("[data-cancel]").forEach((b) => {
      b.onclick = () => this.scene.issue({ type: "cancel", building: e.id, index: Number(b.dataset.cancel) });
    });
  }

  private seatName(slot: number): string {
    return this.net.started?.seats.find((s) => s.slot === slot)?.name ?? `Player ${slot + 1}`;
  }

  // ------------------------------------------------------------ commands

  private renderCommands(force: boolean): void {
    this.buttons = this.buildCommands();
    const key = JSON.stringify(this.buttons.map((b) => [b.label, b.key, b.enabled]));
    if (!force && key === this.commandsKey) return;
    this.commandsKey = key;
    const el = $("commands");
    el.innerHTML = "";
    for (const b of this.buttons) {
      const btn = document.createElement("button");
      btn.disabled = !b.enabled;
      btn.title = b.title;
      btn.innerHTML = `<span class="key">${b.key === "delete" ? "Del" : b.key.toUpperCase()}</span>${b.label}${b.cost ? `<span class="cost">${costText(b.cost)}</span>` : ""}`;
      btn.onclick = () => b.run();
      el.appendChild(btn);
    }
  }

  private buildCommands(): CommandButton[] {
    const you = this.net.you;
    if (!you) return [];
    const me = this.scene.me;
    const sel = this.scene.selectedEntities().filter((e) => e.owner === me);
    if (sel.length === 0) return [];
    const afford = (cost: Cost) => RESOURCES.every((r) => you[r] >= (cost[r] ?? 0));
    const why = (cost: Cost, age: number) => (age > you.age ? `Requires ${AGE_NAMES[age]}` : !afford(cost) ? "Not enough resources" : "");
    const out: CommandButton[] = [];

    const units = sel.filter((e) => UNITS[e.type]);
    if (units.length > 0) {
      if (units.some((e) => e.type === T.Villager)) {
        BUILD_MENU.forEach((type, i) => {
          const def = BUILDINGS[type]!;
          const reason = why(def.cost, def.age);
          out.push({ label: def.name, key: SLOT_KEYS[i]!, cost: def.cost, enabled: !reason, title: reason || `Build a ${def.name}`, run: () => this.scene.startPlacement(type) });
        });
      }
      out.push({ label: "Attack-move", key: "a", enabled: true, title: "Move, fighting anything on the way", run: () => this.scene.startAttackMove() });
      out.push({ label: "Stop", key: "s", enabled: true, title: "Stop", run: () => this.scene.issue({ type: "stop", ids: units.map((u) => u.id) }) });
      return out;
    }

    const b = sel[0]!;
    const def = BUILDINGS[b.type];
    if (!def || b.flags & EF.UnderConstruction || sel.length > 1) return out;
    const queued = you.queues[b.id]?.items.length ?? 0;
    def.trains.forEach((unit, i) => {
      const u = UNITS[unit]!;
      const reason = queued >= 5 ? "Queue is full" : why(u.cost, u.age);
      out.push({ label: u.name, key: SLOT_KEYS[i]!, cost: u.cost, enabled: !reason, title: reason || `Train ${u.name}`, run: () => this.scene.issue({ type: "train", building: b.id, unit }) });
    });
    if (b.type === T.TownCenter && you.age < 2) {
      const researching = Object.values(you.queues).some((q) => q.items.includes(TECH_AGE2));
      const cost = costOf(TECH_AGE2);
      const reason = researching ? "Already researching" : queued >= 5 ? "Queue is full" : why(cost, 1);
      out.push({ label: `Advance to ${AGE_NAMES[2]}`, key: SLOT_KEYS[def.trains.length]!, cost, enabled: !reason, title: reason || "Unlocks Swordsmen, Archery Range and more Town Centers", run: () => this.scene.issue({ type: "research", building: b.id, tech: TECH_AGE2 }) });
    }
    return out;
  }

  // ------------------------------------------------------------ minimap

  private renderMinimapTerrain(): HTMLCanvasElement {
    const { cols, rows, terrain } = this.net.started!;
    const c = document.createElement("canvas");
    c.width = cols;
    c.height = rows;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(cols, rows);
    for (let i = 0; i < terrain.length; i++) {
      const [r, g, b] = terrain[i] === 1 ? [40, 95, 155] : [56, 108, 38];
      img.data.set([r, g, b, 255], i * 4);
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  private drawMinimap(): void {
    const canvas = $<HTMLCanvasElement>("minimap");
    const ctx = canvas.getContext("2d")!;
    const { cols, rows } = this.net.started!;
    const sx = canvas.width / cols, sy = canvas.height / rows;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.minimapTerrain, 0, 0, canvas.width, canvas.height);

    for (const e of this.scene.entities.values()) {
      const tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
      if (this.scene.fog[ty * cols + tx] === 0) continue;
      if (e.owner === GAIA) {
        ctx.fillStyle = e.type === T.Tree ? "#14361a" : e.type === T.GoldMine ? "#e8b33c" : "#c0263e";
        ctx.fillRect(tx * sx, ty * sy, Math.ceil(sx), Math.ceil(sy));
        continue;
      }
      ctx.fillStyle = colorCss(e.owner);
      const size = BUILDINGS[e.type]?.size ?? 1.5;
      ctx.fillRect(e.x / TILE * sx - (size * sx) / 2, e.y / TILE * sy - (size * sy) / 2, Math.max(2, size * sx), Math.max(2, size * sy));
    }
    // Fog: black where never seen, dimmed where not visible now.
    const fog = this.scene.fog;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const f = fog[y * cols + x];
        if (f === 2) continue;
        ctx.fillStyle = f === 0 ? "#000" : "rgba(0,0,0,0.45)";
        ctx.fillRect(x * sx, y * sy, Math.ceil(sx), Math.ceil(sy));
      }
    }
    const v = this.scene.view();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.strokeRect((v.x / TILE) * sx, (v.y / TILE) * sy, (v.width / TILE) * sx, (v.height / TILE) * sy);
  }

  private bindMinimap(): void {
    const canvas = $<HTMLCanvasElement>("minimap");
    const toWorld = (ev: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const { cols, rows } = this.net.started!;
      return { x: ((ev.clientX - r.left) / r.width) * cols * TILE, y: ((ev.clientY - r.top) / r.height) * rows * TILE };
    };
    let dragging = false;
    canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());
    canvas.addEventListener("mousedown", (ev) => {
      const w = toWorld(ev);
      if (ev.button === 2) {
        const ids = this.scene.mySelectedUnits().map((u) => u.id);
        if (ids.length) this.scene.issue({ type: "move", ids, x: Math.round(w.x), y: Math.round(w.y) });
        return;
      }
      dragging = true;
      this.scene.centerOn(w.x, w.y);
    });
    window.addEventListener("mousemove", (ev) => {
      if (!dragging) return;
      const w = toWorld(ev);
      this.scene.centerOn(w.x, w.y);
    });
    window.addEventListener("mouseup", () => (dragging = false));
  }

  // ------------------------------------------------------------ end of match

  private checkEnd(): void {
    const { winners, defeated } = this.net.players;
    const me = this.scene.me;
    if (this.endShown) return;
    if (winners !== null) {
      this.showEnd(winners.includes(me) ? "Victory!" : "Defeat", winners.length ? `Winners: ${winners.map((s) => this.seatName(s)).join(", ")}` : "Nobody survived.");
    } else if (defeated.includes(me)) {
      this.showEnd("Defeat", "Your Town Centers have fallen. You can keep watching the match.");
    }
  }

  private showEnd(title: string, text: string): void {
    this.endShown = true;
    $("end-title").textContent = title;
    $("end-title").style.color = title === "Victory!" ? "var(--gold)" : "var(--bad)";
    $("end-text").textContent = text;
    $("end").classList.remove("hidden");
  }
}

