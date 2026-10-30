// Load test: can one server process run an 8-player match at our budget?
// Each player gets its starting town plus extra Spearmen (--units total per player),
// and every bot keeps its units marching, so armies meet and fight across the map.
//
//   npm run spike
//   npm run spike -- --seconds 120 --units 75
//   npm run spike -- --endpoint ws://1.2.3.4:2567  # against a remote server
//   npm run spike -- --write                       # append results to docs/perf-baseline.md
//
// With --endpoint, server CPU/tick numbers come from the remote host.

import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync } from "node:fs";
import os from "node:os";
import { parseArgs } from "node:util";
import { Bot } from "./bot";

// Mirrors packages/server/src/stats.ts RoomStats (only the fields we print).
interface RoomStats {
  seconds: number;
  ticks: number;
  tickMs: { p50: number; p99: number; max: number };
  netMs: { p50: number; p99: number; max: number };
  cpuPercent: number;
  rssMB: number;
  commandsAccepted: number;
  commandsRejected: number;
  units: number;
  snapshotBytesPerSec: number;
}

const BUDGET = { tickP99Ms: 25, kbPerSecPerClient: 30 };

const { values: args } = parseArgs({
  options: {
    players: { type: "string", default: "8" },
    units: { type: "string", default: "75" },
    seconds: { type: "string", default: "60" },
    warmup: { type: "string", default: "10" },
    endpoint: { type: "string" },
    write: { type: "boolean", default: false },
  },
});

const players = Number(args.players);
const unitsPerPlayer = Number(args.units);
const seconds = Number(args.seconds);
const warmup = Number(args.warmup);
const START_VILLAGERS = 3;

const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

async function startLocalServer(port: number): Promise<ChildProcess> {
  // Run node directly (not via npx) so kill() reaches the server itself; an
  // orphaned grandchild kept SSH sessions open after the spike finished.
  const child = spawn(process.execPath, ["--import", "tsx", "packages/server/src/main.ts"], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    child.on("exit", (code) => reject(new Error(`server exited with ${code}`)));
    child.stdout!.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("listening on")) resolve();
    });
  });
  return child;
}

async function run() {
  const port = 2600 + Math.floor(Math.random() * 1000);
  const server = args.endpoint ? undefined : await startLocalServer(port);
  const endpoint = args.endpoint ?? `ws://localhost:${port}`;

  try {
    const host = new Bot({ endpoint, createOptions: { seed: 1, extraUnits: Math.max(0, unitsPerPlayer - START_VILLAGERS) } });
    await host.connect();
    const bots = [host];
    for (let i = 1; i < players; i++) {
      const bot = new Bot({ endpoint, roomId: host.room.roomId });
      await bot.connect();
      bots.push(bot);
    }
    host.start();
    await Promise.all(bots.map((b) => b.waitForStart()));
    console.log(`${players} bots in a match, warming up ${warmup}s…`);
    await sleep(warmup);

    host.room.send("stats-reset");
    for (const b of bots) b.bytesReceived = 0;
    console.log(`measuring ${seconds}s…`);
    await sleep(seconds);

    const stats = await host.requestStats<RoomStats>();
    const kbps = bots.map((b) => b.bytesReceived / 1024 / stats.seconds);
    await Promise.all(bots.map((b) => b.leave()));
    return { mode: "binary", stats, kbpsAvg: kbps.reduce((a, b) => a + b, 0) / kbps.length, kbpsMax: Math.max(...kbps) };
  } finally {
    server?.kill();
  }
}

const results = [await run()];

const f = (n: number, d = 2) => n.toFixed(d);
const pass = (ok: boolean) => (ok ? "PASS" : "FAIL");
const hostDesc = args.endpoint
  ? `remote ${args.endpoint}`
  : `${os.cpus()[0]?.model ?? "unknown CPU"}, ${os.cpus().length} cores, Node ${process.version}`;

const lines = [
  "",
  `### ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC: full game, ${players} players × ${unitsPerPlayer} units + towns + map, ${seconds}s`,
  "",
  `Host: ${hostDesc}`,
  "",
  "| Mode | Entities | Sim Hz | Tick p50 / p99 / max (ms) | Snapshot build p99 (ms) | Server CPU | RSS | Per-client KB/s avg / max | Cmds ok / rejected | Tick budget | Bandwidth budget |",
  "|---|---:|---:|---|---:|---:|---:|---|---|---|---|",
  ...results.map(({ mode, stats: s, kbpsAvg, kbpsMax }) =>
    `| ${mode} | ${s.units} | ${f(s.ticks / s.seconds, 1)} | ${f(s.tickMs.p50)} / ${f(s.tickMs.p99)} / ${f(s.tickMs.max)} | ${f(s.netMs.p99)} | ${f(s.cpuPercent, 1)}% | ${f(s.rssMB, 0)} MB | ${f(kbpsAvg, 1)} / ${f(kbpsMax, 1)} | ${s.commandsAccepted} / ${s.commandsRejected} | ${pass(s.tickMs.p99 + s.netMs.p99 < BUDGET.tickP99Ms && s.ticks / s.seconds > 19)} | ${pass(kbpsMax < BUDGET.kbPerSecPerClient)} |`,
  ),
  "",
];
console.log(lines.join("\n"));
if (args.write) appendFileSync("docs/perf-baseline.md", lines.join("\n"));
process.exit(0);
