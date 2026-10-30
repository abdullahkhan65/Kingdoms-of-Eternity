import { Client, type Room } from "@colyseus/sdk";
import {
  Msg, SnapshotDecoder,
  type EntityView, type LobbyState, type PlayersMsg, type StartedMsg, type YouMsg,
} from "@koe/protocol";
import { UNITS, type Command } from "@koe/sim";

interface Snapshot {
  tick: number;
  entities: Map<number, EntityView>;
}

const MAX_BUFFERED = 20;
const TOKEN_KEY = "koe.reconnect";

export interface NetEvents {
  lobby?: (s: LobbyState) => void;
  started?: (s: StartedMsg) => void;
  you?: (s: YouMsg) => void;
  players?: (s: PlayersMsg) => void;
  dropped?: () => void;
  reconnected?: () => void;
  left?: (code: number) => void;
}

/**
 * A connection to one match room. Holds the latest lobby/private state, and
 * answers "what does the world look like now?" by interpolating between the
 * two snapshots around a render time slightly in the past. The client never
 * simulates; it only displays what the server already decided.
 */
export class Net {
  lobby: LobbyState | null = null;
  started: StartedMsg | null = null;
  you: YouMsg | null = null;
  players: PlayersMsg = { defeated: [], winners: null };
  rttMs = 0;
  events: NetEvents = {};
  private decoder = new SnapshotDecoder();
  private snapshots: Snapshot[] = [];
  private tickOffset: number | null = null;
  private pingTimer?: ReturnType<typeof setInterval>;

  private constructor(readonly room: Room) {
    room.onMessage(Msg.Lobby, (s: LobbyState) => {
      this.lobby = s;
      this.events.lobby?.(s);
    });
    room.onMessage(Msg.Started, (s: StartedMsg) => {
      this.started = { ...s, terrain: new Uint8Array(s.terrain) };
      this.snapshots = [];
      this.tickOffset = null;
      this.events.started?.(this.started);
    });
    room.onMessage(Msg.Snapshot, (bytes: Uint8Array) => this.onSnapshot(bytes));
    room.onMessage(Msg.You, (s: YouMsg) => {
      this.you = s;
      this.events.you?.(s);
    });
    room.onMessage(Msg.Players, (s: PlayersMsg) => {
      this.players = s;
      this.events.players?.(s);
    });
    room.onMessage(Msg.Pong, (sentAt: number) => {
      const sample = performance.now() - sentAt;
      this.rttMs = this.rttMs === 0 ? sample : this.rttMs * 0.8 + sample * 0.2;
    });
    room.onDrop(() => this.events.dropped?.());
    room.onReconnect(() => this.events.reconnected?.());
    room.onLeave((code) => {
      clearInterval(this.pingTimer);
      sessionStorage.removeItem(TOKEN_KEY);
      this.events.left?.(code);
    });
    sessionStorage.setItem(TOKEN_KEY, room.reconnectionToken);
    this.pingTimer = setInterval(() => room.send(Msg.Ping, performance.now()), 2000);
  }

  static async create(endpoint: string, name: string, options: Record<string, unknown> = {}): Promise<Net> {
    return new Net(await new Client(endpoint).create("match", { ...options, name }));
  }

  static async join(endpoint: string, roomId: string, name: string): Promise<Net> {
    return new Net(await new Client(endpoint).joinById(roomId, { name }));
  }

  /** Rejoins the match this tab was in before a refresh, if the server still holds the seat. */
  static async resume(endpoint: string): Promise<Net | null> {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    try {
      return new Net(await new Client(endpoint).reconnect(token));
    } catch {
      sessionStorage.removeItem(TOKEN_KEY);
      return null;
    }
  }

  get roomId(): string {
    return this.room.roomId;
  }

  send(command: Command): void {
    this.room.send(Msg.Command, command);
  }

  sendLobby(type: string, payload?: unknown): void {
    this.room.send(type, payload);
  }

  leave(): void {
    sessionStorage.removeItem(TOKEN_KEY);
    void this.room.leave();
  }

  /** The newest snapshot's entities, without interpolation. */
  latest(): Map<number, EntityView> | null {
    return this.snapshots[this.snapshots.length - 1]?.entities ?? null;
  }

  /** Entities at `nowMs`, unit positions interpolated; null before the first snapshots arrive. */
  sample(nowMs: number): Map<number, EntityView> | null {
    if (this.tickOffset === null || this.snapshots.length === 0 || !this.started) return null;
    // Render 1.5 snapshot intervals in the past, so there's (almost) always a newer snapshot to move towards.
    const delayTicks = this.started.sendEveryTicks * 1.5;
    const renderTick = nowMs * this.ticksPerMs() + this.tickOffset - delayTicks;

    let a = this.snapshots[0]!;
    let b = a;
    for (const s of this.snapshots) {
      if (s.tick <= renderTick) a = s;
      b = s;
      if (s.tick >= renderTick) break;
    }
    if (a === b) return b.entities;

    const t = (renderTick - a.tick) / (b.tick - a.tick);
    const out = new Map<number, EntityView>();
    for (const [id, to] of b.entities) {
      const from = a.entities.get(id);
      out.set(id, from && UNITS[to.type] ? { ...to, x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t } : to);
    }
    return out;
  }

  private ticksPerMs(): number {
    return (this.started?.tickRate ?? 20) / 1000;
  }

  private onSnapshot(bytes: Uint8Array): void {
    this.decoder.apply(bytes);
    const entities = new Map<number, EntityView>();
    for (const e of this.decoder.entities.values()) entities.set(e.id, { ...e });
    this.snapshots.push({ tick: this.decoder.tick, entities });
    if (this.snapshots.length > MAX_BUFFERED) this.snapshots.shift();

    // Follow the server clock: drift slowly so jitter doesn't make units stutter,
    // but jump when far off (first snapshot, tab was in the background).
    const target = this.decoder.tick - performance.now() * this.ticksPerMs();
    const every = this.started?.sendEveryTicks ?? 2;
    if (this.tickOffset === null || Math.abs(target - this.tickOffset) > every * 4) this.tickOffset = target;
    else this.tickOffset += (target - this.tickOffset) * 0.05;
  }
}
