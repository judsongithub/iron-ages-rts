import { AiDifficulty, Faction, MatchResult } from "@/backend";
import {
  AGE_COSTS,
  AGE_TIMES,
  AI_TUNING,
  BUILDING_STATS,
  BUYABLE_RESOURCES,
  CARRY_CAPACITY,
  DEFAULT_POPULATION_LIMIT,
  ELITE_ONLY_UPGRADES,
  ENERGY_DEFICIT_PRODUCTION_MULTIPLIER,
  ENERGY_GENERATION_RATE,
  ENERGY_SENSITIVE_PRODUCTION,
  FARM_PLOT_FOOD,
  FARM_PRODUCTION_FOOD,
  FARM_PRODUCTION_SECONDS,
  FARM_REGROW_SECONDS,
  FORTRESS_ENERGY_RATE,
  GATHER_RATES,
  GATHER_SAMPLE_SECONDS,
  GATHER_WINDOW_BUCKETS,
  HOSPITAL_ENERGY_DRAW,
  HOSPITAL_HEAL_RADIUS,
  HOSPITAL_HEAL_RATE,
  INVESTMENT_MAX_PAYMENTS,
  INVESTMENT_MAX_PRINCIPAL,
  INVESTMENT_MAX_RATE,
  INVESTMENT_MIN_PRINCIPAL,
  INVESTMENT_MIN_RATE,
  INVESTMENT_PROPOSAL_TTL_SECONDS,
  LOW_POWER_DAMAGE,
  LOW_POWER_RECHARGE,
  LOW_POWER_THRESHOLD,
  MARKET_BUY_RATE,
  MARKET_MONEY_RATE,
  MARKET_SELL_RATE,
  PERF_MIN_POPULATION,
  PERF_POPULATION_STEP,
  RANK_DAMAGE_MULT,
  RANK_HEALTH_MULT,
  RANK_XP,
  SELLABLE_RESOURCES,
  STARTING_RESOURCES,
  THERMAL_FUEL_ENERGY,
  THERMAL_FUEL_SECONDS,
  THERMAL_FUEL_WOOD,
  TICK_SECONDS,
  UNIT_STATS,
  UPGRADES,
} from "@/game/constants";
import { FACTIONS } from "@/game/factions";
import {
  type FlowFieldCache,
  createFlowFieldCache,
  getFlowField,
  stepAlongFlow,
} from "@/game/flowfield";
import { generateMap, isBuildable, tileAt } from "@/game/mapgen";
import {
  blockedTilesFor,
  findPath,
  spreadDestination,
  tileKey,
} from "@/game/pathfinding";
import type {
  Age,
  Building,
  BuildingKind,
  GameEvent,
  GameMap,
  GatherSample,
  InvestmentContract,
  InvestmentProposal,
  Marker,
  MatchConfig,
  MatchOutcome,
  NodeKind,
  Order,
  PlayerId,
  PlayerState,
  PowerState,
  RenderDetail,
  ResourceGift,
  ResourceKind,
  ResourceNode,
  ResourcePool,
  Stance,
  TeamId,
  Unit,
  UnitKind,
  UpgradeKind,
  Vec2,
} from "@/types/game";

export interface GameState {
  map: GameMap;
  units: Unit[];
  buildings: Building[];
  players: PlayerState[];
  markers: Marker[];
  events: GameEvent[];
  /** Elapsed match time in seconds. */
  elapsed: number;
  /** Whether the match has ended. */
  finished: boolean;
  outcome: MatchOutcome | null;
  /** Fog-of-war visibility per tile for player 0: 0 hidden, 1 explored, 2 visible. */
  fog: Uint8Array;
  /** Accumulator for fog recomputation. */
  fogTimer: number;
  /** AI decision accumulator. */
  aiTimer: number;
  /** AI attack wave accumulator. */
  aiWaveTimer: number;
  /**
   * Per-player AI decision accumulators, indexed by owner. Each AI slot runs
   * its own difficulty cadence, so timers cannot be shared.
   */
  aiTimers: number[];
  /** Per-player AI attack wave accumulators, indexed by owner. */
  aiWaveTimers: number[];
  /** Control groups 1-9, each a list of unit ids. */
  controlGroups: Record<number, number[]>;
  /** Difficulty-scaled gather multiplier applied to the AI player. */
  aiGatherMult: number;
  /**
   * Per-player difficulty gather multiplier, indexed by owner. Each AI slot
   * may run its own difficulty; the human (owner 0) is always 1.
   */
  aiGatherMults: number[];
  config: MatchConfig;
  nextId: number;
  /** Cached flow fields for group movement. */
  flowCache: FlowFieldCache;
  /** Pending investment proposals awaiting an answer. */
  proposals: InvestmentProposal[];
  /** Accepted investment contracts paying out on an interval. */
  contracts: InvestmentContract[];
  /** Financial-aid gifts sent between players, newest last. */
  gifts: ResourceGift[];
  /** Current render detail tier chosen by the performance monitor. */
  renderDetail: RenderDetail;
  /** Global population ceiling reduction applied by auto-scaling. */
  populationPenalty: number;
  /** Whether the performance monitor has already lowered the global cap. */
  populationLowered: boolean;
}

const RESOURCE_KEYS: readonly ResourceKind[] = [
  "food",
  "wood",
  "gold",
  "stone",
  "money",
  "energy",
];

function emptyPool(): ResourcePool {
  return { food: 0, wood: 0, gold: 0, stone: 0, money: 0, energy: 0 };
}

function clonePool(pool: ResourcePool): ResourcePool {
  return { ...pool };
}

function canAfford(pool: ResourcePool, cost: Partial<ResourcePool>): boolean {
  for (const key of RESOURCE_KEYS) {
    const amount = cost[key];
    if (amount !== undefined && pool[key] < amount) return false;
  }
  return true;
}

function pay(pool: ResourcePool, cost: Partial<ResourcePool>): void {
  for (const key of RESOURCE_KEYS) {
    const amount = cost[key];
    if (amount !== undefined) pool[key] -= amount;
  }
}

function refund(pool: ResourcePool, cost: Partial<ResourcePool>): void {
  for (const key of RESOURCE_KEYS) {
    const amount = cost[key];
    if (amount !== undefined) pool[key] += amount;
  }
}

function scaleCost(
  cost: Partial<ResourcePool>,
  multiplier: number,
): Partial<ResourcePool> {
  const out: Partial<ResourcePool> = {};
  for (const key of RESOURCE_KEYS) {
    const amount = cost[key];
    if (amount !== undefined) out[key] = Math.round(amount * multiplier);
  }
  return out;
}

function unitCost(kind: UnitKind, faction: Faction): Partial<ResourcePool> {
  return scaleCost(UNIT_STATS[kind].cost, FACTIONS[faction].costMultiplier);
}

function buildingCost(
  kind: BuildingKind,
  faction: Faction,
): Partial<ResourcePool> {
  return scaleCost(BUILDING_STATS[kind].cost, FACTIONS[faction].costMultiplier);
}

function clampPopulationLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_POPULATION_LIMIT;
  }
  return Math.max(1, Math.round(limit));
}

function makePlayer(
  id: PlayerId,
  faction: Faction,
  team: TeamId,
  populationLimit: number,
  color: string,
): PlayerState {
  return {
    id,
    faction,
    team,
    color,
    resources: clonePool(STARTING_RESOURCES),
    gatherRates: emptyPool(),
    gatherWindow: [],
    gatherSampleTimer: 0,
    upgrades: [],
    age: 1,
    ageProgress: 0,
    advancing: false,
    populationLimit: clampPopulationLimit(populationLimit),
    sharesVision: false,
    defeated: false,
  };
}

/** Creates a fresh match state from a configuration. */
export function createGame(config: MatchConfig, seed: number): GameState {
  // One human plus one AI per configured opponent. When the config omits the
  // AI list, fall back to the legacy single-opponent fields.
  const aiPlayers =
    config.aiPlayers && config.aiPlayers.length > 0
      ? config.aiPlayers
      : [
          {
            team: config.aiTeam ?? 2,
            populationLimit: config.aiPopulationLimit,
            color: config.colors?.[1] ?? "",
            difficulty: config.difficulty,
          },
        ];
  // Each AI slot may run its own difficulty; fall back to the match-wide
  // difficulty so single-AI behavior is unchanged.
  const aiDifficulties = aiPlayers.map(
    (ai) => ai.difficulty ?? config.difficulty,
  );
  const playerCount = 1 + aiPlayers.length;
  const map = generateMap(config.mapSize, seed, playerCount);
  const players: PlayerState[] = [
    makePlayer(
      0,
      config.faction,
      config.playerTeam ?? 1,
      config.populationLimit,
      config.colors?.[0] ?? "",
    ),
  ];
  aiPlayers.forEach((ai, index) => {
    players.push(
      makePlayer(
        index + 1,
        aiFactionFor(config.faction, index),
        ai.team,
        ai.populationLimit,
        ai.color || config.colors?.[index + 1] || "",
      ),
    );
  });

  const state: GameState = {
    map,
    units: [],
    buildings: [],
    players,
    markers: [],
    events: [],
    elapsed: 0,
    finished: false,
    outcome: null,
    fog: new Uint8Array(map.width * map.height),
    fogTimer: 0,
    aiTimer: 0,
    aiWaveTimer: 0,
    aiTimers: players.map(() => 0),
    aiWaveTimers: players.map(() => 0),
    controlGroups: {},
    aiGatherMult: AI_TUNING[config.difficulty]?.gatherMult ?? 1,
    aiGatherMults: [
      1,
      ...aiDifficulties.map(
        (difficulty) => AI_TUNING[difficulty]?.gatherMult ?? 1,
      ),
    ],
    config,
    nextId: 1,
    flowCache: createFlowFieldCache(),
    proposals: [],
    contracts: [],
    gifts: [],
    renderDetail: "high",
    populationPenalty: 0,
    populationLowered: false,
  };

  for (const player of state.players) {
    spawnStartingTown(state, player.id, map.starts[player.id]);
  }
  recomputeFog(state);
  return state;
}

function aiFactionFor(playerFaction: Faction, index = 0): Faction {
  const all = [Faction.romans, Faction.mongols, Faction.vikings];
  const others = all.filter((f) => f !== playerFaction);
  return others[index % others.length] ?? Faction.romans;
}

function spawnStartingTown(
  state: GameState,
  owner: PlayerId,
  start: Vec2,
): void {
  const tx = Math.floor(start.x) - 2;
  const ty = Math.floor(start.y) - 2;
  const tc = addBuilding(state, owner, "townCenter", tx, ty, true);
  tc.rally = { x: start.x + 3, y: start.y + 3 };

  const villagerSpots: Vec2[] = [
    { x: start.x + 3, y: start.y - 1 },
    { x: start.x + 3, y: start.y + 1 },
    { x: start.x + 4, y: start.y },
    { x: start.x + 2, y: start.y + 3 },
  ];
  for (const spot of villagerSpots) {
    addUnit(state, owner, "villager", spot.x, spot.y);
  }
  addUnit(state, owner, "scout", start.x - 3, start.y + 3);
}

