import { performance } from "node:perf_hooks";
import { Room, type Client } from "@colyseus/core";
import {
  EF, Msg, SnapshotEncoder,
  type EntityView, type LobbyState, type PlayersMsg, type SeatInfo, type StartedMsg, type YouMsg,
} from "@koe/protocol";
import {
  BOT_INTERVAL, CIVS, GAIA, MAX_PLAYERS, MAX_POP, T, TICK_RATE, TILE, UNITS,
  applyCommand, entitiesVisibleTo, generateMatch, newBotMemory, population, queueItemTime, runBot, spawnUnit, step, teamOf,
  type BotMemory, type Entity, type World,
} from "@koe/sim";
import { StatsCollector } from "./stats";

/** Snapshots go out every Nth sim tick: 20 Hz sim / 2 = 10 Hz network. */
const SEND_EVERY_TICKS = 2;
/** Private resource/queue updates: 4 per second. */
const YOU_EVERY_TICKS = 5;
const RECONNECT_SECONDS = 60;
const BOT_NAMES = ["Warden Ilse", "Marshal Oren", "Lady Veyra", "Thane Corvin", "Abbess Maren", "Captain Hollis", "Reeve Tamsin"];

export interface MatchOptions {
  /** Computer players to seat at creation (e.g. "play vs computer"). */
  bots?: number;
  /** Start as soon as the first human joins. */
  autoStart?: boolean;
  seed?: number;
  /** Load testing only: extra Spearmen per player at the start. */
  extraUnits?: number;
}

interface Seat extends SeatInfo {
  client?: Client<{ userData: { slot: number } }>;
  encoder?: SnapshotEncoder;
}

type PlayerClient = Client<{ userData: { slot: number } }>;

export class MatchRoom extends Room<{ client: PlayerClient }> {
  private phase: "lobby" | "playing" | "ended" = "lobby";
  private seats = new Map<number, Seat>();
  private host = -1;
  private world: World | null = null;
  private bots = new Map<number, BotMemory>();
  private pending: Array<{ slot: number; payload: unknown }> = [];
  private lastDefeated = 0;
  private options: MatchOptions = {};
  private stats = new StatsCollector();
  private loop?: NodeJS.Timeout;

  override onCreate(options: unknown): void {
    this.options = cleanOptions(options);
    this.maxClients = MAX_PLAYERS;
    this.patchRate = null; // we send our own snapshots
    for (let i = 0; i < (this.options.bots ?? 0); i++) this.addBot();

    this.onMessage(Msg.SetSeat, (client, msg: unknown) => this.setSeat(client, msg));
    this.onMessage(Msg.AddBot, (client) => {
      if (this.isHost(client)) this.addBot();
    });
    this.onMessage(Msg.RemoveBot, (client, slot: unknown) => {
      if (this.isHost(client) && this.phase === "lobby" && this.seats.get(slot as number)?.bot) {
        this.seats.delete(slot as number);
        this.broadcastLobby();
      }
    });
    this.onMessage(Msg.Start, (client) => {
      if (this.isHost(client)) this.startMatch();
    });
    this.onMessage(Msg.Command, (client, payload: unknown) => {
      if (this.phase === "playing") this.pending.push({ slot: client.userData!.slot, payload });
    });
    this.onMessage(Msg.Ping, (client, sentAt: unknown) => {
      if (typeof sentAt === "number") client.send(Msg.Pong, sentAt);
    });
    this.onMessage(Msg.Stats, (client) => client.send(Msg.Stats, this.stats.report(this.world?.entities.size ?? 0)));
    this.onMessage(Msg.StatsReset, () => this.stats.reset());
  }

  override onJoin(client: PlayerClient, options: { name?: unknown } = {}): void {
    if (this.phase !== "lobby") throw new Error("This match has already started.");
    const slot = this.freeSlot();
    if (slot < 0) throw new Error("This match is full.");
    this.seats.set(slot, { slot, name: cleanName(options.name, `Player ${slot + 1}`), team: 0, civ: slot % CIVS.length, bot: false, connected: true, client });
    client.userData = { slot };
    if (this.host < 0) this.host = slot;
    this.broadcastLobby();
    if (this.options.autoStart) this.startMatch();
  }

  override onDrop(client: PlayerClient): void {
    // Lobby seats are cheap to rejoin, so only matches hold a seat open.
    if (this.phase === "lobby") return;
    const seat = this.seats.get(client.userData!.slot);
    if (seat) seat.connected = false;
    this.allowReconnection(client, RECONNECT_SECONDS);
  }

  override onReconnect(client: PlayerClient): void {
    const seat = this.seats.get(client.userData!.slot);
    if (!seat) return;
    seat.connected = true;
    seat.client = client;
    seat.encoder = new SnapshotEncoder(); // next snapshot is a keyframe
    this.sendStarted(seat);
  }

