// Game data: every number a designer would want to tune lives here.
// Times are in sim ticks (TICK_RATE per second); distances in world units (TILE per tile).

export const TICK_RATE = 20;
export const TILE = 64;
export const GAIA = 255;
export const MAX_POP = 75;
export const MAX_PLAYERS = 8;
export const MAX_QUEUE = 5;
export const CARRY_CAPACITY = 10;
/** Aurelian Concord civ bonus (tuned by bot-vs-bot matches: +3 won 6 of 7). */
export const AURELIAN_CARRY_BONUS = 2;

export const secs = (s: number) => Math.round(s * TICK_RATE);

export type Res = "food" | "wood" | "gold";
export const RESOURCES: readonly Res[] = ["food", "wood", "gold"];
export type Cost = Partial<Record<Res, number>>;

// Entity type ids share one u8 space on the wire.
export const T = {
  Villager: 1,
  Spearman: 2,
  Swordsman: 3,
  Archer: 4,
  Scout: 5,
  TownCenter: 20,
  House: 21,
  Storehouse: 22,
  Farm: 23,
  Barracks: 24,
  ArcheryRange: 25,
  Tree: 40,
  GoldMine: 41,
  Berries: 42,
} as const;
export type EntityType = (typeof T)[keyof typeof T];

/** Queue item id for the age-up research (shares the queue with unit types). */
export const TECH_AGE2 = 100;

export const AGE_NAMES = ["", "Age of Hearth", "Age of Banners"] as const;

export type UnitClass = "villager" | "infantry" | "archer" | "cavalry";

export interface UnitDef {
  name: string;
  cls: UnitClass;
  hp: number;
  attack: number;
  armor: number;
  /** Attack reach in world units, measured edge to edge. */
  range: number;
  cooldown: number;
  /** World units per tick. */
  speed: number;
  /** Vision radius in tiles. */
  sight: number;
  radius: number;
  cost: Cost;
  trainTime: number;
  age: 1 | 2;
  /** Extra damage against a unit class or buildings. */
  bonus?: Partial<Record<UnitClass | "building", number>>;
}

const MELEE = 10;

export const UNITS: Record<number, UnitDef> = {
  [T.Villager]: { name: "Villager", cls: "villager", hp: 25, attack: 3, armor: 0, range: MELEE, cooldown: secs(1.5), speed: 3, sight: 4, radius: 13, cost: { food: 50 }, trainTime: secs(12), age: 1 },
  [T.Spearman]: { name: "Spearman", cls: "infantry", hp: 45, attack: 4, armor: 0, range: MELEE, cooldown: secs(1.5), speed: 3, sight: 4, radius: 15, cost: { food: 35, wood: 25 }, trainTime: secs(14), age: 1, bonus: { cavalry: 12 } },
  [T.Swordsman]: { name: "Swordsman", cls: "infantry", hp: 60, attack: 9, armor: 1, range: MELEE, cooldown: secs(1.5), speed: 3, sight: 4, radius: 16, cost: { food: 60, gold: 20 }, trainTime: secs(18), age: 2, bonus: { archer: 3, building: 4 } },
  [T.Archer]: { name: "Archer", cls: "archer", hp: 30, attack: 4, armor: 0, range: TILE * 4, cooldown: secs(2), speed: 3, sight: 6, radius: 14, cost: { wood: 25, gold: 45 }, trainTime: secs(18), age: 2, bonus: { infantry: 3 } },
  [T.Scout]: { name: "Scout Rider", cls: "cavalry", hp: 45, attack: 4, armor: 0, range: MELEE, cooldown: secs(1.8), speed: 5, sight: 7, radius: 17, cost: { food: 80 }, trainTime: secs(18), age: 1, bonus: { archer: 4, villager: 2 } },
};

export interface BuildingDef {
  name: string;
  /** Footprint in tiles (square). */
  size: number;
  hp: number;
  armor: number;
  cost: Cost;
  buildTime: number;
  age: 1 | 2;
  sight: number;
  pop: number;
  dropoff: boolean;
  /** Farms are walkable fields; everything else blocks movement. */
  walkable: boolean;
  trains: number[];
  /** Town Centers shoot at nearby enemies. */
  attack?: { damage: number; range: number; cooldown: number };
}