function addUnit(
  state: GameState,
  owner: PlayerId,
  kind: UnitKind,
  x: number,
  y: number,
): Unit {
  const stats = UNIT_STATS[kind];
  const faction = state.players[owner].faction;
  const healthMult = FACTIONS[faction].unitHealthMultiplier;
  const maxHealth = Math.round(stats.maxHealth * healthMult);
  const unit: Unit = {
    id: state.nextId,
    owner,
    kind,
    x,
    y,
    health: maxHealth,
    maxHealth,
    stance: "aggressive",
    orders: [],
    path: [],
    targetId: null,
    gatherNodeId: null,
    workBuildingId: null,
    attackCooldown: 0,
    gatherTimer: 0,
    carrying: 0,
    carryingKind: null,
    rank: 0,
    xp: 0,
    facing: 0,
    hitFlash: 0,
    moving: false,
  };
  state.nextId += 1;
  state.units.push(unit);
  return unit;
}

function addBuilding(
  state: GameState,
  owner: PlayerId,
  kind: BuildingKind,
  tx: number,
  ty: number,
  complete: boolean,
): Building {
  const stats = BUILDING_STATS[kind];
  const faction = state.players[owner].faction;
  const maxHealth = Math.round(
    stats.maxHealth * FACTIONS[faction].buildingHealthMultiplier,
  );
  const building: Building = {
    id: state.nextId,
    owner,
    kind,
    tx,
    ty,
    size: stats.size,
    health: complete ? maxHealth : Math.max(1, Math.round(maxHealth * 0.1)),
    maxHealth,
    progress: complete ? 1 : 0,
    cancelled: false,
    queue: [],
    queueTimer: 0,
    rally: null,
    farmNodeId: null,
    farmRegrowTimer: 0,
    farmHarvestTimer: 0,
    fuelTimer: 0,
    hitFlash: 0,
    attackCooldown: 0,
  };
  state.nextId += 1;
  state.buildings.push(building);
  return building;
}

function pushEvent(
  state: GameState,
  kind: GameEvent["kind"],
  message: string,
): void {
  state.events.push({ id: state.nextId, kind, message, ttl: 12 });
  state.nextId += 1;
  if (state.events.length > 40)
    state.events.splice(0, state.events.length - 40);
}

function pushMarker(
  state: GameState,
  kind: Marker["kind"],
  x: number,
  y: number,
): void {
  state.markers.push({ id: state.nextId, kind, x, y, ttl: 0.9 });
  state.nextId += 1;
  if (state.markers.length > 60)
    state.markers.splice(0, state.markers.length - 60);
}

// ---------------------------------------------------------------------------
// Diplomacy
// ---------------------------------------------------------------------------

/** Whether two players are on the same team. */
export function areAllies(state: GameState, a: PlayerId, b: PlayerId): boolean {
  if (a === b) return true;
  return state.players[a].team === state.players[b].team;
}

/** Whether `other` is an ally of `owner`. */
export function isAlly(
  state: GameState,
  owner: PlayerId,
  other: PlayerId,
): boolean {
  return areAllies(state, owner, other);
}

/** Whether `other` is an enemy of `owner` (a different team). */
export function isEnemy(
  state: GameState,
  owner: PlayerId,
  other: PlayerId,
): boolean {
  return !areAllies(state, owner, other);
}

/** Whether a player has signed the Economic Partners charter. */
export function sharesVisionWithAllies(
  state: GameState,
  owner: PlayerId,
): boolean {
  return state.players[owner].sharesVision;
}

/**
 * Whether `owner` can currently see through `other`'s units and buildings.
 * Vision is shared only once the owner has researched Economic Partners.
 */
export function sharesVision(
  state: GameState,
  owner: PlayerId,
  other: PlayerId,
): boolean {
  if (owner === other) return true;
  if (!areAllies(state, owner, other)) return false;
  return state.players[owner].sharesVision;
}

/**
 * The set of tile keys blocked for a unit, honouring allied pass-through.
 * Allied buildings and allied gates in walls are open ground.
 */
export function blockedTilesForOwner(
  state: GameState,
  owner: PlayerId,
): Set<string> {
  return blockedTilesFor(state.buildings, owner, (a, b) =>
    areAllies(state, a as PlayerId, b as PlayerId),
  );
}

/** Returns the set of tile keys blocked by buildings for player 0. */
export function blockedTiles(state: GameState): Set<string> {
  return blockedTilesForOwner(state, 0);
}

function unitAt(state: GameState, id: number): Unit | null {
  return state.units.find((u) => u.id === id) ?? null;
}

function buildingAt(state: GameState, id: number): Building | null {
  return state.buildings.find((b) => b.id === id) ?? null;
}

function nodeAt(state: GameState, id: number): ResourceNode | null {
  return state.map.nodes.find((n) => n.id === id) ?? null;
}

function unitStatsFor(
  state: GameState,
  unit: Unit,
): {
  attack: number;
  range: number;
  speed: number;
  armor: number;
  attackInterval: number;
} {
  const base = UNIT_STATS[unit.kind];
  const faction = state.players[unit.owner].faction;
  const attackMult =
    FACTIONS[faction].attackMultiplier * RANK_DAMAGE_MULT[unit.rank];
  const upgrades = state.players[unit.owner].upgrades;
  const isElite = unit.kind === "siege" || isFactionElite(unit.kind);
  let attackBonus = 1;
  let speedBonus = 1;
  let armorBonus = 0;
  for (const id of upgrades) {
    const upgrade = UPGRADES[id];
    if (!upgrade) continue;
    if (ELITE_ONLY_UPGRADES.includes(id) && !isElite) continue;
    if (upgrade.attackMultiplier) attackBonus *= upgrade.attackMultiplier;
    if (upgrade.speedMultiplier) speedBonus *= upgrade.speedMultiplier;
    if (upgrade.armorBonus) armorBonus += upgrade.armorBonus;
  }
  return {
    attack: base.attack * attackMult * attackBonus,
    range: base.range,
    speed: base.speed * speedBonus,
    armor: base.armor + armorBonus,
    attackInterval: base.attackInterval,
  };
}

/** Whether a unit kind is one of the faction-specific Fortress elites. */
export function isFactionElite(kind: UnitKind): boolean {
  return kind === "praetorian" || kind === "keshig" || kind === "huscarl";
}

/** The elite unit kind trainable by a faction at its Fortress. */
export function factionEliteKind(faction: Faction): UnitKind {
  return FACTIONS[faction].eliteUnit;
}

function buildingCenter(b: Building): Vec2 {
  return { x: b.tx + b.size / 2, y: b.ty + b.size / 2 };
}

function distanceToBuilding(unit: Unit, b: Building): number {
  const c = buildingCenter(b);
  const half = b.size / 2;
  const dx = Math.max(Math.abs(unit.x - c.x) - half, 0);
  const dy = Math.max(Math.abs(unit.y - c.y) - half, 0);
  return Math.hypot(dx, dy);
}

function nearestDropOff(state: GameState, unit: Unit): Building | null {
  let best: Building | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const b of state.buildings) {
    if (b.owner !== unit.owner || b.cancelled || b.progress < 1) continue;
    if (!BUILDING_STATS[b.kind].dropOff) continue;
    const d = distanceToBuilding(unit, b);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return best;
}

function nearestNode(
  state: GameState,
  unit: Unit,
  kinds: readonly NodeKind[],
): ResourceNode | null {
  let best: ResourceNode | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const node of state.map.nodes) {
    if (node.depleted || node.amount <= 0) continue;
    if (!kinds.includes(node.kind)) continue;
    // Farm plots belong to the player whose Farm building maintains them.
    if (node.kind === "farm" && !farmBelongsTo(state, node, unit.owner))
      continue;
    const d = Math.hypot(node.x - unit.x, node.y - unit.y);
    if (d < bestDist) {
      bestDist = d;
      best = node;
    }
  }
  return best;
}

/** Whether a farm plot is maintained by a building owned by `owner`. */
function farmBelongsTo(
  state: GameState,
  node: ResourceNode,
  owner: PlayerId,
): boolean {
  return state.buildings.some(
    (b) =>
      b.owner === owner &&
      b.kind === "farm" &&
      !b.cancelled &&
      b.farmNodeId === node.id,
  );
}

function nearestEnemy(
  state: GameState,
  unit: Unit,
  range: number,
):
  | { kind: "unit"; unit: Unit }
  | { kind: "building"; building: Building }
  | null {
  let best:
    | { kind: "unit"; unit: Unit }
    | { kind: "building"; building: Building }
    | null = null;
  let bestDist = range;
  for (const other of state.units) {
    if (other.health <= 0) continue;
    if (!isEnemy(state, unit.owner, other.owner)) continue;
    const d = Math.hypot(other.x - unit.x, other.y - unit.y);
    if (d < bestDist) {
      bestDist = d;
      best = { kind: "unit", unit: other };
    }
  }
  for (const b of state.buildings) {
    if (b.cancelled) continue;
    if (!isEnemy(state, unit.owner, b.owner)) continue;
    const d = distanceToBuilding(unit, b);
    if (d < bestDist) {
      bestDist = d;
      best = { kind: "building", building: b };
    }
  }
  return best;
}

function populationUsed(state: GameState, owner: PlayerId): number {
  let used = 0;
  for (const u of state.units) {
    if (u.owner === owner) used += UNIT_STATS[u.kind].pop;
  }
  return used;
}

/**
 * Population ceiling for a player: the lobby-configured limit, reduced by any
 * global auto-scaling penalty, and never above the housing the player has
 * actually built.
 */
export function populationCap(state: GameState, owner: PlayerId): number {
  let housing = 0;
  for (const b of state.buildings) {
    if (b.owner !== owner || b.cancelled || b.progress < 1) continue;
    housing += BUILDING_STATS[b.kind].popProvided;
  }
  const limit = Math.max(
    PERF_MIN_POPULATION,
    state.players[owner].populationLimit - state.populationPenalty,
  );
  return Math.min(housing, limit);
}

export function population(
  state: GameState,
  owner: PlayerId,
): {
  used: number;
  cap: number;
} {
  return {
    used: populationUsed(state, owner),
    cap: populationCap(state, owner),
  };
}

function energyUpkeep(state: GameState, owner: PlayerId): number {
  let upkeep = 0;
  for (const u of state.units) {
    if (u.owner === owner) upkeep += UNIT_STATS[u.kind].energyUpkeep;
  }
  for (const b of state.buildings) {
    if (b.owner === owner && !b.cancelled && b.progress >= 1) {
      upkeep += BUILDING_STATS[b.kind].energyUpkeep;
    }
  }
  return upkeep;
}