  override onLeave(client: PlayerClient): void {
    const slot = client.userData?.slot;
    if (slot === undefined) return;
    if (this.phase === "lobby") {
      this.seats.delete(slot);
      if (this.host === slot) this.host = [...this.seats.values()].find((s) => !s.bot)?.slot ?? -1;
      this.broadcastLobby();
      return;
    }
    const seat = this.seats.get(slot);
    if (seat) {
      seat.connected = false;
      seat.client = undefined;
    }
    // Gone for good (left, or didn't return in time): resign so the match can finish.
    if (this.phase === "playing" && this.world) applyCommand(this.world, slot, { type: "resign" });
  }

  override onDispose(): void {
    clearInterval(this.loop);
  }

  // ------------------------------------------------------------ lobby

  private isHost(client: PlayerClient): boolean {
    return this.phase === "lobby" && client.userData?.slot === this.host;
  }

  private freeSlot(): number {
    for (let slot = 0; slot < MAX_PLAYERS; slot++) if (!this.seats.has(slot)) return slot;
    return -1;
  }

  private addBot(): void {
    if (this.phase !== "lobby") return;
    const slot = this.freeSlot();
    if (slot < 0) return;
    this.seats.set(slot, { slot, name: BOT_NAMES[slot % BOT_NAMES.length]!, team: 0, civ: slot % CIVS.length, bot: true, connected: true });
    this.broadcastLobby();
  }

  private setSeat(client: PlayerClient, msg: unknown): void {
    if (this.phase !== "lobby" || typeof msg !== "object" || msg === null) return;
    const m = msg as Record<string, unknown>;
    // The host may also set teams/civs for bot seats.
    const targetSlot = Number.isInteger(m.slot) && this.isHost(client) && this.seats.get(m.slot as number)?.bot ? (m.slot as number) : client.userData!.slot;
    const seat = this.seats.get(targetSlot);
    if (!seat) return;
    if (m.name !== undefined && !seat.bot) seat.name = cleanName(m.name, seat.name);
    if (Number.isInteger(m.team) && (m.team as number) >= 0 && (m.team as number) <= 4) seat.team = m.team as number;
    if (Number.isInteger(m.civ) && (m.civ as number) >= 0 && (m.civ as number) < CIVS.length) seat.civ = m.civ as number;
    this.broadcastLobby();
  }

  private broadcastLobby(): void {
    const seats = [...this.seats.values()].map(publicSeat).sort((a, b) => a.slot - b.slot);
    for (const client of this.clients) {
      const state: LobbyState = { you: client.userData!.slot, roomId: this.roomId, host: this.host, seats };
      client.send(Msg.Lobby, state);
    }
  }

  // ------------------------------------------------------------ match

  private startMatch(): void {
    if (this.phase !== "lobby" || this.seats.size === 0) return;
    void this.lock();
    const seats = [...this.seats.values()].sort((a, b) => a.slot - b.slot);
    const seed = this.options.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.world = generateMatch(seed, seats.map(({ slot, team, civ }) => ({ slot, team, civ })));
    if (this.options.extraUnits) this.spawnExtraUnits(this.options.extraUnits);
    for (const seat of seats) {
      if (seat.bot) this.bots.set(seat.slot, newBotMemory());
      else seat.encoder = new SnapshotEncoder();
    }
    this.phase = "playing";
    for (const seat of seats) this.sendStarted(seat);
    this.startLoop();
  }

  private spawnExtraUnits(perPlayer: number): void {
    const world = this.world!;
    for (const tc of [...world.entities.values()].filter((e) => e.type === T.TownCenter)) {
      for (let i = 0; i < perPlayer; i++) {
        spawnUnit(world, tc.owner, tc.x + ((i % 10) - 5) * TILE * 0.6, tc.y + (3 + Math.floor(i / 10)) * TILE * 0.6, T.Spearman);
      }
    }
  }

  private sendStarted(seat: Seat): void {
    if (!seat.client || !this.world) return;
    const msg: StartedMsg = {
      you: seat.slot,
      cols: this.world.cols,
      rows: this.world.rows,
      terrain: this.world.terrain,
      seats: [...this.seats.values()].map(publicSeat).sort((a, b) => a.slot - b.slot),
      tickRate: TICK_RATE,
      sendEveryTicks: SEND_EVERY_TICKS,
    };
    seat.client.send(Msg.Started, msg);
    seat.client.send(Msg.Players, this.playersMsg());
  }

  /**
   * Fixed 20 Hz loop with our own accumulator. Not Room.setFixedTimestep:
   * Colyseus 0.18 also ticks the room clock from a second interval when
   * patchRate is null, which steals elapsed time and slowed the sim to ~6 Hz.
   */
  private startLoop(): void {
    const stepMs = 1000 / TICK_RATE;
    const maxCatchUp = 5;
    let last = performance.now();
    let acc = 0;
    this.loop = setInterval(() => {
      const now = performance.now();
      acc += now - last;
      last = now;
      let ran = 0;
      while (acc >= stepMs && ran < maxCatchUp) {
        acc -= stepMs;
        this.tick();
        ran++;
      }
      if (ran === maxCatchUp) acc = 0; // Overloaded: drop time rather than spiral.
    }, stepMs / 2);
  }

