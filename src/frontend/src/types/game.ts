/**
 * Shared domain types for the RTS simulation.
 *
 * The simulation is plain TypeScript with no React dependency so it can be
 * driven by a fixed-timestep loop and reasoned about independently of the UI.
 */

export { Faction, MapSize, AiDifficulty, MatchResult } from "@/backend";

export type ResourceKind =
  | "food"
  | "wood"
  | "gold"
  | "stone"
  | "money"
  | "energy";

export const RESOURCE_KINDS: readonly ResourceKind[] = [
  "food",
  "wood",
  "gold",
  "stone",
  "money",
  "energy",
];

export const RESOURCE_LABELS: Record<ResourceKind, string> = {
  food: "Food",
  wood: "Wood",
  gold: "Gold",
  stone: "Stone",
  money: "Money",
  energy: "Energy",
};

export type ResourcePool = Record<ResourceKind, number>;

export type Age = 1 | 2 | 3 | 4;

export const AGE_NAMES: Record<Age, string> = {
  1: "Age of Settlement",
  2: "Age of Iron",
  3: "Age of Powder",
  4: "Age of Empire",
};

export type Stance = "aggressive" | "defensive" | "standGround" | "noAttack";

export const STANCE_LABELS: Record<Stance, string> = {
  aggressive: "Aggressive",
  defensive: "Defensive",
  standGround: "Stand Ground",
  noAttack: "No Attack",
};

export type UnitKind =
  | "villager"
  | "scout"
  | "meleeInfantry"
  | "rangedInfantry"
  | "cavalry"
  | "siege"
  | "praetorian"
  | "keshig"
  | "huscarl";

/** Unit kinds that only a specific faction may train at its Fortress. */
export const FACTION_ELITE_KINDS: readonly UnitKind[] = [
  "praetorian",
  "keshig",
  "huscarl",
];

export type BuildingKind =
  | "townCenter"
  | "house"
  | "mill"
  | "farm"
  | "market"
  | "barracks"
  | "archeryRange"
  | "stable"
  | "blacksmith"
  | "tower"
  | "wall"
  | "fortress"
  | "energyDistribution"
  | "windmill"
  | "watermill"
  | "thermalPlant"
  | "solarArray"
  | "nuclearReactor"
  | "hospital";

/** Team number a player is assigned to in the lobby (1-6). */
export type TeamId = 1 | 2 | 3 | 4 | 5 | 6;

export const TEAM_IDS: readonly TeamId[] = [1, 2, 3, 4, 5, 6];

/** Population limits a player may choose in the lobby. */
export const POPULATION_LIMITS: readonly number[] = [100, 200, 300, 400, 500];

/** Default population limit when a match config omits one. */
export const DEFAULT_POPULATION_LIMIT = 200;

/** Render detail tiers the performance monitor can step down through. */
export type RenderDetail = "high" | "medium" | "low";

export const RENDER_DETAIL_LABELS: Record<RenderDetail, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** A pending investment proposal awaiting the recipient's answer. */
export interface InvestmentProposal {
  id: number;
  /** Player offering the capital. */
  from: PlayerId;
  /** Player who must accept before the contract starts. */
  to: PlayerId;
  /** Money the investor commits up front. */
  principal: number;
  /** Fraction of the principal paid out each interval, e.g. 0.15. */
  rate: number;
  /** Seconds between interest payouts. */
  intervalSeconds: number;
  /** Number of payouts before the contract ends. */
  payments: number;
  /** Match time the proposal was issued. */
  created: number;
}

/** An accepted investment contract paying out on a fixed interval. */
export interface InvestmentContract {
  id: number;
  from: PlayerId;
  to: PlayerId;
  principal: number;
  rate: number;
  intervalSeconds: number;
  /** Payouts still owed before the contract ends. */
  remainingPayments: number;
  /** Seconds accumulated toward the next payout. */
  timer: number;
  /** Match time the contract was signed. */
  started: number;
}