/** Energy per second a single completed building contributes to the grid. */
function buildingEnergyOutput(building: Building): number {
  const stats = BUILDING_STATS[building.kind];
  if (!stats.generatesEnergy) return 0;
  if (building.kind === "fortress") return FORTRESS_ENERGY_RATE;
  return ENERGY_GENERATION_RATE[building.kind] ?? 0;
}

function energyProduction(state: GameState, owner: PlayerId): number {
  let production = 0;
  for (const b of state.buildings) {
    if (b.owner !== owner || b.cancelled || b.progress < 1) continue;
    production += buildingEnergyOutput(b);
  }
  return production;
}

/** Whether the player's energy balance is negative (slows heavy units). */
export function energyDeficit(state: GameState, owner: PlayerId): boolean {
  return energyUpkeep(state, owner) > energyProduction(state, owner);
}

/** Total energy generated per second by a player's completed structures. */
export function energyProductionRate(
  state: GameState,
  owner: PlayerId,
): number {
  return energyProduction(state, owner);
}

/** Total energy drawn per second by a player's units and completed structures. */
export function energyUpkeepRate(state: GameState, owner: PlayerId): number {
  return energyUpkeep(state, owner);
}

/**
 * Production multiplier applied to a building while its owner runs an energy
 * deficit. Barracks, Workshops, and Markets slow to half speed.
 */
export function productionMultiplier(
  state: GameState,
  building: Building,
): number {
  if (!ENERGY_SENSITIVE_PRODUCTION.includes(building.kind)) return 1;
  return energyDeficit(state, building.owner)
    ? ENERGY_DEFICIT_PRODUCTION_MULTIPLIER
    : 1;
}

/**
 * Resolves a player's global grid state from the stockpile and balance.
 *
 * `unpowered` is never returned here: it is a per-structure condition that
 * depends on distribution coverage, not on the global balance.
 */
export function powerStateFor(
  state: GameState,
  owner: PlayerId,
): Exclude<PowerState, "unpowered"> {
  const player = state.players[owner];
  if (player.resources.energy <= 0) return "blackout";
  if (
    player.resources.energy < LOW_POWER_THRESHOLD ||
    energyUpkeep(state, owner) > energyProduction(state, owner)
  ) {
    return "lowPower";
  }
  return "standard";
}

/** Whether a completed, owned Energy Distribution Center covers a point. */
function isWithinDistribution(
  state: GameState,
  owner: PlayerId,
  x: number,
  y: number,
): boolean {
  for (const b of state.buildings) {
    if (b.owner !== owner || b.cancelled || b.progress < 1) continue;
    const radius = BUILDING_STATS[b.kind].distributionRadius;
    if (radius <= 0) continue;
    const c = buildingCenter(b);
    if (Math.hypot(c.x - x, c.y - y) <= radius) return true;
  }
  return false;
}

/** Whether a structure sits inside one of its owner's distribution radii. */
export function isStructurePowered(
  state: GameState,
  building: Building,
): boolean {
  if (!BUILDING_STATS[building.kind].energyConsumer) return true;
  const c = buildingCenter(building);
  const half = building.size / 2;
  // Test the structure's footprint corners and centre against the radius so a
  // structure is powered only while its footprint lies within coverage.
  const points: readonly Vec2[] = [
    { x: c.x - half, y: c.y - half },
    { x: c.x + half, y: c.y - half },
    { x: c.x - half, y: c.y + half },
    { x: c.x + half, y: c.y + half },
    { x: c.x, y: c.y },
  ];
  return points.every((p) =>
    isWithinDistribution(state, building.owner, p.x, p.y),
  );
}

/**
 * Resolved power state for a building. Non-consumers report `standard`;
 * consumers outside every distribution radius report `unpowered`.
 */
export function powerStateForBuilding(
  state: GameState,
  building: Building,
): PowerState {
  if (!BUILDING_STATS[building.kind].energyConsumer) return "standard";
  if (!isStructurePowered(state, building)) return "unpowered";
  return powerStateFor(state, building.owner);
}

/** Whether a unit kind's weapon depends on the energy grid. */
export function isEnergyWeaponUnit(kind: UnitKind): boolean {
  return UNIT_STATS[kind].energyWeapon === true;
}

/**
 * Resolved power state for a unit. Physical weapons always report `standard`;
 * energy weapons follow the owner's global grid state.
 */
export function powerStateForUnit(state: GameState, unit: Unit): PowerState {
  if (!isEnergyWeaponUnit(unit.kind)) return "standard";
  return powerStateFor(state, unit.owner);
}

/** Signed energy draw per second for a unit: negative consumes, positive generates. */
export function energyDrawOfUnit(unit: Unit): number {
  return -UNIT_STATS[unit.kind].energyUpkeep;
}

/** Signed energy draw per second for a building. */
export function energyDrawOfBuilding(building: Building): number {
  const stats = BUILDING_STATS[building.kind];
  const output = buildingEnergyOutput(building);
  return output - stats.energyUpkeep;
}

/**
 * Attack modifiers applied to an energy weapon for its current power state.
 * Physical weapons always receive the neutral modifiers.
 */
function powerModifiers(
  state: GameState,
  owner: PlayerId,
  energyWeapon: boolean,
): { damage: number; interval: number; canFire: boolean } {
  if (!energyWeapon) return { damage: 1, interval: 1, canFire: true };
  const power = powerStateFor(state, owner);
  if (power === "blackout") return { damage: 0, interval: 1, canFire: false };
  if (power === "lowPower") {
    return {
      damage: LOW_POWER_DAMAGE,
      interval: LOW_POWER_RECHARGE,
      canFire: true,
    };
  }
  return { damage: 1, interval: 1, canFire: true };
}

// ---------------------------------------------------------------------------
// Farms
// ---------------------------------------------------------------------------

/** Sows a fresh farm plot at the centre of a completed Farm building. */
function sowFarmPlot(state: GameState, building: Building): void {
  const center = buildingCenter(building);
  const node: ResourceNode = {
    id: state.nextId,
    kind: "farm",
    x: center.x,
    y: center.y,
    amount: FARM_PLOT_FOOD,
    maxAmount: FARM_PLOT_FOOD,
    depleted: false,
  };
  state.nextId += 1;
  state.map.nodes.push(node);
  building.farmNodeId = node.id;
  building.farmRegrowTimer = 0;
}

/**
 * Automated farming.
 *
 * A completed Farm feeds its owner's stockpile on a fixed 20-second cadence
 * with no Villager assigned to it. The plot itself is still a gather node for
 * villagers who choose to work it, and it resows itself when exhausted.
 */
function updateFarms(state: GameState, dt: number): void {
  for (const building of state.buildings) {
    if (building.kind !== "farm" || building.cancelled) continue;
    if (building.progress < 1) continue;
    if (building.farmNodeId === null) {
      sowFarmPlot(state, building);
    }
    const farmNodeId = building.farmNodeId;
    if (farmNodeId === null) continue;
    const node = nodeAt(state, farmNodeId);
    if (!node) {
      building.farmNodeId = null;
      continue;
    }
    if (node.depleted) {
      building.farmRegrowTimer += dt;
      if (building.farmRegrowTimer >= FARM_REGROW_SECONDS) {
        node.amount = FARM_PLOT_FOOD;
        node.depleted = false;
        building.farmRegrowTimer = 0;
      }
    }

    // Automated harvest: no villager required.
    building.farmHarvestTimer += dt;
    if (building.farmHarvestTimer >= FARM_PRODUCTION_SECONDS) {
      building.farmHarvestTimer -= FARM_PRODUCTION_SECONDS;
      const player = state.players[building.owner];
      player.resources.food += FARM_PRODUCTION_FOOD;
      recordGathered(player, "food", FARM_PRODUCTION_FOOD);
    }
  }
}

/** Food per second a player's completed Farms add to the stockpile. */
export function farmFoodRate(state: GameState, owner: PlayerId): number {
  let farms = 0;
  for (const b of state.buildings) {
    if (b.owner !== owner || b.cancelled || b.progress < 1) continue;
    if (b.kind === "farm") farms += 1;
  }
  return farms * (FARM_PRODUCTION_FOOD / FARM_PRODUCTION_SECONDS);
}

// ---------------------------------------------------------------------------
// Thermal fuel and hospitals
// ---------------------------------------------------------------------------

/**
 * Thermal Power Stations periodically burn Wood for their energy output. A
 * station with no Wood in the stockpile produces nothing until resupplied.
 */
function updateThermalPlants(state: GameState, dt: number): void {
  for (const building of state.buildings) {
    if (building.kind !== "thermalPlant" || building.cancelled) continue;
    if (building.progress < 1) continue;
    building.fuelTimer += dt;
    if (building.fuelTimer < THERMAL_FUEL_SECONDS) continue;
    building.fuelTimer -= THERMAL_FUEL_SECONDS;
    const player = state.players[building.owner];
    if (player.resources.wood < THERMAL_FUEL_WOOD) continue;
    player.resources.wood -= THERMAL_FUEL_WOOD;
    player.resources.energy += THERMAL_FUEL_ENERGY;
  }
}

/**
 * Hospitals continuously consume Energy to heal nearby damaged units. A
 * hospital outside distribution coverage, or on a blacked-out grid, heals
 * nothing.
 */