export const BUILDINGS: Record<number, BuildingDef> = {
  [T.TownCenter]: { name: "Town Center", size: 3, hp: 1500, armor: 3, cost: { wood: 300, gold: 100 }, buildTime: secs(60), age: 2, sight: 7, pop: 5, dropoff: true, walkable: false, trains: [T.Villager], attack: { damage: 6, range: TILE * 6, cooldown: secs(2) } },
  [T.House]: { name: "House", size: 2, hp: 400, armor: 3, cost: { wood: 30 }, buildTime: secs(15), age: 1, sight: 2, pop: 5, dropoff: false, walkable: false, trains: [] },
  [T.Storehouse]: { name: "Storehouse", size: 2, hp: 600, armor: 3, cost: { wood: 100 }, buildTime: secs(20), age: 1, sight: 3, pop: 0, dropoff: true, walkable: false, trains: [] },
  [T.Farm]: { name: "Farm", size: 2, hp: 200, armor: 0, cost: { wood: 60 }, buildTime: secs(10), age: 1, sight: 1, pop: 0, dropoff: false, walkable: true, trains: [] },
  [T.Barracks]: { name: "Barracks", size: 3, hp: 1000, armor: 3, cost: { wood: 150 }, buildTime: secs(30), age: 1, sight: 3, pop: 0, dropoff: false, walkable: false, trains: [T.Spearman, T.Scout, T.Swordsman] },
  [T.ArcheryRange]: { name: "Archery Range", size: 3, hp: 1000, armor: 3, cost: { wood: 175 }, buildTime: secs(30), age: 2, sight: 3, pop: 0, dropoff: false, walkable: false, trains: [T.Archer] },
};

/** What villagers can build, in menu order. */
export const BUILD_MENU = [T.House, T.Storehouse, T.Farm, T.Barracks, T.ArcheryRange, T.TownCenter];

export interface NodeDef {
  name: string;
  res: Res;
  amount: number;
  /** Ticks per resource unit gathered. */
  gatherTicks: number;
}

export const NODES: Record<number, NodeDef> = {
  [T.Tree]: { name: "Tree", res: "wood", amount: 100, gatherTicks: 14 },
  [T.GoldMine]: { name: "Gold Mine", res: "gold", amount: 400, gatherTicks: 16 },
  [T.Berries]: { name: "Berry Bush", res: "food", amount: 150, gatherTicks: 14 },
};
export const FARM_FOOD = 250;
export const FARM_GATHER_TICKS = 16;

export const AGE2_COST: Cost = { food: 400, gold: 100 };
export const AGE2_TIME = secs(40);

export interface CivDef {
  name: string;
  bonus: string;
}

export const CIVS: CivDef[] = [
  { name: "Aurelian Concord", bonus: "Villagers carry 12 instead of 10" },
  { name: "Thornmarch Clans", bonus: "Military units train 25% faster" },
];

export const START_RESOURCES: Record<Res, number> = { food: 200, wood: 200, gold: 100 };
export const START_VILLAGERS = 3;

export const isUnit = (type: number) => type in UNITS;
export const isBuilding = (type: number) => type in BUILDINGS;
export const isNode = (type: number) => type in NODES;

export function costOf(type: number): Cost {
  if (type === TECH_AGE2) return AGE2_COST;
  return UNITS[type]?.cost ?? BUILDINGS[type]?.cost ?? {};
}

export function nameOf(type: number): string {
  if (type === TECH_AGE2) return `Advance to ${AGE_NAMES[2]}`;
  return UNITS[type]?.name ?? BUILDINGS[type]?.name ?? NODES[type]?.name ?? "?";
}

export function sightOf(type: number): number {
  return UNITS[type]?.sight ?? BUILDINGS[type]?.sight ?? 0;
}