  private tick(): void {
    const world = this.world!;
    const start = performance.now();
    if (world.tick % BOT_INTERVAL === 0) for (const [slot, memory] of this.bots) runBot(world, slot, memory);
    for (const { slot, payload } of this.pending) {
      if (applyCommand(world, slot, payload).ok) this.stats.commandsAccepted++;
      else this.stats.commandsRejected++;
    }
    this.pending.length = 0;
    step(world);
    this.stats.recordTick(performance.now() - start);

    const defeated = world.players.filter((p) => p?.defeated).length;
    if (defeated !== this.lastDefeated || (world.winnerTeam !== null && this.phase === "playing")) {
      this.lastDefeated = defeated;
      if (world.winnerTeam !== null) this.phase = "ended";
      this.broadcast(Msg.Players, this.playersMsg());
    }

    const netStart = performance.now();
    this.sendSnapshots();
    this.stats.recordNet(performance.now() - netStart);
    if (world.tick % YOU_EVERY_TICKS === 0) this.sendYou();
  }

  /**
   * Each player gets a snapshot every SEND_EVERY_TICKS ticks, staggered by
   * slot so the fog-of-war work for 8 players is spread over ticks instead of
   * landing on the same one.
   */
  private sendSnapshots(): void {
    const world = this.world!;
    for (const seat of this.seats.values()) {
      if (!seat.client || !seat.encoder || (world.tick + seat.slot) % SEND_EVERY_TICKS !== 0) continue;
      // Defeated players and finished matches reveal the whole map.
      const revealAll = this.phase === "ended" || world.players[seat.slot]?.defeated;
      const entities = revealAll ? world.entities.values() : entitiesVisibleTo(world, seat.slot);
      const bytes = seat.encoder.encode(world.tick, toViews(entities));
      this.stats.snapshotBytes += bytes.byteLength;
      seat.client.sendBytes(Msg.Snapshot, bytes);
    }
  }

  private sendYou(): void {
    const world = this.world!;
    for (const seat of this.seats.values()) {
      const player = world.players[seat.slot];
      if (!seat.client || !player) continue;
      const queues: YouMsg["queues"] = {};
      const rallies: YouMsg["rallies"] = {};
      for (const e of world.entities.values()) {
        if (e.owner !== seat.slot) continue;
        if (e.queue.length > 0) queues[e.id] = { items: [...e.queue], progress: e.queueProgress / queueItemTime(player, e.queue[0]!) };
        if (e.rally) rallies[e.id] = e.rally;
      }
      const { pop, cap } = population(world, seat.slot);
      const msg: YouMsg = { food: player.food, wood: player.wood, gold: player.gold, pop, cap, age: player.age, queues, rallies };
      seat.client.send(Msg.You, msg);
    }
  }

  private playersMsg(): PlayersMsg {
    const world = this.world!;
    const defeated = world.players.filter((p) => p?.defeated).map((p) => p.slot);
    const winners = world.winnerTeam === null ? null : world.players.filter((p) => p && !p.defeated && teamOf(world, p.slot) === world.winnerTeam).map((p) => p.slot);
    return { defeated, winners };
  }
}

/** Yields one reused view object per entity; the encoder copies only what it keeps. */
function* toViews(entities: Iterable<Entity>): Iterable<EntityView> {
  const view: EntityView = { id: 0, owner: 0, type: 0, x: 0, y: 0, hp: 0, flags: 0 };
  for (const e of entities) {
    let flags = 0;
    if (!e.done) flags |= EF.UnderConstruction;
    if (e.carryAmt > 0) flags |= EF.Carrying;
    if (e.attackFlash > 0) flags |= EF.Attacking;
    if (UNITS[e.type] && e.order.k === "idle") flags |= EF.Idle;
    // Resource nodes and farms report what's left instead of hit points.
    const hp = e.owner === GAIA || (e.type === T.Farm && e.done) ? e.amount : e.hp;
    view.id = e.id;
    view.owner = e.owner;
    view.type = e.type;
    view.x = e.x;
    view.y = e.y;
    view.hp = hp;
    view.flags = flags;
    yield view;
  }
}

/** Room options come from whoever creates the room, so clamp them to sane values. */
export function cleanOptions(raw: unknown): MatchOptions {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const int = (v: unknown, max: number) => (typeof v === "number" && Number.isInteger(v) ? Math.max(0, Math.min(max, v)) : undefined);
  return {
    bots: int(o.bots, MAX_PLAYERS - 1),
    autoStart: o.autoStart === true,
    seed: int(o.seed, 2 ** 31 - 1),
    // A full population per player: the most a real match can reach.
    extraUnits: int(o.extraUnits, MAX_POP),
  };
}

function publicSeat({ slot, name, team, civ, bot, connected }: Seat): SeatInfo {
  return { slot, name, team, civ, bot, connected };
}

function cleanName(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const name = raw.replace(/[^\p{L}\p{N} _.'-]/gu, "").trim().slice(0, 20);
  return name || fallback;
}