/** A financial-aid gift of resources sent to another player. */
export interface ResourceGift {
  id: number;
  from: PlayerId;
  to: PlayerId;
  resource: ResourceKind;
  amount: number;
  /** Match time the gift was sent. */
  sent: number;
}

/**
 * Resolved power state for an energy-dependent entity.
 *
 * - `standard`  — stockpile positive and production covers upkeep.
 * - `lowPower`  — stockpile low, or upkeep exceeds production.
 * - `blackout`  — the global stockpile has hit zero.
 * - `unpowered` — a consumer outside every owned distribution radius.
 */
export type PowerState = "standard" | "lowPower" | "blackout" | "unpowered";

export const POWER_STATE_LABELS: Record<PowerState, string> = {
  standard: "Standard",
  lowPower: "Low Power",
  blackout: "Blackout",
  unpowered: "Unpowered",
};

export type PlayerId = number;

/**
 * Ten distinct saturated commander colors, indexed by lobby slot. Both the
 * lobby swatches and the in-match renderer read from this single list so a
 * player's chosen color reaches units, buildings, and minimap icons.
 */
export const PLAYER_COLORS: readonly { name: string; value: string }[] = [
  { name: "Red", value: "oklch(0.58 0.22 27)" },
  { name: "Blue", value: "oklch(0.55 0.2 258)" },
  { name: "Green", value: "oklch(0.6 0.19 145)" },
  { name: "Yellow", value: "oklch(0.82 0.18 95)" },
  { name: "Cyan", value: "oklch(0.72 0.14 205)" },
  { name: "Purple", value: "oklch(0.55 0.22 305)" },
  { name: "Orange", value: "oklch(0.68 0.19 55)" },
  { name: "Magenta", value: "oklch(0.62 0.24 340)" },
  { name: "Lime", value: "oklch(0.78 0.2 125)" },
  { name: "Teal", value: "oklch(0.62 0.13 185)" },
];

/** Fallback colors used when a player has no assigned lobby color. */
export const DEFAULT_PLAYER_COLORS: readonly string[] = [
  "rgb(196, 74, 52)",
  "rgb(74, 104, 196)",
];

