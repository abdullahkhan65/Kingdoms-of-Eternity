import { performance } from "node:perf_hooks";

export interface Percentiles {
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface RoomStats {
  seconds: number;
  ticks: number;
  /** Sim step time per tick, ms. */
  tickMs: Percentiles;
  /** Time to build and send snapshots on a send tick, ms (binary mode only). */
  netMs: Percentiles;
  /** Process CPU use over the window; 100 = one full core. */
  cpuPercent: number;
  rssMB: number;
  commandsAccepted: number;
  commandsRejected: number;
  units: number;
  /** Snapshot payload bytes sent to all clients, per second (binary mode only). */
  snapshotBytesPerSec: number;
}

export class StatsCollector {
  private tickMs: number[] = [];
  private netMs: number[] = [];
  private cpuStart = process.cpuUsage();
  private wallStart = performance.now();
  commandsAccepted = 0;
  commandsRejected = 0;
  snapshotBytes = 0;

  reset(): void {
    this.tickMs = [];
    this.netMs = [];
    this.cpuStart = process.cpuUsage();
    this.wallStart = performance.now();
    this.commandsAccepted = 0;
    this.commandsRejected = 0;
    this.snapshotBytes = 0;
  }

  recordTick(ms: number): void {
    this.tickMs.push(ms);
  }

  recordNet(ms: number): void {
    this.netMs.push(ms);
  }

  report(units: number): RoomStats {
    const wallMs = performance.now() - this.wallStart;
    const cpu = process.cpuUsage(this.cpuStart);
    return {
      seconds: wallMs / 1000,
      ticks: this.tickMs.length,
      tickMs: percentiles(this.tickMs),
      netMs: percentiles(this.netMs),
      cpuPercent: ((cpu.user + cpu.system) / 1000 / wallMs) * 100,
      rssMB: process.memoryUsage().rss / 1024 / 1024,
      commandsAccepted: this.commandsAccepted,
      commandsRejected: this.commandsRejected,
      units,
      snapshotBytesPerSec: this.snapshotBytes / (wallMs / 1000),
    };
  }
}

function percentiles(samples: number[]): Percentiles {
  if (samples.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted[sorted.length - 1]! };
}
