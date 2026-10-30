import { Client, type Room } from "@colyseus/sdk";
import { Msg, SnapshotDecoder, type StartedMsg } from "@koe/protocol";
import { UNITS } from "@koe/sim";

const ORDER_INTERVAL_MS = 500;
const GROUP_SIZE = 25;

export interface BotOptions {
  endpoint: string;
  /** Join this room; if absent, create a new match with `createOptions`. */
  roomId?: string;
  createOptions?: Record<string, unknown>;
}

/**
 * A headless network player for load tests. Talks to the server exactly like a
 * browser client and keeps its units busy: every 500 ms it orders a random
 * group of 25 to a random point, so nearly all of its units are always moving.
 */
export class Bot {
  room!: Room;
  player = -1;
  bytesReceived = 0;
  private decoder = new SnapshotDecoder();
  private mapSize = 0;
  private orderTimer?: NodeJS.Timeout;
  private started!: Promise<void>;

  constructor(private readonly opts: BotOptions) {}

  async connect(): Promise<void> {
    const client = new Client(this.opts.endpoint);
    this.room = this.opts.roomId ? await client.joinById(this.opts.roomId, { name: "bench" }) : await client.create("match", this.opts.createOptions);
    countBytes(this.room, (n) => (this.bytesReceived += n));
    for (const type of [Msg.Lobby, Msg.You, Msg.Players, Msg.Stats, Msg.Pong]) this.room.onMessage(type, () => {});
    this.room.onMessage(Msg.Snapshot, (bytes: Uint8Array) => this.decoder.apply(bytes));
    this.started = new Promise((resolve) => {
      this.room.onMessage(Msg.Started, (msg: StartedMsg) => {
        this.player = msg.you;
        this.mapSize = msg.cols * 64;
        resolve();
      });
    });
  }

  /** Host only: start the match. Resolves once this bot has the start message. */
  start(): void {
    this.room.send(Msg.Start);
  }

  async waitForStart(): Promise<void> {
    await this.started;
    this.orderTimer = setInterval(() => this.giveOrder(), ORDER_INTERVAL_MS);
  }

  requestStats<T>(): Promise<T> {
    return new Promise((resolve) => {
      const off = this.room.onMessage(Msg.Stats, (stats: T) => {
        off();
        resolve(stats);
      });
      this.room.send(Msg.Stats);
    });
  }

  async leave(): Promise<void> {
    clearInterval(this.orderTimer);
    await this.room.leave();
  }

  private giveOrder(): void {
    const owned = [...this.decoder.entities.values()].filter((e) => e.owner === this.player && UNITS[e.type]).map((e) => e.id);
    if (owned.length === 0) return;
    const start = Math.floor(Math.random() * owned.length);
    const ids = Array.from({ length: Math.min(GROUP_SIZE, owned.length) }, (_, i) => owned[(start + i) % owned.length]!);
    this.room.send(Msg.Command, { type: "move", ids, x: Math.floor(Math.random() * this.mapSize), y: Math.floor(Math.random() * this.mapSize) });
  }
}

/** Counts every WebSocket payload byte the room receives (excludes WS/TCP framing). */
function countBytes(room: Room, add: (n: number) => void): void {
  const transport = room.connection.transport as { ws?: { addEventListener(type: "message", cb: (ev: { data: unknown }) => void): void } };
  transport.ws?.addEventListener("message", (ev) => {
    const data = ev.data as ArrayBuffer | Uint8Array | string;
    add(typeof data === "string" ? Buffer.byteLength(data) : data.byteLength);
  });
}