/** The color assigned to a player, falling back to the legacy two colors. */
export function playerColor(
  colors: readonly string[] | undefined,
  owner: number,
): string {
  const assigned = colors?.[owner];
  if (assigned) return assigned;
  return DEFAULT_PLAYER_COLORS[owner] ?? DEFAULT_PLAYER_COLORS[0];
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface UnitStats {
  maxHealth: number;
  attack: number;
  range: number;
  speed: number;
  armor: number;
  /** Seconds between attacks. */
  attackInterval: number;
  /** Seconds to produce at its building. */
  trainTime: number;
  cost: Partial<ResourcePool>;
  /** Population slots consumed. */
  pop: number;
  /** Energy upkeep per minute. */
  energyUpkeep: number;
  /**
   * Whether the unit's weapon depends on the energy grid. Physical weapons
   * (melee, ranged, cavalry, siege, faction elites) are unaffected by power
   * state even when they draw upkeep.
   */
  energyWeapon?: boolean;
  /** Whether the unit can gather resources. */
  gatherer: boolean;
  /** Whether the unit can construct buildings. */
  builder: boolean;
  /** Whether the unit can repair. */
  repairer: boolean;
  /** Radius used for collision and selection. */
  radius: number;
  /** Minimum age required to train. */
  minAge: Age;
}

export interface BuildingStats {
  maxHealth: number;
  /** Footprint in tiles (width x height). */
  size: number;
  cost: Partial<ResourcePool>;
  /** Seconds of villager work to complete. */
  buildTime: number;
  /** Population slots provided. */
  popProvided: number;
  /** Whether the building acts as a resource drop-off. */
  dropOff: boolean;
  /** Whether the building can train units. */
  trains: readonly UnitKind[];
  /** Whether the building can research upgrades. */
  researches: boolean;
  /** Whether the building can advance the age. */
  advancesAge: boolean;
  /** Whether the building generates Money over time. */
  generatesMoney: boolean;
  /** Whether the building generates Energy over time. */
  generatesEnergy: boolean;
  /** Whether the building consumes Energy as upkeep. */
  energyUpkeep: number;
  /**
   * Whether the building's weapon depends on the energy grid. Energy
   * consumers lose their attack when unpowered or in blackout.
   */
  energyConsumer: boolean;
  /**
   * Radius in world units within which this building powers energy-consuming
   * structures. 0 means the building does not distribute energy.
   */
  distributionRadius: number;
  /** Attack damage for defensive structures (0 = cannot attack). */
  attack: number;
  range: number;
  attackInterval: number;
  /** Minimum age required to construct. */
  minAge: Age;
  /** Whether the building counts toward defeat when destroyed. */
  production: boolean;
}

export interface Unit {
  id: number;
  owner: PlayerId;
  kind: UnitKind;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  stance: Stance;
  /** Current order queue; the first entry is active. */
  orders: Order[];
  /** Current path waypoints in world coordinates. */
  path: Vec2[];
  /** Target entity id, if any. */
  targetId: number | null;
  /** Resource node id being gathered, if any. */
  gatherNodeId: number | null;
  /** Building id being constructed or repaired, if any. */
  workBuildingId: number | null;
  /** Seconds accumulated toward the next attack. */
  attackCooldown: number;
  /** Seconds accumulated toward the next gather tick. */
  gatherTimer: number;
  /** Amount currently carried and its kind. */
  carrying: number;
  carryingKind: ResourceKind | null;
  /** Veterancy rank 0-3. */
  rank: number;
  /** Experience points toward the next rank. */
  xp: number;
  /** Facing angle in radians, for rendering. */
  facing: number;
  /** Seconds remaining of a hit flash, for rendering. */
  hitFlash: number;
  /** Whether the unit is currently moving. */
  moving: boolean;
}

export type Order =
  | { type: "move"; x: number; y: number }
  | { type: "attackMove"; x: number; y: number }
  | { type: "attack"; targetId: number }
  | { type: "gather"; nodeId: number }
  | { type: "build"; buildingId: number }
  | { type: "repair"; buildingId: number }
  | { type: "stop" };

export interface Building {
  id: number;
  owner: PlayerId;
  kind: BuildingKind;
  /** Top-left tile coordinate. */
  tx: number;
  ty: number;
  size: number;
  health: number;
  maxHealth: number;
  /** 0-1 construction progress; 1 means complete. */
  progress: number;
  /** Whether construction has been cancelled. */
  cancelled: boolean;
  /** Training queue of unit kinds. */
  queue: UnitKind[];
  /** Seconds accumulated on the current training item. */
  queueTimer: number;
  /** Rally point for newly trained units. */
  rally: Vec2 | null;
  /** Resource node id of the farm plot this building maintains, if any. */
  farmNodeId: number | null;
  /** Seconds until a depleted farm plot is resown. */
  farmRegrowTimer: number;
  /** Seconds accumulated toward the next automated farm harvest. */
  farmHarvestTimer: number;
  /** Seconds accumulated toward the next thermal fuel burn, if any. */
  fuelTimer: number;
  /** Seconds remaining of a hit flash, for rendering. */
  hitFlash: number;
  /** Attack cooldown for defensive structures. */
  attackCooldown: number;
}

export type NodeKind = "tree" | "gold" | "stone" | "forage" | "animal" | "farm";

/** Upgrade tracks offered by the Blacksmith, Fortress, and Market. */
export type UpgradeKind =
  | "forgedBlades"
  | "temperedArmor"
  | "swiftMarshalling"
  | "siegeWorks"
  | "eliteMuster"
  | "economicPartners";

export interface UpgradeDefinition {
  id: UpgradeKind;
  name: string;
  description: string;
  cost: Partial<ResourcePool>;
  /** Minimum age required to research. */
  minAge: Age;
  /** Which building kinds can research it. */
  buildings: readonly BuildingKind[];
  /** Multiplier applied to unit attack. */
  attackMultiplier?: number;
  /** Multiplier applied to unit armor. */
  armorMultiplier?: number;
  /** Multiplier applied to unit speed. */
  speedMultiplier?: number;
  /** Flat bonus added to unit armor. */
  armorBonus?: number;
  /** Whether researching this upgrade shares line of sight with allies. */
  sharesVision?: boolean;
}

export interface ResourceNode {
  id: number;
  kind: NodeKind;
  x: number;
  y: number;
  /** Remaining amount. */
  amount: number;
  maxAmount: number;
  /** Whether the node has been exhausted. */
  depleted: boolean;
}

export interface TerrainTile {
  height: number;
  kind: "grass" | "dirt" | "rock" | "water" | "sand";
  buildable: boolean;
  walkable: boolean;
}

export interface GameMap {
  width: number;
  height: number;
  tiles: TerrainTile[];
  nodes: ResourceNode[];
  /** Start positions, one per player, indexed by owner. */
  starts: Vec2[];
  /**
   * Per-tile walkability as a flat byte grid (1 walkable, 0 blocked). Kept in
   * sync with `tiles` so the flow-field solver can scan the map without
   * touching the per-tile objects.
   */
  walkable: Uint8Array;
}

export interface PlayerState {
  id: PlayerId;
  faction: import("@/backend").Faction;
  /** Lobby-assigned team, 1-6. Same team means allies. */
  team: TeamId;
  /** Lobby-assigned commander color, used by the renderer and minimap. */
  color: string;
  resources: ResourcePool;
  /** Resources gathered per minute, for the HUD. */
  gatherRates: ResourcePool;
  /** Rolling window of resources delivered, used to derive gatherRates. */
  gatherWindow: GatherSample[];
  /** Seconds accumulated since the last gather-rate sample. */
  gatherSampleTimer: number;
  /** Upgrades this player has researched. */
  upgrades: UpgradeKind[];
  age: Age;
  /** Seconds accumulated toward the next age. */
  ageProgress: number;
  /** Whether the player is advancing an age. */
  advancing: boolean;
  /** Per-player population ceiling chosen in the lobby (100-500). */
  populationLimit: number;
  /** Whether this player shares line of sight with allies. */
  sharesVision: boolean;
  defeated: boolean;
}

/** One bucket of resources delivered during a short sampling interval. */
export interface GatherSample {
  /** Seconds of match time this bucket covers. */
  seconds: number;
  amounts: ResourcePool;
}

export interface Marker {
  id: number;
  kind: "move" | "attack" | "gather" | "build";
  x: number;
  y: number;
  /** Seconds remaining before the marker fades. */
  ttl: number;
}

export interface GameEvent {
  id: number;
  kind: "attack" | "construction" | "age" | "train" | "destroy" | "info";
  message: string;
  /** Seconds remaining before the event expires from the log. */
  ttl: number;
}

export interface MatchConfig {
  faction: import("@/backend").Faction;
  mapSize: import("@/backend").MapSize;
  difficulty: import("@/backend").AiDifficulty;
  /** Team assigned to the human player (1-6). */
  playerTeam: TeamId;
  /** Team assigned to the AI opponent (1-6). */
  aiTeam: TeamId;
  /** Population ceiling for the human player (100-500). */
  populationLimit: number;
  /** Population ceiling for the AI opponent (100-500). */
  aiPopulationLimit: number;
  /**
   * Lobby-assigned commander color per player, indexed by owner. The human is
   * index 0; each AI opponent follows in slot order.
   */
  colors?: string[];
  /**
   * AI opponents to field, in slot order. When omitted the engine falls back
   * to a single opponent built from `aiTeam`/`aiPopulationLimit`. Each entry
   * may carry its own `difficulty`; when absent the engine falls back to the
   * match-wide `difficulty`.
   */
  aiPlayers?: Array<{
    team: TeamId;
    populationLimit: number;
    color: string;
    difficulty?: import("@/backend").AiDifficulty;
  }>;
}

export interface MatchOutcome {
  result: import("@/backend").MatchResult;
  durationSeconds: number;
}

export interface SelectionSummary {
  units: Unit[];
  buildings: Building[];
}
