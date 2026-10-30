export * from "./snapshot";

/** Colyseus message types shared by server and clients. */
export const Msg = {
  // client -> server
  /** A sim Command (validated by the server). */
  Command: "cmd",
  /** Lobby: change my name / team / civ. */
  SetSeat: "seat",
  /** Lobby, host only: add or remove a computer player, start the match. */
  AddBot: "addBot",
  RemoveBot: "removeBot",
  Start: "start",
  /** A timestamp; echoed back as Pong to measure round trip. */
  Ping: "ping",
  /** Bench harness: request / reset server metrics. */
  Stats: "stats",
  StatsReset: "stats-reset",

  // server -> client
  /** Full lobby state, sent whenever it changes. */
  Lobby: "lobby",
  /** Match started (or rejoined): map and players. */
  Started: "started",
  /** Binary snapshot bytes. */
  Snapshot: "snap",
  /** Private per-player state: resources, population, queues. */
  You: "you",
  /** Someone was defeated, or the match ended. */
  Players: "players",
  Pong: "pong",
} as const;

export interface SeatInfo {
  slot: number;
  name: string;
  /** 0 = no team. */
  team: number;
  civ: number;
  bot: boolean;
  connected: boolean;
}

export interface LobbyState {
  /** The receiving client's own seat. */
  you: number;
  roomId: string;
  host: number;
  seats: SeatInfo[];
}

export interface StartedMsg {
  you: number;
  cols: number;
  rows: number;
  /** One byte per tile (0 grass, 1 water). */
  terrain: Uint8Array;
  seats: SeatInfo[];
  tickRate: number;
  sendEveryTicks: number;
}

export interface QueueView {
  items: number[];
  /** 0..1 progress of the first item. */
  progress: number;
}

export interface YouMsg {
  food: number;
  wood: number;
  gold: number;
  pop: number;
  cap: number;
  age: number;
  /** Production queues of the player's buildings, by building id. */
  queues: Record<number, QueueView>;
  /** Rally points by building id. */
  rallies: Record<number, { x: number; y: number }>;
}

export interface PlayersMsg {
  defeated: number[];
  /** Set when the match is over: the winning slots (empty = nobody). */
  winners: number[] | null;
}