function updateHospitals(state: GameState, dt: number): void {
  for (const building of state.buildings) {
    if (building.kind !== "hospital" || building.cancelled) continue;
    if (building.progress < 1) continue;
    if (!isStructurePowered(state, building)) continue;
    const power = powerStateFor(state, building.owner);
    if (power === "blackout") continue;
    const player = state.players[building.owner];
    if (player.resources.energy < HOSPITAL_ENERGY_DRAW * dt) continue;
    const center = buildingCenter(building);
    let healed = false;
    for (const unit of state.units) {
      if (unit.owner !== building.owner || unit.health <= 0) continue;
      if (unit.health >= unit.maxHealth) continue;
      const d = Math.hypot(unit.x - center.x, unit.y - center.y);
      if (d > HOSPITAL_HEAL_RADIUS) continue;
      unit.health = Math.min(
        unit.maxHealth,
        unit.health + HOSPITAL_HEAL_RATE * dt,
      );
      healed = true;
    }
    if (healed) {
      player.resources.energy = Math.max(
        0,
        player.resources.energy - HOSPITAL_ENERGY_DRAW * dt,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Market trade
// ---------------------------------------------------------------------------

/** Money received for selling `amount` of a resource at the Market. */
export function sellValue(resource: ResourceKind, amount: number): number {
  const rate = MARKET_SELL_RATE[resource] ?? 0;
  return Math.floor(amount * rate);
}

/** Money required to buy `amount` of a resource at the Market. */
export function buyValue(resource: ResourceKind, amount: number): number {
  const rate = MARKET_BUY_RATE[resource] ?? 0;
  return Math.ceil(amount * rate);
}

/** Whether a player has a completed Market. */
export function hasCompletedMarket(state: GameState, owner: PlayerId): boolean {
  return state.buildings.some(
    (b) =>
      b.owner === owner &&
      b.kind === "market" &&
      !b.cancelled &&
      b.progress >= 1,
  );
}

/**
 * Sells a resource at the Market for Money. Requires a completed Market and
 * enough of the chosen resource. Returns the Money gained, or 0 on failure.
 */
export function sellResource(
  state: GameState,
  owner: PlayerId,
  resource: ResourceKind,
  amount: number,
): number {
  if (!SELLABLE_RESOURCES.includes(resource)) return 0;
  if (amount <= 0) return 0;
  if (!hasCompletedMarket(state, owner)) return 0;
  const player = state.players[owner];
  const available = Math.floor(player.resources[resource]);
  const sold = Math.min(amount, available);
  if (sold <= 0) return 0;
  const money = sellValue(resource, sold);
  if (money <= 0) return 0;
  player.resources[resource] -= sold;
  player.resources.money += money;
  if (owner === 0) {
    pushEvent(state, "info", `Sold ${sold} ${resource} for ${money} Money.`);
  }
  return money;
}

/**
 * Buys a resource at the Market with Money. Requires a completed Market and
 * enough Money. Returns the amount actually bought, or 0 on failure.
 */
export function buyResource(
  state: GameState,
  owner: PlayerId,
  resource: ResourceKind,
  amount: number,
): number {
  if (!BUYABLE_RESOURCES.includes(resource)) return 0;
  if (amount <= 0) return 0;
  if (!hasCompletedMarket(state, owner)) return 0;
  const player = state.players[owner];
  const affordable = Math.floor(
    player.resources.money / (MARKET_BUY_RATE[resource] ?? 1),
  );
  const bought = Math.min(amount, affordable);
  if (bought <= 0) return 0;
  const cost = buyValue(resource, bought);
  if (cost <= 0 || player.resources.money < cost) return 0;
  player.resources.money -= cost;
  player.resources[resource] += bought;
  if (owner === 0) {
    pushEvent(state, "info", `Bought ${bought} ${resource} for ${cost} Money.`);
  }
  return bought;
}

/**
 * Sends a financial-aid gift of resources to another player. Requires a
 * completed Market and enough of the chosen resource. Returns true on success.
 */
export function sendResources(
  state: GameState,
  from: PlayerId,
  to: PlayerId,
  resource: ResourceKind,
  amount: number,
): boolean {
  if (from === to) return false;
  if (amount <= 0) return false;
  if (!hasCompletedMarket(state, from)) return false;
  const sender = state.players[from];
  const available = Math.floor(sender.resources[resource]);
  if (available < amount) return false;
  sender.resources[resource] -= amount;
  state.players[to].resources[resource] += amount;
  state.gifts.push({
    id: state.nextId,
    from,
    to,
    resource,
    amount,
    sent: state.elapsed,
  });
  state.nextId += 1;
  if (state.gifts.length > 40) state.gifts.splice(0, state.gifts.length - 40);
  if (from === 0) {
    pushEvent(
      state,
      "info",
      `Sent ${amount} ${resource} to ${playerLabel(state, to)}.`,
    );
  }
  return true;
}

/**
 * Requests resources from another player. A request is a recorded ask, not a
 * transfer: the recipient answers it by sending a gift.
 */
export function requestResources(
  state: GameState,
  from: PlayerId,
  to: PlayerId,
  resource: ResourceKind,
  amount: number,
): boolean {
  if (from === to) return false;
  if (amount <= 0) return false;
  if (!hasCompletedMarket(state, from)) return false;
  if (from === 0) {
    pushEvent(
      state,
      "info",
      `Requested ${amount} ${resource} from ${playerLabel(state, to)}.`,
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// Investment proposals and contracts
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Issues an investment proposal to another player, e.g. "Invest 1,000 Money
 * for a 15% return every 3 minutes". The principal is committed immediately
 * and held until the proposal is accepted or lapses.
 */
export function proposeInvestment(
  state: GameState,
  from: PlayerId,
  to: PlayerId,
  principal: number,
  rate: number,
  intervalSeconds: number,
  payments: number,
): InvestmentProposal | null {
  if (from === to) return null;
  if (!hasCompletedMarket(state, from)) return null;
  const amount = clamp(
    Math.round(principal),
    INVESTMENT_MIN_PRINCIPAL,
    INVESTMENT_MAX_PRINCIPAL,
  );
  const share = clamp(rate, INVESTMENT_MIN_RATE, INVESTMENT_MAX_RATE);
  const interval = clamp(Math.round(intervalSeconds), 30, 600);
  const count = clamp(Math.round(payments), 1, INVESTMENT_MAX_PAYMENTS);
  const investor = state.players[from];
  if (investor.resources.money < amount) return null;
  investor.resources.money -= amount;
  const proposal: InvestmentProposal = {
    id: state.nextId,
    from,
    to,
    principal: amount,
    rate: share,
    intervalSeconds: interval,
    payments: count,
    created: state.elapsed,
  };
  state.nextId += 1;
  state.proposals.push(proposal);
  if (from === 0) {
    pushEvent(
      state,
      "info",
      `Proposed an investment of ${amount} Money to ${playerLabel(state, to)}.`,
    );
  }
  return proposal;
}

/** Accepts a pending proposal, converting it into a paying contract. */
export function acceptInvestment(
  state: GameState,
  proposalId: number,
): boolean {
  const index = state.proposals.findIndex((p) => p.id === proposalId);
  if (index < 0) return false;
  const proposal = state.proposals[index];
  state.proposals.splice(index, 1);
  const contract: InvestmentContract = {
    id: proposal.id,
    from: proposal.from,
    to: proposal.to,
    principal: proposal.principal,
    rate: proposal.rate,
    intervalSeconds: proposal.intervalSeconds,
    remainingPayments: proposal.payments,
    timer: 0,
    started: state.elapsed,
  };
  state.contracts.push(contract);
  if (proposal.to === 0 || proposal.from === 0) {
    pushEvent(
      state,
      "info",
      `Investment accepted: ${proposal.principal} Money at ${Math.round(proposal.rate * 100)}% every ${Math.round(proposal.intervalSeconds / 60)} min.`,
    );
  }
  return true;
}

/** Declines a pending proposal, returning the committed principal. */
export function declineInvestment(
  state: GameState,
  proposalId: number,
): boolean {
  const index = state.proposals.findIndex((p) => p.id === proposalId);
  if (index < 0) return false;
  const proposal = state.proposals[index];
  state.proposals.splice(index, 1);
  state.players[proposal.from].resources.money += proposal.principal;
  if (proposal.to === 0) {
    pushEvent(state, "info", "Investment proposal declined.");
  }
  return true;
}

/** Cancels an active contract, returning the unpaid principal to the investor. */
export function cancelInvestment(
  state: GameState,
  contractId: number,
): boolean {
  const index = state.contracts.findIndex((c) => c.id === contractId);
  if (index < 0) return false;
  const contract = state.contracts[index];
  state.contracts.splice(index, 1);
  state.players[contract.from].resources.money += contract.principal;
  return true;
}

/** Pending proposals addressed to a player. */
export function proposalsFor(
  state: GameState,
  owner: PlayerId,
): InvestmentProposal[] {
  return state.proposals.filter((p) => p.to === owner);
}

/** Active contracts a player is party to, as investor or recipient. */
export function contractsFor(
  state: GameState,
  owner: PlayerId,
): InvestmentContract[] {
  return state.contracts.filter((c) => c.from === owner || c.to === owner);
}

/**
 * Advances every active contract, paying interest on its interval. The
 * recipient pays the investor `principal * rate` each interval until the
 * agreed number of payouts is exhausted.
 */
function updateContracts(state: GameState, dt: number): void {
  if (state.contracts.length === 0 && state.proposals.length === 0) return;

  // Lapse stale proposals and return the committed principal.
  for (let i = state.proposals.length - 1; i >= 0; i -= 1) {
    const proposal = state.proposals[i];
    if (state.elapsed - proposal.created < INVESTMENT_PROPOSAL_TTL_SECONDS) {
      continue;
    }
    state.proposals.splice(i, 1);
    state.players[proposal.from].resources.money += proposal.principal;
  }

  for (let i = state.contracts.length - 1; i >= 0; i -= 1) {
    const contract = state.contracts[i];
    contract.timer += dt;
    if (contract.timer < contract.intervalSeconds) continue;
    contract.timer -= contract.intervalSeconds;
    const payout = Math.round(contract.principal * contract.rate);
    const payer = state.players[contract.to];
    const investor = state.players[contract.from];
    const paid = Math.min(payout, Math.floor(payer.resources.money));
    payer.resources.money -= paid;
    investor.resources.money += paid;
    contract.remainingPayments -= 1;
    if (contract.from === 0 || contract.to === 0) {
      pushEvent(
        state,
        "info",
        `Investment payout: ${paid} Money to ${playerLabel(state, contract.from)}.`,
      );
    }
    if (contract.remainingPayments <= 0) {
      state.contracts.splice(i, 1);
    }
  }
}

function playerLabel(_state: GameState, owner: PlayerId): string {
  return owner === 0 ? "you" : "the rival host";
}

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------

/** Whether a player has already researched an upgrade. */
export function hasUpgrade(
  state: GameState,
  owner: PlayerId,
  upgrade: UpgradeKind,
): boolean {
  return state.players[owner].upgrades.includes(upgrade);
}

/**
 * Purchases an upgrade at a completed Blacksmith, Fortress, or Market. Returns
 * false when the building cannot research it, the age is too low, it is
 * already researched, or the player cannot afford it.
 */
export function researchUpgrade(
  state: GameState,
  owner: PlayerId,
  buildingId: number,
  upgrade: UpgradeKind,
): boolean {
  const building = buildingAt(state, buildingId);
  if (!building || building.owner !== owner || building.cancelled) return false;
  if (building.progress < 1) return false;
  const definition = UPGRADES[upgrade];
  if (!definition) return false;
  if (!definition.buildings.includes(building.kind)) return false;
  const player = state.players[owner];
  if (player.age < definition.minAge) return false;
  if (player.upgrades.includes(upgrade)) return false;
  if (!canAfford(player.resources, definition.cost)) return false;
  pay(player.resources, definition.cost);
  player.upgrades.push(upgrade);
  if (definition.sharesVision) {
    player.sharesVision = true;
    // Vision is mutual: every ally of the researcher gains it too.
    for (const other of state.players) {
      if (other.id !== owner && areAllies(state, owner, other.id)) {
        other.sharesVision = true;
      }
    }
    recomputeFog(state);
  }
  if (owner === 0) {
    pushEvent(state, "info", `${definition.name} researched.`);
  }
  return true;
}

/** Upgrades a given building can currently offer, with affordability. */
export function availableUpgrades(
  state: GameState,
  owner: PlayerId,
  building: Building,
): Array<{
  definition: (typeof UPGRADES)[UpgradeKind];
  researched: boolean;
  affordable: boolean;
  ageOk: boolean;
}> {
  const player = state.players[owner];
  return (Object.keys(UPGRADES) as UpgradeKind[])
    .map((id) => UPGRADES[id])
    .filter((definition) => definition.buildings.includes(building.kind))
    .map((definition) => ({
      definition,
      researched: player.upgrades.includes(definition.id),
      affordable: canAfford(player.resources, definition.cost),
      ageOk: player.age >= definition.minAge,
    }));
}

// ---------------------------------------------------------------------------
// Public command API
// ---------------------------------------------------------------------------

export function issueMove(
  state: GameState,
  unitIds: readonly number[],
  target: Vec2,
  queued: boolean,
): void {
  const blocked = blockedTiles(state);
  const units = unitIds
    .map((id) => unitAt(state, id))
    .filter((u): u is Unit => u !== null && u.owner === 0);
  units.forEach((unit, index) => {
    const dest = spreadDestination(
      target,
      index,
      units.length,
      state.map,
      blocked,
    );
    const order: Order = { type: "move", x: dest.x, y: dest.y };
    if (queued) unit.orders.push(order);
    else unit.orders = [order];
    unit.targetId = null;
    unit.gatherNodeId = null;
    unit.workBuildingId = null;
  });
  pushMarker(state, "move", target.x, target.y);
}

export function issueAttackMove(
  state: GameState,
  unitIds: readonly number[],
  target: Vec2,
  queued: boolean,
): void {
  const blocked = blockedTiles(state);
  const units = unitIds
    .map((id) => unitAt(state, id))
    .filter((u): u is Unit => u !== null && u.owner === 0);
  units.forEach((unit, index) => {
    const dest = spreadDestination(
      target,
      index,
      units.length,
      state.map,
      blocked,
    );
    const order: Order = { type: "attackMove", x: dest.x, y: dest.y };
    if (queued) unit.orders.push(order);
    else unit.orders = [order];
    unit.targetId = null;
    unit.gatherNodeId = null;
    unit.workBuildingId = null;
  });
  pushMarker(state, "attack", target.x, target.y);
}

export function issueAttack(
  state: GameState,
  unitIds: readonly number[],
  targetId: number,
  queued: boolean,
): void {
  for (const id of unitIds) {
    const unit = unitAt(state, id);
    if (!unit || unit.owner !== 0) continue;
    const order: Order = { type: "attack", targetId };
    if (queued) unit.orders.push(order);
    else unit.orders = [order];
    unit.targetId = targetId;
    unit.gatherNodeId = null;
    unit.workBuildingId = null;
  }
  const target = unitAt(state, targetId) ?? buildingAt(state, targetId);
  if (target) {
    const pos =
      "size" in target ? buildingCenter(target) : { x: target.x, y: target.y };
    pushMarker(state, "attack", pos.x, pos.y);
  }
}

export function issueGather(
  state: GameState,
  unitIds: readonly number[],
  nodeId: number,
  queued: boolean,
): void {
  const node = nodeAt(state, nodeId);
  if (!node) return;
  for (const id of unitIds) {
    const unit = unitAt(state, id);
    if (!unit || unit.owner !== 0 || !UNIT_STATS[unit.kind].gatherer) continue;
    if (node.kind === "farm" && !farmBelongsTo(state, node, unit.owner))
      continue;
    const order: Order = { type: "gather", nodeId };
    if (queued) unit.orders.push(order);
    else unit.orders = [order];
    unit.gatherNodeId = nodeId;
    unit.targetId = null;
    unit.workBuildingId = null;
  }
  pushMarker(state, "gather", node.x, node.y);
}

export function issueBuild(
  state: GameState,
  unitIds: readonly number[],
  buildingId: number,
  queued: boolean,
): void {
  for (const id of unitIds) {
    const unit = unitAt(state, id);
    if (!unit || unit.owner !== 0 || !UNIT_STATS[unit.kind].builder) continue;
    const order: Order = { type: "build", buildingId };
    if (queued) unit.orders.push(order);
    else unit.orders = [order];
    unit.workBuildingId = buildingId;
    unit.targetId = null;
    unit.gatherNodeId = null;
  }
}

export function issueRepair(
  state: GameState,
  unitIds: readonly number[],
  buildingId: number,
  queued: boolean,
): void {
  for (const id of unitIds) {
    const unit = unitAt(state, id);
    if (!unit || unit.owner !== 0 || !UNIT_STATS[unit.kind].repairer) continue;
    const order: Order = { type: "repair", buildingId };
    if (queued) unit.orders.push(order);
    else unit.orders = [order];
    unit.workBuildingId = buildingId;
    unit.targetId = null;
    unit.gatherNodeId = null;
  }
}

export function issueStop(state: GameState, unitIds: readonly number[]): void {
  for (const id of unitIds) {
    const unit = unitAt(state, id);
    if (!unit || unit.owner !== 0) continue;
    unit.orders = [];
    unit.path = [];
    unit.targetId = null;
    unit.gatherNodeId = null;
    unit.workBuildingId = null;
    unit.moving = false;
  }
}

export function setStance(
  state: GameState,
  unitIds: readonly number[],
  stance: Stance,
): void {
  for (const id of unitIds) {
    const unit = unitAt(state, id);
    if (unit && unit.owner === 0) unit.stance = stance;
  }
}

export function setControlGroup(
  state: GameState,
  group: number,
  unitIds: readonly number[],
): void {
  state.controlGroups[group] = [...unitIds];
}

export function getControlGroup(state: GameState, group: number): number[] {
  return state.controlGroups[group] ?? [];
}

/** Places a building foundation and orders the given villagers to build it. */
export function placeBuilding(
  state: GameState,
  owner: PlayerId,
  kind: BuildingKind,
  tx: number,
  ty: number,
  builderIds: readonly number[],
): Building | null {
  const stats = BUILDING_STATS[kind];
  if (state.players[owner].age < stats.minAge) return null;
  if (!isBuildable(state.map, tx, ty, stats.size)) return null;
  const blocked = blockedTilesForOwner(state, owner);
  for (let y = ty; y < ty + stats.size; y += 1) {
    for (let x = tx; x < tx + stats.size; x += 1) {
      if (blocked.has(`${x},${y}`)) return null;
    }
  }
  const cost = buildingCost(kind, state.players[owner].faction);
  if (!canAfford(state.players[owner].resources, cost)) return null;
  pay(state.players[owner].resources, cost);
  const building = addBuilding(state, owner, kind, tx, ty, false);
  if (owner === 0) {
    issueBuild(state, builderIds, building.id, false);
    pushMarker(state, "build", tx + stats.size / 2, ty + stats.size / 2);
  }
  return building;
}

export function cancelBuilding(state: GameState, buildingId: number): void {
  const building = buildingAt(state, buildingId);
  if (!building || building.progress >= 1) return;
  building.cancelled = true;
  refund(
    state.players[building.owner].resources,
    buildingCost(building.kind, state.players[building.owner].faction),
  );
  for (const unit of state.units) {
    if (unit.workBuildingId === buildingId) {
      unit.workBuildingId = null;
      unit.orders = unit.orders.filter(
        (o) => o.type !== "build" || o.buildingId !== buildingId,
      );
    }
  }
  state.buildings = state.buildings.filter((b) => b.id !== buildingId);
}

export function enqueueUnit(
  state: GameState,
  buildingId: number,
  kind: UnitKind,
): boolean {
  const building = buildingAt(state, buildingId);
  if (!building || building.cancelled || building.progress < 1) return false;
  const stats = BUILDING_STATS[building.kind];
  if (!stats.trains.includes(kind)) return false;
  const player = state.players[building.owner];
  // Faction elites are exclusive to their faction's Fortress.
  if (isFactionElite(kind) && factionEliteKind(player.faction) !== kind) {
    return false;
  }
  if (player.age < UNIT_STATS[kind].minAge) return false;
  if (building.queue.length >= 8) return false;
  const cost = unitCost(kind, player.faction);
  if (!canAfford(player.resources, cost)) return false;
  pay(player.resources, cost);
  building.queue.push(kind);
  return true;
}

export function cancelQueueItem(state: GameState, buildingId: number): void {
  const building = buildingAt(state, buildingId);
  if (!building || building.queue.length === 0) return;
  const kind = building.queue.pop();
  if (!kind) return;
  refund(
    state.players[building.owner].resources,
    unitCost(kind, state.players[building.owner].faction),
  );
}

export function advanceAge(state: GameState, owner: PlayerId): boolean {
  const player = state.players[owner];
  if (player.advancing || player.age >= 4) return false;
  const next = (player.age + 1) as Exclude<Age, 1>;
  const cost = AGE_COSTS[next];
  if (!canAfford(player.resources, cost)) return false;
  pay(player.resources, cost);
  player.advancing = true;
  player.ageProgress = 0;
  if (owner === 0) {
    pushEvent(
      state,
      "age",
      `Advancing to ${next === 2 ? "the Age of Iron" : next === 3 ? "the Age of Powder" : "the Age of Empire"}…`,
    );
  }
  return true;
}

export function setRallyPoint(
  state: GameState,
  buildingId: number,
  target: Vec2,
): void {
  const building = buildingAt(state, buildingId);
  if (building && building.owner === 0) building.rally = target;
}

// ---------------------------------------------------------------------------
// Performance auto-scaling
// ---------------------------------------------------------------------------

/**
 * Lowers the client's render detail tier. Returns the new tier, or null when
 * the client is already at the lowest tier.
 */
export function lowerRenderDetail(state: GameState): RenderDetail | null {
  if (state.renderDetail === "high") {
    state.renderDetail = "medium";
    return state.renderDetail;
  }
  if (state.renderDetail === "medium") {
    state.renderDetail = "low";
    return state.renderDetail;
  }
  return null;
}

/** Sets the render detail tier explicitly. */
export function setRenderDetail(state: GameState, detail: RenderDetail): void {
  state.renderDetail = detail;
}

/**
 * Lowers the global population ceiling for every player synchronously. The
 * reduction is surfaced through the returned event so the UI can tell the
 * player what happened.
 */
export function lowerGlobalPopulationCap(state: GameState): GameEvent | null {
  const nextPenalty = state.populationPenalty + PERF_POPULATION_STEP;
  const lowestLimit = Math.min(...state.players.map((p) => p.populationLimit));
  if (lowestLimit - nextPenalty < PERF_MIN_POPULATION) return null;
  state.populationPenalty = nextPenalty;
  state.populationLowered = true;
  const message = `High system load: global population cap reduced to ${lowestLimit - nextPenalty} per player.`;
  pushEvent(state, "info", message);
  const event = state.events[state.events.length - 1] ?? null;
  return event;
}

/** The effective global population ceiling after auto-scaling. */
export function globalPopulationCap(state: GameState): number {
  const lowestLimit = Math.min(...state.players.map((p) => p.populationLimit));
  return Math.max(PERF_MIN_POPULATION, lowestLimit - state.populationPenalty);
}

// ---------------------------------------------------------------------------
// Simulation step
// ---------------------------------------------------------------------------

/** Advances the simulation by exactly one fixed timestep. */
export function step(state: GameState): void {
  if (state.finished) return;
  const dt = TICK_SECONDS;
  state.elapsed += dt;

  updatePlayers(state, dt);
  updateBuildings(state, dt);
  updateFarms(state, dt);
  updateThermalPlants(state, dt);
  updateHospitals(state, dt);
  updateContracts(state, dt);
  updateUnits(state, dt);
  updateMarkers(state, dt);
  updateEvents(state, dt);
  updateAi(state, dt);
  updateFog(state, dt);
  checkVictory(state);
}

function updatePlayers(state: GameState, dt: number): void {
  for (const player of state.players) {
    if (player.advancing) {
      const next = (player.age + 1) as Exclude<Age, 1>;
      player.ageProgress += dt;
      if (player.ageProgress >= AGE_TIMES[next]) {
        player.age = next;
        player.advancing = false;
        player.ageProgress = 0;
        if (player.id === 0) {
          pushEvent(
            state,
            "age",
            `You have entered the Age of ${next === 2 ? "Iron" : next === 3 ? "Powder" : "Empire"}.`,
          );
        }
      }
    }

    // Market taxation and energy generation.
    let moneyRate = 0;
    let energyRate = 0;
    for (const b of state.buildings) {
      if (b.owner !== player.id || b.cancelled || b.progress < 1) continue;
      if (BUILDING_STATS[b.kind].generatesMoney) moneyRate += MARKET_MONEY_RATE;
      energyRate += buildingEnergyOutput(b);
    }
    player.resources.money += moneyRate * dt;
    player.resources.energy += energyRate * dt;

    // Energy upkeep drains the pool; a deficit is reflected in the HUD.
    const upkeep = energyUpkeep(state, player.id);
    if (upkeep > 0) {
      player.resources.energy = Math.max(
        0,
        player.resources.energy - upkeep * dt * 0.1,
      );
    }

    updateGatherRates(player, dt);
  }
}

/**
 * Maintains a rolling window of delivered resources and derives the
 * per-minute gather rate the HUD displays.
 */
function updateGatherRates(player: PlayerState, dt: number): void {
  player.gatherSampleTimer += dt;
  if (player.gatherSampleTimer >= GATHER_SAMPLE_SECONDS) {
    const seconds = player.gatherSampleTimer;
    player.gatherSampleTimer = 0;
    player.gatherWindow.push({ seconds, amounts: emptyPool() });
    if (player.gatherWindow.length > GATHER_WINDOW_BUCKETS) {
      player.gatherWindow.shift();
    }
  }

  let totalSeconds = 0;
  const totals = emptyPool();
  for (const sample of player.gatherWindow) {
    totalSeconds += sample.seconds;
    for (const key of RESOURCE_KEYS) totals[key] += sample.amounts[key];
  }
  if (totalSeconds <= 0) {
    player.gatherRates = emptyPool();
    return;
  }
  for (const key of RESOURCE_KEYS) {
    player.gatherRates[key] = (totals[key] / totalSeconds) * 60;
  }
}

/** Records resources delivered into the rolling gather-rate window. */
function recordGathered(
  player: PlayerState,
  kind: ResourceKind,
  amount: number,
): void {
  // The first delivery can arrive before the sampler has opened a bucket, so
  // create one on demand rather than dropping the amount.
  let bucket = player.gatherWindow[player.gatherWindow.length - 1];
  if (!bucket) {
    bucket = { seconds: 0, amounts: emptyPool() };
    player.gatherWindow.push(bucket);
  }
  bucket.amounts[kind] += amount;
}

function updateBuildings(state: GameState, dt: number): void {
  for (const building of state.buildings) {
    if (building.cancelled) continue;
    if (building.hitFlash > 0)
      building.hitFlash = Math.max(0, building.hitFlash - dt);

    // Construction progress is driven by assigned builders.
    if (building.progress < 1) {
      const builders = state.units.filter(
        (u) => u.workBuildingId === building.id && u.owner === building.owner,
      );
      if (builders.length > 0) {
        const stats = BUILDING_STATS[building.kind];
        const rate = builders.length / stats.buildTime;
        building.progress = Math.min(1, building.progress + rate * dt);
        building.health = Math.min(
          building.maxHealth,
          building.maxHealth * (0.1 + 0.9 * building.progress),
        );
        if (building.progress >= 1) {
          building.health = building.maxHealth;
          if (building.owner === 0) {
            pushEvent(
              state,
              "construction",
              `${buildingLabel(building.kind)} completed.`,
            );
          }
          for (const unit of builders) {
            unit.workBuildingId = null;
            unit.orders = unit.orders.filter(
              (o) => o.type !== "build" || o.buildingId !== building.id,
            );
          }
        }
      }
      continue;
    }

    // Training queue. An energy deficit halves production speed.
    if (building.queue.length > 0) {
      const kind = building.queue[0];
      const stats = UNIT_STATS[kind];
      building.queueTimer += dt * productionMultiplier(state, building);
      if (building.queueTimer >= stats.trainTime) {
        building.queueTimer = 0;
        building.queue.shift();
        const spawn = spawnPointFor(state, building);
        const unit = addUnit(state, building.owner, kind, spawn.x, spawn.y);
        if (building.rally) {
          unit.orders = [
            { type: "move", x: building.rally.x, y: building.rally.y },
          ];
        }
        if (building.owner === 0) {
          pushEvent(state, "train", `${unitLabel(kind)} trained.`);
        }
      }
    } else {
      building.queueTimer = 0;
    }

    // Defensive structures auto-attack.
    const stats = BUILDING_STATS[building.kind];
    if (stats.attack > 0) {
      const power = powerModifiers(state, building.owner, stats.energyConsumer);
      const structurePowered = isStructurePowered(state, building);
      building.attackCooldown = Math.max(0, building.attackCooldown - dt);
      if (building.attackCooldown <= 0 && power.canFire && structurePowered) {
        const center = buildingCenter(building);
        let best: Unit | null = null;
        let bestDist = stats.range;
        for (const u of state.units) {
          if (u.health <= 0) continue;
          if (!isEnemy(state, building.owner, u.owner)) continue;
          const d = Math.hypot(u.x - center.x, u.y - center.y);
          if (d < bestDist) {
            bestDist = d;
            best = u;
          }
        }
        if (best) {
          applyDamage(state, best, stats.attack * power.damage, building.owner);
          building.attackCooldown = stats.attackInterval * power.interval;
        }
      }
    }
  }
}

function spawnPointFor(state: GameState, building: Building): Vec2 {
  const center = buildingCenter(building);
  const blocked = blockedTilesForOwner(state, building.owner);
  for (let r = 1; r <= 4; r += 1) {
    for (let a = 0; a < 8; a += 1) {
      const angle = (a / 8) * Math.PI * 2;
      const x = center.x + Math.cos(angle) * (building.size / 2 + r);
      const y = center.y + Math.sin(angle) * (building.size / 2 + r);
      const tile = tileAt(state.map, Math.floor(x), Math.floor(y));
      if (tile?.walkable && !blocked.has(tileKey(x, y))) return { x, y };
    }
  }
  return center;
}

function updateUnits(state: GameState, dt: number): void {
  const blocked = blockedTiles(state);
  // Energy deficit is resolved per owner so the penalty applies to every
  // player in the match, not just owners 0 and 1.
  const deficit = new Map<PlayerId, boolean>();
  const deficitFor = (owner: PlayerId): boolean => {
    let value = deficit.get(owner);
    if (value === undefined) {
      value = energyDeficit(state, owner);
      deficit.set(owner, value);
    }
    return value;
  };

  for (const unit of state.units) {
    if (unit.health <= 0) continue;
    if (unit.hitFlash > 0) unit.hitFlash = Math.max(0, unit.hitFlash - dt);
    unit.attackCooldown = Math.max(0, unit.attackCooldown - dt);

    const stats = unitStatsFor(state, unit);
    const speedMult =
      deficitFor(unit.owner) && isEnergyWeaponUnit(unit.kind) ? 0.55 : 1;
    const power = powerModifiers(
      state,
      unit.owner,
      isEnergyWeaponUnit(unit.kind),
    );

    // Resolve the active order.
    const order = unit.orders[0];
    if (!order) {
      unit.moving = false;
      autoAcquire(state, unit, power);
      continue;
    }

    switch (order.type) {
      case "move":
      case "attackMove": {
        const arrived = moveToward(
          state,
          unit,
          order.x,
          order.y,
          stats.speed * speedMult,
          dt,
          blocked,
        );
        if (order.type === "attackMove") {
          const enemy = nearestEnemy(state, unit, stats.range + 1.5);
          if (enemy) {
            engage(state, unit, enemy, stats, dt, power);
            break;
          }
        }
        if (arrived) unit.orders.shift();
        break;
      }
      case "attack": {
        const target =
          unitAt(state, order.targetId) ?? buildingAt(state, order.targetId);
        if (!target || ("health" in target && target.health <= 0)) {
          unit.orders.shift();
          unit.targetId = null;
          break;
        }
        const pos =
          "size" in target
            ? buildingCenter(target)
            : { x: target.x, y: target.y };
        const dist =
          "size" in target
            ? distanceToBuilding(unit, target)
            : Math.hypot(target.x - unit.x, target.y - unit.y);
        if (dist > stats.range) {
          moveToward(
            state,
            unit,
            pos.x,
            pos.y,
            stats.speed * speedMult,
            dt,
            blocked,
          );
        } else {
          unit.moving = false;
          unit.path = [];
          if (unit.attackCooldown <= 0 && power.canFire) {
            const damage = stats.attack * power.damage;
            if ("size" in target) {
              applyDamageToBuilding(state, target, damage, unit.owner);
            } else {
              applyDamage(state, target, damage, unit.owner);
            }
            unit.attackCooldown = stats.attackInterval * power.interval;
          }
        }
        break;
      }
      case "gather": {
        const node = nodeAt(state, order.nodeId);
        if (!node || node.depleted) {
          const replacement = nearestNode(state, unit, [
            "tree",
            "gold",
            "stone",
            "forage",
            "animal",
            "farm",
          ]);
          if (replacement) {
            unit.orders[0] = { type: "gather", nodeId: replacement.id };
            unit.gatherNodeId = replacement.id;
          } else {
            unit.orders.shift();
            unit.gatherNodeId = null;
          }
          break;
        }
        // A full load is delivered before anything else, regardless of how far
        // the villager currently is from the resource node. Otherwise a loaded
        // villager walking to the drop-off would be pulled back to the node as
        // soon as it moved more than 1.1 units away, oscillating forever.
        if (unit.carrying >= CARRY_CAPACITY) {
          const dropOff = nearestDropOff(state, unit);
          if (dropOff) {
            const c = buildingCenter(dropOff);
            const d = distanceToBuilding(unit, dropOff);
            if (d > 1.2) {
              moveToward(
                state,
                unit,
                c.x,
                c.y,
                stats.speed * speedMult,
                dt,
                blocked,
              );
            } else {
              unit.moving = false;
              unit.path = [];
              depositResources(state, unit);
            }
          } else {
            unit.moving = false;
            unit.path = [];
            depositResources(state, unit);
          }
          break;
        }
        const dist = Math.hypot(node.x - unit.x, node.y - unit.y);
        if (dist > 1.1) {
          moveToward(
            state,
            unit,
            node.x,
            node.y,
            stats.speed * speedMult,
            dt,
            blocked,
          );
        } else {
          unit.moving = false;
          unit.path = [];
          unit.facing = Math.atan2(node.y - unit.y, node.x - unit.x);
          const rate = GATHER_RATES[node.kind] ?? 0.5;
          const factionMult =
            FACTIONS[state.players[unit.owner].faction].gatherMultiplier;
          const difficultyMult =
            unit.owner === 0
              ? 1
              : (state.aiGatherMults[unit.owner] ?? state.aiGatherMult);
          const amount = Math.min(
            rate * factionMult * difficultyMult * dt,
            node.amount,
            CARRY_CAPACITY - unit.carrying,
          );
          node.amount -= amount;
          unit.carrying += amount;
          unit.carryingKind = nodeKindToResource(node.kind);
          if (node.amount <= 0) {
            node.depleted = true;
            node.amount = 0;
          }
        }
        break;
      }
      case "build":
      case "repair": {
        const building = buildingAt(state, order.buildingId);
        if (!building || building.cancelled) {
          unit.orders.shift();
          unit.workBuildingId = null;
          break;
        }
        const c = buildingCenter(building);
        const d = distanceToBuilding(unit, building);
        if (d > 1.4) {
          moveToward(
            state,
            unit,
            c.x,
            c.y,
            stats.speed * speedMult,
            dt,
            blocked,
          );
        } else {
          unit.moving = false;
          unit.path = [];
          if (
            order.type === "repair" &&
            building.progress >= 1 &&
            building.health < building.maxHealth
          ) {
            building.health = Math.min(
              building.maxHealth,
              building.health + 8 * dt,
            );
            if (building.health >= building.maxHealth) {
              unit.orders.shift();
              unit.workBuildingId = null;
            }
          }
        }
        break;
      }
      case "stop": {
        unit.orders.shift();
        unit.moving = false;
        break;
      }
    }
  }

  // Remove dead units.
  const dead = state.units.filter((u) => u.health <= 0);
  if (dead.length > 0) {
    for (const unit of dead) {
      if (unit.owner === 0) {
        pushEvent(state, "destroy", `${unitLabel(unit.kind)} lost.`);
      }
    }
    state.units = state.units.filter((u) => u.health > 0);
  }

  // Remove destroyed buildings.
  const destroyed = state.buildings.filter(
    (b) => b.health <= 0 && !b.cancelled,
  );
  if (destroyed.length > 0) {
    for (const b of destroyed) {
      if (b.owner === 0) {
        pushEvent(state, "destroy", `${buildingLabel(b.kind)} destroyed.`);
      }
    }
    state.buildings = state.buildings.filter(
      (b) => b.health > 0 || b.cancelled,
    );
  }
}

function depositResources(state: GameState, unit: Unit): void {
  if (unit.carryingKind && unit.carrying > 0) {
    const player = state.players[unit.owner];
    player.resources[unit.carryingKind] += unit.carrying;
    recordGathered(player, unit.carryingKind, unit.carrying);
    unit.carrying = 0;
    unit.carryingKind = null;
  }
}

function nodeKindToResource(kind: NodeKind): ResourceKind {
  switch (kind) {
    case "tree":
      return "wood";
    case "gold":
      return "gold";
    case "stone":
      return "stone";
    case "forage":
    case "animal":
    case "farm":
      return "food";
  }
}

/**
 * Moves a unit toward a target.
 *
 * Group orders use a cached flow field: one integration field serves every
 * unit heading to the same destination, so a 200-unit order costs one field
 * build instead of 200 A* searches. Single units, and goals the field cannot
 * reach, fall back to per-unit A*.
 */
function moveToward(
  state: GameState,
  unit: Unit,
  targetX: number,
  targetY: number,
  speed: number,
  dt: number,
  blocked: ReadonlySet<string>,
): boolean {
  const dx = targetX - unit.x;
  const dy = targetY - unit.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.35) {
    unit.moving = false;
    unit.path = [];
    return true;
  }

  const goalTx = Math.floor(targetX);
  const goalTy = Math.floor(targetY);
  const field = getFlowField(
    state.flowCache,
    state.map,
    goalTx,
    goalTy,
    blocked,
  );
  const flowStep = stepAlongFlow(field, unit.x, unit.y, speed, dt);
  if (flowStep.arrived) {
    unit.moving = false;
    unit.path = [];
    return true;
  }
  // The field only helps when it actually points somewhere.
  const flowUsable = flowStep.x !== unit.x || flowStep.y !== unit.y;

  if (flowUsable) {
    unit.facing = Math.atan2(flowStep.y - unit.y, flowStep.x - unit.x);
    unit.x = flowStep.x;
    unit.y = flowStep.y;
    unit.moving = true;
    unit.path = [];
    return false;
  }

  // Fallback: per-unit A* for single units and unreachable goals.
  if (unit.path.length === 0) {
    unit.path = findPath(
      state.map,
      { x: unit.x, y: unit.y },
      { x: targetX, y: targetY },
      blocked,
    );
  }

  let waypoint: Vec2 | null = unit.path[0] ?? null;
  if (waypoint && Math.hypot(waypoint.x - unit.x, waypoint.y - unit.y) < 0.4) {
    unit.path.shift();
    waypoint = unit.path[0] ?? null;
  }
  if (!waypoint) {
    // Direct fallback when no path was found.
    waypoint = { x: targetX, y: targetY };
  }

  const step = speed * dt;
  const wdx = waypoint.x - unit.x;
  const wdy = waypoint.y - unit.y;
  const wdist = Math.hypot(wdx, wdy) || 1;
  const move = Math.min(step, wdist);
  unit.x += (wdx / wdist) * move;
  unit.y += (wdy / wdist) * move;
  unit.facing = Math.atan2(wdy, wdx);
  unit.moving = true;
  return false;
}

function autoAcquire(
  state: GameState,
  unit: Unit,
  power: { damage: number; interval: number; canFire: boolean },
): void {
  if (unit.stance === "noAttack" || unit.stance === "standGround") return;
  if (!power.canFire) return;
  const stats = unitStatsFor(state, unit);
  const enemy = nearestEnemy(state, unit, stats.range + 0.5);
  if (!enemy) return;
  if (unit.attackCooldown > 0) return;
  const damage = stats.attack * power.damage;
  if (enemy.kind === "unit") {
    applyDamage(state, enemy.unit, damage, unit.owner);
  } else {
    applyDamageToBuilding(state, enemy.building, damage, unit.owner);
  }
  unit.attackCooldown = stats.attackInterval * power.interval;
}

function engage(
  state: GameState,
  unit: Unit,
  enemy:
    | { kind: "unit"; unit: Unit }
    | { kind: "building"; building: Building },
  stats: { attack: number; range: number; attackInterval: number },
  dt: number,
  power: { damage: number; interval: number; canFire: boolean },
): void {
  const blocked = blockedTiles(state);
  const pos =
    enemy.kind === "unit"
      ? { x: enemy.unit.x, y: enemy.unit.y }
      : buildingCenter(enemy.building);
  const dist =
    enemy.kind === "unit"
      ? Math.hypot(pos.x - unit.x, pos.y - unit.y)
      : distanceToBuilding(unit, enemy.building);
  if (dist > stats.range) {
    moveToward(
      state,
      unit,
      pos.x,
      pos.y,
      UNIT_STATS[unit.kind].speed,
      dt,
      blocked,
    );
    return;
  }
  unit.moving = false;
  unit.path = [];
  if (unit.attackCooldown <= 0 && power.canFire) {
    const damage = stats.attack * power.damage;
    if (enemy.kind === "unit") {
      applyDamage(state, enemy.unit, damage, unit.owner);
    } else {
      applyDamageToBuilding(state, enemy.building, damage, unit.owner);
    }
    unit.attackCooldown = stats.attackInterval * power.interval;
  }
}

function applyDamage(
  state: GameState,
  target: Unit,
  amount: number,
  attacker: PlayerId,
): void {
  const stats = UNIT_STATS[target.kind];
  const damage = Math.max(1, amount - stats.armor);
  target.health -= damage;
  target.hitFlash = 0.28;
  if (target.health <= 0) {
    target.health = 0;
    awardXp(state, attacker, 12);
  }
}

function applyDamageToBuilding(
  state: GameState,
  target: Building,
  amount: number,
  attacker: PlayerId,
): void {
  target.health -= amount;
  target.hitFlash = 0.28;
  if (target.health <= 0) {
    target.health = 0;
    awardXp(state, attacker, 20);
  }
}

function awardXp(state: GameState, owner: PlayerId, amount: number): void {
  const candidates = state.units.filter(
    (u) => u.owner === owner && u.rank < 3 && u.health > 0,
  );
  if (candidates.length === 0) return;
  const unit = candidates[Math.floor(Math.random() * candidates.length)];
  unit.xp += amount;
  while (unit.rank < 3 && unit.xp >= RANK_XP[unit.rank + 1]) {
    unit.rank += 1;
    const base = UNIT_STATS[unit.kind];
    const faction = state.players[unit.owner].faction;
    unit.maxHealth = Math.round(
      base.maxHealth *
        FACTIONS[faction].unitHealthMultiplier *
        RANK_HEALTH_MULT[unit.rank],
    );
    unit.health = unit.maxHealth;
  }
}

function updateMarkers(state: GameState, dt: number): void {
  for (const marker of state.markers) marker.ttl -= dt;
  state.markers = state.markers.filter((m) => m.ttl > 0);
}

function updateEvents(state: GameState, dt: number): void {
  for (const event of state.events) event.ttl -= dt;
  state.events = state.events.filter((e) => e.ttl > 0);
}

function updateFog(state: GameState, dt: number): void {
  state.fogTimer += dt;
  if (state.fogTimer < 0.25) return;
  state.fogTimer = 0;
  recomputeFog(state);
}

/**
 * Recomputes player 0's fog-of-war visibility grid.
 *
 * Vision is private until the player researches Economic Partners. Once the
 * charter is signed, allied units and buildings reveal ground for player 0 too.
 */
export function recomputeFog(state: GameState): void {
  const { width, height } = state.map;
  // Downgrade currently-visible tiles to explored.
  for (let i = 0; i < state.fog.length; i += 1) {
    if (state.fog[i] === 2) state.fog[i] = 1;
  }
  const reveal = (cx: number, cy: number, radius: number): void => {
    const r = Math.ceil(radius);
    const minX = Math.max(0, cx - r);
    const maxX = Math.min(width - 1, cx + r);
    const minY = Math.max(0, cy - r);
    const maxY = Math.min(height - 1, cy + r);
    for (let y = minY; y <= maxY; y += 1) {
      const dy = y - cy;
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x - cx;
        if (dx * dx + dy * dy > radius * radius) continue;
        state.fog[y * width + x] = 2;
      }
    }
  };
  for (const unit of state.units) {
    if (!sharesVision(state, 0, unit.owner)) continue;
    reveal(Math.floor(unit.x), Math.floor(unit.y), 7);
  }
  for (const building of state.buildings) {
    if (building.cancelled) continue;
    if (!sharesVision(state, 0, building.owner)) continue;
    const c = buildingCenter(building);
    reveal(Math.floor(c.x), Math.floor(c.y), 8 + building.size);
  }
}

function checkVictory(state: GameState): void {
  for (const player of state.players) {
    if (player.defeated) continue;
    const hasProduction = state.buildings.some(
      (b) =>
        b.owner === player.id &&
        !b.cancelled &&
        b.health > 0 &&
        BUILDING_STATS[b.kind].production,
    );
    if (!hasProduction) {
      player.defeated = true;
      const winner: PlayerId = player.id === 0 ? 1 : 0;
      state.finished = true;
      state.outcome = {
        result: winner === 0 ? MatchResult.victory : MatchResult.defeat,
        durationSeconds: Math.round(state.elapsed),
      };
      pushEvent(
        state,
        "info",
        winner === 0
          ? "Victory — the enemy host is broken."
          : "Defeat — your base has fallen.",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// AI opponent
// ---------------------------------------------------------------------------

function updateAi(state: GameState, dt: number): void {
  // Each AI slot runs its own difficulty; fall back to the match-wide
  // difficulty when a slot has no explicit one.
  const aiDifficulties = state.players.map((_player, index) => {
    if (index === 0) return state.config.difficulty;
    return (
      state.config.aiPlayers?.[index - 1]?.difficulty ?? state.config.difficulty
    );
  });

  for (const player of state.players) {
    if (player.id === 0 || player.defeated) continue;
    const tuning = AI_TUNING[aiDifficulties[player.id]] ?? AI_TUNING.normal;

    state.aiTimers[player.id] = (state.aiTimers[player.id] ?? 0) + dt;
    state.aiWaveTimers[player.id] = (state.aiWaveTimers[player.id] ?? 0) + dt;

    if (state.aiTimers[player.id] >= tuning.buildDelay) {
      state.aiTimers[player.id] = 0;
      aiEconomy(state, player.id, tuning.gatherMult);
      aiMilitary(state, player.id, tuning.armyTarget);
    }

    if (state.aiWaveTimers[player.id] >= tuning.attackWaveSeconds) {
      state.aiWaveTimers[player.id] = 0;
      aiAttackWave(state, player.id, tuning.armyTarget);
    }
  }
}

function aiEconomy(
  state: GameState,
  owner: PlayerId,
  gatherMult: number,
): void {
  const player = state.players[owner];
  // Difficulty scales how efficiently the AI's villagers gather. Store it per
  // owner so each AI slot keeps its own difficulty.
  state.aiGatherMults[owner] = gatherMult;
  state.aiGatherMult = gatherMult;
  const villagers = state.units.filter(
    (u) => u.owner === owner && u.kind === "villager",
  );
  const idle = villagers.filter((u) => u.orders.length === 0);

  // Assign idle villagers to the nearest resource.
  for (const villager of idle) {
    const node = nearestNode(state, villager, [
      "tree",
      "forage",
      "gold",
      "stone",
    ]);
    if (node) {
      villager.orders = [{ type: "gather", nodeId: node.id }];
      villager.gatherNodeId = node.id;
    }
  }

  // Train villagers while population allows.
  const tc = state.buildings.find(
    (b) =>
      b.owner === owner &&
      b.kind === "townCenter" &&
      b.progress >= 1 &&
      !b.cancelled,
  );
  const pop = population(state, owner);
  if (
    tc &&
    tc.queue.length < 3 &&
    pop.used < pop.cap - 2 &&
    villagers.length < 24
  ) {
    enqueueUnit(state, tc.id, "villager");
  }

  // Build houses when near the cap.
  const houses = state.buildings.filter(
    (b) => b.owner === owner && b.kind === "house" && !b.cancelled,
  ).length;
  if (pop.cap - pop.used < 4 && houses < 12) {
    aiPlaceBuilding(state, owner, "house");
  }

  // Advance ages when affordable.
  if (!player.advancing && player.age < 4) {
    const next = (player.age + 1) as Exclude<Age, 1>;
    if (canAfford(player.resources, AGE_COSTS[next]) && state.elapsed > 60) {
      advanceAge(state, owner);
    }
  }

  // Build production structures as the age allows.
  const has = (kind: BuildingKind): boolean =>
    state.buildings.some(
      (b) => b.owner === owner && b.kind === kind && !b.cancelled,
    );
  if (player.age >= 2 && !has("barracks"))
    aiPlaceBuilding(state, owner, "barracks");
  if (player.age >= 2 && !has("mill")) aiPlaceBuilding(state, owner, "mill");
  if (player.age >= 2 && !has("blacksmith"))
    aiPlaceBuilding(state, owner, "blacksmith");
  if (player.age >= 3 && !has("stable"))
    aiPlaceBuilding(state, owner, "stable");
  if (player.age >= 3 && !has("archeryRange"))
    aiPlaceBuilding(state, owner, "archeryRange");
  if (player.age >= 3 && !has("fortress"))
    aiPlaceBuilding(state, owner, "fortress");
  if (player.age >= 2 && !has("tower")) aiPlaceBuilding(state, owner, "tower");
  if (player.age >= 2 && !has("energyDistribution"))
    aiPlaceBuilding(state, owner, "energyDistribution");
  // Energy generation keeps the AI's grid solvent as it ages up.
  if (!has("windmill")) aiPlaceBuilding(state, owner, "windmill");
  if (player.age >= 2 && !has("watermill"))
    aiPlaceBuilding(state, owner, "watermill");
  if (player.age >= 3 && !has("thermalPlant"))
    aiPlaceBuilding(state, owner, "thermalPlant");
  if (player.age >= 4 && !has("solarArray"))
    aiPlaceBuilding(state, owner, "solarArray");
  if (player.age >= 3 && !has("hospital"))
    aiPlaceBuilding(state, owner, "hospital");
}

function aiPlaceBuilding(
  state: GameState,
  owner: PlayerId,
  kind: BuildingKind,
): void {
  const stats = BUILDING_STATS[kind];
  const start = state.map.starts[owner] ?? state.map.starts[0];
  const blocked = blockedTilesForOwner(state, owner);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 4 + Math.random() * 10;
    const tx = Math.floor(start.x + Math.cos(angle) * radius);
    const ty = Math.floor(start.y + Math.sin(angle) * radius);
    if (!isBuildable(state.map, tx, ty, stats.size)) continue;
    let free = true;
    for (let y = ty; y < ty + stats.size && free; y += 1) {
      for (let x = tx; x < tx + stats.size; x += 1) {
        if (blocked.has(`${x},${y}`)) {
          free = false;
          break;
        }
      }
    }
    if (!free) continue;
    const cost = buildingCost(kind, state.players[owner].faction);
    if (!canAfford(state.players[owner].resources, cost)) return;
    pay(state.players[owner].resources, cost);
    const building = addBuilding(state, owner, kind, tx, ty, false);
    // Assign nearby villagers to construct it.
    const builders = state.units
      .filter((u) => u.owner === owner && u.kind === "villager")
      .slice(0, 3);
    for (const builder of builders) {
      builder.orders = [{ type: "build", buildingId: building.id }];
      builder.workBuildingId = building.id;
    }
    return;
  }
}

function aiMilitary(
  state: GameState,
  owner: PlayerId,
  armyTarget: number,
): void {
  const player = state.players[owner];
  const army = state.units.filter(
    (u) => u.owner === owner && u.kind !== "villager" && u.kind !== "scout",
  );
  if (army.length >= armyTarget) return;

  const producers = state.buildings.filter(
    (b) =>
      b.owner === owner &&
      !b.cancelled &&
      b.progress >= 1 &&
      BUILDING_STATS[b.kind].trains.length > 0 &&
      b.kind !== "townCenter",
  );
  for (const producer of producers) {
    if (producer.queue.length >= 2) continue;
    const options = BUILDING_STATS[producer.kind].trains.filter(
      (k) =>
        UNIT_STATS[k].minAge <= player.age &&
        (!isFactionElite(k) || factionEliteKind(player.faction) === k),
    );
    if (options.length === 0) continue;
    const kind = options[Math.floor(Math.random() * options.length)];
    enqueueUnit(state, producer.id, kind);
  }
}

function aiAttackWave(
  state: GameState,
  owner: PlayerId,
  armyTarget: number,
): void {
  const army = state.units.filter(
    (u) => u.owner === owner && u.kind !== "villager" && u.kind !== "scout",
  );
  if (army.length < Math.max(4, Math.floor(armyTarget * 0.5))) return;

  // Target the nearest enemy building to this AI's start.
  const start = state.map.starts[owner] ?? state.map.starts[0];
  let target: Building | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const b of state.buildings) {
    if (b.cancelled) continue;
    if (!isEnemy(state, owner, b.owner)) continue;
    const c = buildingCenter(b);
    const d = Math.hypot(c.x - start.x, c.y - start.y);
    if (d < bestDist) {
      bestDist = d;
      target = b;
    }
  }
  if (!target) return;
  const c = buildingCenter(target);
  for (const unit of army) {
    unit.orders = [{ type: "attackMove", x: c.x, y: c.y }];
    unit.stance = "aggressive";
  }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export function unitLabel(kind: UnitKind): string {
  const labels: Record<UnitKind, string> = {
    villager: "Villager",
    scout: "Scout",
    meleeInfantry: "Infantry",
    rangedInfantry: "Archer",
    cavalry: "Cavalry",
    siege: "Siege Engine",
    praetorian: "Praetorian Guard",
    keshig: "Keshig Rider",
    huscarl: "Huscarl",
  };
  return labels[kind];
}

export function buildingLabel(kind: BuildingKind): string {
  const labels: Record<BuildingKind, string> = {
    townCenter: "Town Center",
    house: "House",
    mill: "Mill",
    farm: "Farm",
    market: "Market",
    barracks: "Barracks",
    archeryRange: "Archery Range",
    stable: "Stable",
    blacksmith: "Blacksmith",
    tower: "Tower",
    wall: "Wall",
    fortress: "Fortress",
    energyDistribution: "Energy Distribution Center",
    windmill: "Windmill",
    watermill: "Water Mill",
    thermalPlant: "Thermal Power Station",
    solarArray: "Solar Array",
    nuclearReactor: "Nuclear Reactor",
    hospital: "Hospital",
  };
  return labels[kind];
}

export {
  canAfford,
  unitCost,
  buildingCost,
  buildingCenter,
  distanceToBuilding,
};
