import { Client, type Room } from "@colyseus/sdk";
import { Msg, SnapshotDecoder, type Welcome } from "@koe/protocol";
import type { Command } from "@koe/sim";

export interface UnitPos {
  owner: number;
  x: number;
  y: number;
}

interface Snapshot {
  tick: number;
  units: Map<number, UnitPos>;
}

const MAX_BUFFERED = 20;

/**
 * Connection to a match. Receives snapshots and answers "where is every unit
 * right now?" by interpolating between the two snapshots around a render time
 * slightly in the past. The client never simulates; it only displays what the
 * server already decided.
 */
export class MatchConnection {
  welcome!: Welcome;
  rttMs = 0;
  private room!: Room;
  private decoder = new SnapshotDecoder();
  private snapshots: Snapshot[] = [];
  /** serverTick ≈ localMs * ticksPerMs + tickOffset, smoothed against jitter. */
  private tickOffset: number | null = null;

  constructor(private readonly endpoint: string) {}

  async connect(): Promise<void> {
    const client = new Client(this.endpoint);
    this.room = await client.joinOrCreate("match");
    this.room.onMessage(Msg.Snapshot, (bytes: Uint8Array) => this.onSnapshot(bytes));
    this.room.onMessage(Msg.Pong, (sentAt: number) => {
      const sample = performance.now() - sentAt;
      this.rttMs = this.rttMs === 0 ? sample : this.rttMs * 0.8 + sample * 0.2;
    });
    this.welcome = await new Promise<Welcome>((resolve) => this.room.onMessage(Msg.Welcome, resolve));
    setInterval(() => this.room.send(Msg.Ping, performance.now()), 2000);
  }

  send(command: Command): void {
    this.room.send(Msg.Command, command);
  }

  onLeave(cb: (code: number) => void): void {
    this.room.onLeave(cb);
  }

  /** Interpolated unit positions at `nowMs`, or null before the first snapshots arrive. */
  sample(nowMs: number): Map<number, UnitPos> | null {
    if (this.tickOffset === null || this.snapshots.length === 0) return null;
    // Render one and a half snapshot intervals in the past, so there is
    // (almost) always a newer snapshot to interpolate towards.
    const delayTicks = this.welcome.sendEveryTicks * 1.5;
    const renderTick = nowMs * this.ticksPerMs() + this.tickOffset - delayTicks;

    let a = this.snapshots[0]!;
    let b = a;
    for (const s of this.snapshots) {
      if (s.tick <= renderTick) a = s;
      if (s.tick >= renderTick) {
        b = s;
        break;
      }
      b = s; // renderTick is past the newest snapshot: hold the latest
    }
    if (a === b) return b.units;

    const t = (renderTick - a.tick) / (b.tick - a.tick);
    const out = new Map<number, UnitPos>();
    for (const [id, to] of b.units) {
      const from = a.units.get(id);
      out.set(id, from ? { owner: to.owner, x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t } : to);
    }
    return out;
  }

  private ticksPerMs(): number {
    return this.welcome.tickRate / 1000;
  }

  private onSnapshot(bytes: Uint8Array): void {
    this.decoder.apply(bytes);
    const units = new Map<number, UnitPos>();
    for (const u of this.decoder.units.values()) units.set(u.id, { owner: u.owner, x: u.x, y: u.y });
    this.snapshots.push({ tick: this.decoder.tick, units });
    if (this.snapshots.length > MAX_BUFFERED) this.snapshots.shift();

    // Follow the server clock: drift slowly so jitter doesn't make units stutter,
    // but jump if we're far off (first snapshot, tab was in the background).
    const target = this.decoder.tick - performance.now() * this.ticksPerMs();
    if (this.tickOffset === null || Math.abs(target - this.tickOffset) > this.welcome.sendEveryTicks * 4) {
      this.tickOffset = target;
    } else {
      this.tickOffset += (target - this.tickOffset) * 0.05;
    }
  }
}
