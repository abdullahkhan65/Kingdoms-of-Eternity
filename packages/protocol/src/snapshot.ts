// Per-client delta snapshots of everything the client is allowed to see.
//
// Wire format (little-endian):
//   u8  version
//   u8  flags      bit 0: keyframe (client clears its state first)
//   u32 tick
//   u16 nSet     then nSet    x { u16 id, u8 owner, u8 type, i16 x, i16 y, u16 hp, u8 flags }   new or changed
//   u16 nMove    then nMove   x { u16 id, i8 dx, i8 dy }                                         position-only change
//   u16 nRemove  then nRemove x { u16 id }                                                       gone or out of sight
//
// Each client has its own encoder because what it last received (and what it
// can see under fog of war) differs per client.

export const SNAPSHOT_VERSION = 2;
export const MAX_ENTITY_ID = 0xffff;

/** EntityView.flags bits. */
export const EF = {
  UnderConstruction: 1,
  Carrying: 2,
  Attacking: 4,
  /** Unit has no order (for the idle-villager button). */
  Idle: 8,
} as const;

const HEADER_BYTES = 1 + 1 + 4;
const SET_BYTES = 2 + 1 + 1 + 2 + 2 + 2 + 1;
const MOVE_BYTES = 2 + 1 + 1;
const REMOVE_BYTES = 2;

export interface EntityView {
  id: number;
  owner: number;
  type: number;
  x: number;
  y: number;
  hp: number;
  flags: number;
}

export class SnapshotEncoder {
  private sent = new Map<number, EntityView>();
  private first = true;

  encode(tick: number, entities: Iterable<EntityView>): Uint8Array {
    const sets: EntityView[] = [];
    const moves: Array<[id: number, dx: number, dy: number]> = [];
    const seen = new Set<number>();

    for (const e of entities) {
      if (e.id > MAX_ENTITY_ID) throw new Error(`entity id ${e.id} exceeds u16`);
      seen.add(e.id);
      const prev = this.sent.get(e.id);
      const hp = Math.max(0, Math.min(0xffff, e.hp));
      const dx = prev ? e.x - prev.x : 0;
      const dy = prev ? e.y - prev.y : 0;
      const sameRest = !!prev && e.owner === prev.owner && e.type === prev.type && hp === prev.hp && e.flags === prev.flags;
      // Most entities (trees, idle units) don't change between snapshots: skip them without allocating.
      if (sameRest && dx === 0 && dy === 0) continue;
      if (prev && sameRest && dx >= -128 && dx <= 127 && dy >= -128 && dy <= 127) {
        moves.push([e.id, dx, dy]);
        prev.x = e.x;
        prev.y = e.y;
        continue;
      }
      const copy = { id: e.id, owner: e.owner, type: e.type, x: e.x, y: e.y, hp, flags: e.flags };
      sets.push(copy);
      this.sent.set(e.id, copy);
    }

    const removes: number[] = [];
    for (const id of this.sent.keys()) if (!seen.has(id)) removes.push(id);
    for (const id of removes) this.sent.delete(id);

    const buf = new Uint8Array(HEADER_BYTES + 6 + sets.length * SET_BYTES + moves.length * MOVE_BYTES + removes.length * REMOVE_BYTES);
    const view = new DataView(buf.buffer);
    let o = 0;
    view.setUint8(o, SNAPSHOT_VERSION); o += 1;
    view.setUint8(o, this.first ? 1 : 0); o += 1;
    view.setUint32(o, tick, true); o += 4;
    this.first = false;

    view.setUint16(o, sets.length, true); o += 2;
    for (const e of sets) {
      view.setUint16(o, e.id, true);
      view.setUint8(o + 2, e.owner);
      view.setUint8(o + 3, e.type);
      view.setInt16(o + 4, e.x, true);
      view.setInt16(o + 6, e.y, true);
      view.setUint16(o + 8, e.hp, true);
      view.setUint8(o + 10, e.flags);
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
  readonly entities = new Map<number, EntityView>();
  tick = -1;

  apply(bytes: Uint8Array): void {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let o = 0;
    const version = view.getUint8(o); o += 1;
    if (version !== SNAPSHOT_VERSION) throw new Error(`unsupported snapshot version ${version}`);
    if (view.getUint8(o) & 1) this.entities.clear();
    o += 1;
    this.tick = view.getUint32(o, true); o += 4;

    const nSet = view.getUint16(o, true); o += 2;
    for (let i = 0; i < nSet; i++) {
      const id = view.getUint16(o, true);
      this.entities.set(id, {
        id,
        owner: view.getUint8(o + 2),
        type: view.getUint8(o + 3),
        x: view.getInt16(o + 4, true),
        y: view.getInt16(o + 6, true),
        hp: view.getUint16(o + 8, true),
        flags: view.getUint8(o + 10),
      });
      o += SET_BYTES;
    }

    const nMove = view.getUint16(o, true); o += 2;
    for (let i = 0; i < nMove; i++) {
      const e = this.entities.get(view.getUint16(o, true));
      if (!e) throw new Error("move for unknown entity");
      e.x += view.getInt8(o + 2);
      e.y += view.getInt8(o + 3);
      o += MOVE_BYTES;
    }

    const nRemove = view.getUint16(o, true); o += 2;
    for (let i = 0; i < nRemove; i++) {
      this.entities.delete(view.getUint16(o, true));
      o += REMOVE_BYTES;
    }
  }
}
