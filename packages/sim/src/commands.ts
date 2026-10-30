import { TILE, clampX, clampY, type World } from "./world";

export const MAX_UNITS_PER_COMMAND = 200;
const FORMATION_SPACING = TILE * 0.6;

export type Command = { type: "move"; ids: number[]; x: number; y: number };

export type CommandResult = { ok: true } | { ok: false; reason: string };

/**
 * Validates an untrusted payload from the network and applies it for `player`.
 * Anything malformed, out of range or not owned by `player` is rejected; the
 * world is only mutated when the result is ok.
 */
export function applyCommand(world: World, player: number, raw: unknown): CommandResult {
  if (typeof raw !== "object" || raw === null) return reject("not an object");
  const cmd = raw as Record<string, unknown>;

  switch (cmd.type) {
    case "move":
      return applyMove(world, player, cmd);
    default:
      return reject("unknown command type");
  }
}

function applyMove(world: World, player: number, cmd: Record<string, unknown>): CommandResult {
  const { ids, x, y } = cmd;
  if (!Array.isArray(ids) || ids.length === 0) return reject("ids must be a non-empty array");
  if (ids.length > MAX_UNITS_PER_COMMAND) return reject("too many units");
  if (!Number.isInteger(x) || !Number.isInteger(y)) return reject("target must be integers");

  const owned = [];
  for (const id of ids) {
    const unit = Number.isInteger(id) ? world.units.get(id as number) : undefined;
    if (!unit) return reject("unknown unit");
    if (unit.owner !== player) return reject("unit not owned by player");
    owned.push(unit);
  }

  // Square formation centered on the target so a group doesn't pile onto one point.
  const cols = Math.ceil(Math.sqrt(owned.length));
  const half = ((cols - 1) * FORMATION_SPACING) / 2;
  owned.forEach((unit, i) => {
    unit.tx = clampX(world, Math.trunc((x as number) - half + (i % cols) * FORMATION_SPACING));
    unit.ty = clampY(world, Math.trunc((y as number) - half + Math.floor(i / cols) * FORMATION_SPACING));
    unit.moving = true;
  });
  return { ok: true };
}

function reject(reason: string): CommandResult {
  return { ok: false, reason };
}
