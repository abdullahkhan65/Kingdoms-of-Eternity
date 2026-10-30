export * from "./snapshot";

/** Colyseus message types shared by server and clients. */
export const Msg = {
  /** client -> server: a sim Command. */
  Command: "cmd",
  /** server -> client: Welcome payload after join. */
  Welcome: "welcome",
  /** server -> client: binary snapshot bytes. */
  Snapshot: "snap",
  /** client -> server: request server metrics; server replies with Stats. */
  Stats: "stats",
  /** client -> server: clear collected metrics (end of warm-up). */
  StatsReset: "stats-reset",
  /** client -> server: a timestamp; server echoes it back as Pong to measure round trip. */
  Ping: "ping",
  Pong: "pong",
} as const;

export interface Welcome {
  player: number;
  /** Map size in world units. */
  mapWidth: number;
  mapHeight: number;
  /** Sim ticks per second and how many ticks pass between snapshots. */
  tickRate: number;
  sendEveryTicks: number;
}

export type SyncMode = "binary" | "schema";
