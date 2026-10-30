// Per-client delta snapshots of unit positions.
//
// Wire format (little-endian):
//   u8  version
//   u32 tick
//   u16 nSet     then nSet    x { u16 id, u8 owner, i16 x, i16 y }   absolute (new or big jump)
//   u16 nMove    then nMove   x { u16 id, i8 dx, i8 dy }             relative to last sent
//   u16 nRemove  then nRemove x { u16 id }                           no longer visible / dead
//
// Each client has its own encoder because what it last received (and what it
// can see under fog of war) differs per client.

export const SNAPSHOT_VERSION = 1;
export const MAX_UNIT_ID = 0xffff;

const HEADER_BYTES = 1 + 4;
const SET_BYTES = 2 + 1 + 2 + 2;
const MOVE_BYTES = 2 + 1 + 1;
const REMOVE_BYTES = 2;

export interface UnitView {
  id: number;
  owner: number;
  x: number;
  y: number;
}

export class SnapshotEncoder {
  private sent = new Map<number, { x: number; y: number }>();

  encode(tick: number, units: Iterable<UnitView>): Uint8Array {
    const sets: UnitView[] = [];
    const moves: Array<[id: number, dx: number, dy: number]> = [];
    const seen = new Set<number>();

    for (const u of units) {
      if (u.id > MAX_UNIT_ID) throw new Error(`unit id ${u.id} exceeds u16`);
      seen.add(u.id);
      const prev = this.sent.get(u.id);
      if (!prev) {
        sets.push(u);
        this.sent.set(u.id, { x: u.x, y: u.y });
        continue;
      }
      const dx = u.x - prev.x;
      const dy = u.y - prev.y;
      if (dx === 0 && dy === 0) continue;
      if (dx >= -128 && dx <= 127 && dy >= -128 && dy <= 127) moves.push([u.id, dx, dy]);
      else sets.push(u);
      prev.x = u.x;
      prev.y = u.y;
    }

    const removes: number[] = [];
    for (const id of this.sent.keys()) {
      if (!seen.has(id)) removes.push(id);
    }
    for (const id of removes) this.sent.delete(id);

    const size =
      HEADER_BYTES + 6 + sets.length * SET_BYTES + moves.length * MOVE_BYTES + removes.length * REMOVE_BYTES;
    const buf = new Uint8Array(size);
    const view = new DataView(buf.buffer);
    let o = 0;
    view.setUint8(o, SNAPSHOT_VERSION); o += 1;
    view.setUint32(o, tick, true); o += 4;

    view.setUint16(o, sets.length, true); o += 2;
    for (const u of sets) {
      view.setUint16(o, u.id, true);
      view.setUint8(o + 2, u.owner);
      view.setInt16(o + 3, u.x, true);
      view.setInt16(o + 5, u.y, true);
      o += SET_BYTES;
    }

    view.setUint16(o, moves.length, true); o += 2;
    for (const [id, dx, dy] of moves) {
      view.setUint16(o, id, true);
      view.setInt8(o + 2, dx);
      view.setInt8(o + 3, dy);
      o += MOVE_BYTES;
    }

    view.setUint16(o, removes.length, true); o += 2;
    for (const id of removes) {
      view.setUint16(o, id, true);
      o += REMOVE_BYTES;
    }
    return buf;
  }
}

export class SnapshotDecoder {
  readonly units = new Map<number, UnitView>();
  tick = -1;

  apply(bytes: Uint8Array): void {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let o = 0;
    const version = view.getUint8(o); o += 1;
    if (version !== SNAPSHOT_VERSION) throw new Error(`unsupported snapshot version ${version}`);
    this.tick = view.getUint32(o, true); o += 4;

    const nSet = view.getUint16(o, true); o += 2;
    for (let i = 0; i < nSet; i++) {
      const id = view.getUint16(o, true);
      this.units.set(id, {
        id,
        owner: view.getUint8(o + 2),
        x: view.getInt16(o + 3, true),
        y: view.getInt16(o + 5, true),
      });
      o += SET_BYTES;
    }

    const nMove = view.getUint16(o, true); o += 2;
    for (let i = 0; i < nMove; i++) {
      const unit = this.units.get(view.getUint16(o, true));
      if (!unit) throw new Error("move for unknown unit");
      unit.x += view.getInt8(o + 2);
      unit.y += view.getInt8(o + 3);
      o += MOVE_BYTES;
    }

    const nRemove = view.getUint16(o, true); o += 2;
    for (let i = 0; i < nRemove; i++) {
      this.units.delete(view.getUint16(o, true));
      o += REMOVE_BYTES;
    }
  }
}
