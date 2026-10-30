export * from "./snapshot";

/** Colyseus message types shared by server and clients. */
export const Msg = {
  /** client -> server: a sim Command. */
  Command: "cmd",
  /** server -> client: { player } after join. */
  Welcome: "welcome",
  /** server -> client: binary snapshot bytes. */
  Snapshot: "snap",
  /** client -> server: request server metrics; server replies with Stats. */
  Stats: "stats",
  /** client -> server: clear collected metrics (end of warm-up). */
  StatsReset: "stats-reset",
} as const;

export type SyncMode = "binary" | "schema";
