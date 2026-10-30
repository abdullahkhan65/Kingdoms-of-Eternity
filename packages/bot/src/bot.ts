import { Client, type Room } from "@colyseus/sdk";
import { Msg, SnapshotDecoder, type SyncMode } from "@koe/protocol";

const MAP_SIZE = 128 * 64;
const ORDER_INTERVAL_MS = 500;
const GROUP_SIZE = 25;

export interface BotOptions {
  endpoint: string;
  mode: SyncMode;
  /** Join this room; if absent, create a new match with `createOptions`. */
  roomId?: string;
  createOptions?: Record<string, unknown>;
}

/**
 * A headless player. Talks to the server exactly like a browser client and
 * keeps its units busy: every 500 ms it orders a random group of 25 to a
 * random point, so nearly all of its units are moving at any time (worst case
 * for bandwidth).
 */
export class Bot {
  room!: Room;
  player = -1;
  bytesReceived = 0;
  private decoder = new SnapshotDecoder();
  private orderTimer?: NodeJS.Timeout;

  constructor(private readonly opts: BotOptions) {}

  async connect(): Promise<void> {
    const client = new Client(this.opts.endpoint);
    this.room = this.opts.roomId
      ? await client.joinById(this.opts.roomId)
      : await client.create("match", this.opts.createOptions);

    countBytes(this.room, (n) => (this.bytesReceived += n));
    this.room.onMessage(Msg.Snapshot, (bytes: Uint8Array) => this.decoder.apply(bytes));
    this.room.onMessage(Msg.Stats, () => {}); // answered via requestStats()
    await new Promise<void>((resolve) => {
      this.room.onMessage(Msg.Welcome, ({ player }: { player: number }) => {
        this.player = player;
        resolve();
      });
    });
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

  private ownedUnitIds(): number[] {
    const ids: number[] = [];
    if (this.opts.mode === "schema") {
      this.room.state?.units?.forEach((u: { owner: number }, key: string) => {
        if (u.owner === this.player) ids.push(Number(key));
      });
    } else {
      for (const u of this.decoder.units.values()) if (u.owner === this.player) ids.push(u.id);
    }
    return ids;
  }

  private giveOrder(): void {
    const owned = this.ownedUnitIds();
    if (owned.length === 0) return;
    const start = Math.floor(Math.random() * owned.length);
    const ids = Array.from({ length: Math.min(GROUP_SIZE, owned.length) }, (_, i) => owned[(start + i) % owned.length]!);
    this.room.send(Msg.Command, {
      type: "move",
      ids,
      x: Math.floor(Math.random() * MAP_SIZE),
      y: Math.floor(Math.random() * MAP_SIZE),
    });
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
