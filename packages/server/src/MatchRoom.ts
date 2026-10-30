import { performance } from "node:perf_hooks";
import { Room, type Client } from "@colyseus/core";
import { schema, t, type SchemaType } from "@colyseus/schema";
import { Msg, SnapshotEncoder, type SyncMode } from "@koe/protocol";
import { applyCommand, createWorld, spawnPlayerStart, step, TICK_RATE, type World } from "@koe/sim";
import { StatsCollector } from "./stats";

/** Snapshots go out every Nth sim tick: 20 Hz sim / 2 = 10 Hz network. */
const SEND_EVERY_TICKS = 2;

export interface MatchOptions {
  mode?: SyncMode;
  players?: number;
  unitsPerPlayer?: number;
  seed?: number;
}

// Only used in "schema" mode, to compare Colyseus' built-in sync against our binary snapshots.
const UnitState = schema({ owner: t.uint8(), x: t.int16(), y: t.int16() }, "UnitState");
const MatchState = schema({ units: t.map(UnitState) }, "MatchState");
type MatchState = SchemaType<typeof MatchState>;

interface PlayerData {
  player: number;
  encoder: SnapshotEncoder;
}

export class MatchRoom extends Room<{ state: MatchState; client: Client<{ userData: PlayerData }> }> {
  private world!: World;
  private mode: SyncMode = "binary";
  private unitsPerPlayer = 75;
  private pending: Array<{ player: number; payload: unknown }> = [];
  private stats = new StatsCollector();
  private loop?: NodeJS.Timeout;

  override onCreate(options: MatchOptions): void {
    this.mode = options.mode ?? "binary";
    this.maxClients = options.players ?? 8;
    this.unitsPerPlayer = options.unitsPerPlayer ?? 75;
    this.world = createWorld({ seed: options.seed ?? 1, widthTiles: 128, heightTiles: 128 });

    if (this.mode === "schema") {
      this.setState(new MatchState());
      this.patchRate = (1000 / TICK_RATE) * SEND_EVERY_TICKS;
    } else {
      this.patchRate = null;
    }

    this.onMessage(Msg.Command, (client, payload: unknown) => {
      this.pending.push({ player: client.userData!.player, payload });
    });
    this.onMessage(Msg.Stats, (client) => {
      client.send(Msg.Stats, this.stats.report(this.world.units.size));
    });
    this.onMessage(Msg.StatsReset, () => this.stats.reset());

    this.startLoop();
  }

  override onDispose(): void {
    clearInterval(this.loop);
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

  override onJoin(client: Client<{ userData: PlayerData }>): void {
    const player = this.clients.length - 1;
    client.userData = { player, encoder: new SnapshotEncoder() };
    spawnPlayerStart(this.world, player, this.unitsPerPlayer);
    client.send(Msg.Welcome, { player });
  }

  private tick(): void {
    const start = performance.now();
    for (const { player, payload } of this.pending) {
      if (applyCommand(this.world, player, payload).ok) this.stats.commandsAccepted++;
      else this.stats.commandsRejected++;
    }
    this.pending.length = 0;
    step(this.world);
    if (this.mode === "schema") this.syncSchema();
    this.stats.recordTick(performance.now() - start);

    if (this.mode === "binary" && this.world.tick % SEND_EVERY_TICKS === 0) {
      const netStart = performance.now();
      this.sendSnapshots();
      this.stats.recordNet(performance.now() - netStart);
    }
  }

  private sendSnapshots(): void {
    // No fog of war yet: every client sees every unit. This is the worst case
    // (one big battle on screen); fog filtering in M4 can only reduce it.
    const units = [...this.world.units.values()];
    for (const client of this.clients) {
      const bytes = client.userData!.encoder.encode(this.world.tick, units);
      this.stats.snapshotBytes += bytes.byteLength;
      client.sendBytes(Msg.Snapshot, bytes);
    }
  }

  private syncSchema(): void {
    for (const u of this.world.units.values()) {
      const key = String(u.id);
      let s = this.state.units.get(key);
      if (!s) {
        this.state.units.set(key, new UnitState({ owner: u.owner, x: u.x, y: u.y }));
        continue;
      }
      if (s.x !== u.x) s.x = u.x;
      if (s.y !== u.y) s.y = u.y;
    }
  }
}
