import type {
  Age,
  BuildingKind,
  BuildingStats,
  ResourceKind,
  ResourcePool,
  UnitKind,
  UnitStats,
  UpgradeDefinition,
  UpgradeKind,
} from "@/types/game";

/** Fixed simulation timestep in seconds (20 ticks per second). */
export const TICK_SECONDS = 1 / 20;

/** Tile size in world units. */
export const TILE = 32;

/**
 * Legacy population ceiling. Kept for compatibility with callers that still
 * import it; the live ceiling is the per-player lobby limit on `PlayerState`.
 */
export const POP_CEILING = 500;

/** Population limits a player may choose in the lobby. */
export const POPULATION_LIMITS: readonly number[] = [100, 200, 300, 400, 500];

/** Population limit applied when a match config omits one. */
export const DEFAULT_POPULATION_LIMIT = 200;

/** Starting resources for each player. */
export const STARTING_RESOURCES: ResourcePool = {
  food: 300,
  wood: 300,
  gold: 150,
  stone: 100,
  money: 0,
  energy: 0,
};

/** Age advancement costs, indexed by the age being entered (2, 3, 4). */
export const AGE_COSTS: Record<Exclude<Age, 1>, Partial<ResourcePool>> = {
  2: { food: 500, gold: 200, stone: 0 },
  3: { food: 800, gold: 400, stone: 200 },
  4: { food: 1200, gold: 800, stone: 400 },
};

/** Seconds required to advance into each age. */
export const AGE_TIMES: Record<Exclude<Age, 1>, number> = {
  2: 45,
  3: 70,
  4: 100,
};

export const UNIT_STATS: Record<UnitKind, UnitStats> = {
  villager: {
    maxHealth: 40,
    attack: 3,
    range: 0.6,
    speed: 2.6,
    armor: 0,
    attackInterval: 1.4,
    trainTime: 18,
    cost: { food: 50 },
    pop: 1,
    energyUpkeep: 0,
    gatherer: true,
    builder: true,
    repairer: true,
    radius: 0.32,
    minAge: 1,
  },
  scout: {
    maxHealth: 70,
    attack: 5,
    range: 0.7,
    speed: 4.4,
    armor: 1,
    attackInterval: 1.2,
    trainTime: 24,
    cost: { food: 80 },
    pop: 1,
    energyUpkeep: 0,
    gatherer: false,
    builder: false,
    repairer: false,
    radius: 0.34,
    minAge: 1,
  },
  meleeInfantry: {
    maxHealth: 70,
    attack: 9,
    range: 0.7,
    speed: 2.5,
    armor: 2,
    attackInterval: 1.1,
    trainTime: 20,
    cost: { food: 60, gold: 20 },
    pop: 1,
    energyUpkeep: 0,
    gatherer: false,
    builder: false,
    repairer: false,
    radius: 0.32,
    minAge: 2,
  },
  rangedInfantry: {
    maxHealth: 50,
    attack: 7,
    range: 5.5,
    speed: 2.4,
    armor: 0,
    attackInterval: 1.5,
    trainTime: 22,
    cost: { food: 40, wood: 45 },
    pop: 1,
    energyUpkeep: 0,
    gatherer: false,
    builder: false,
    repairer: false,
    radius: 0.3,
    minAge: 2,
  },
  cavalry: {
    maxHealth: 110,
    attack: 12,
    range: 0.8,
    speed: 4.0,
    armor: 2,
    attackInterval: 1.3,
    trainTime: 28,
    cost: { food: 80, gold: 40 },
    pop: 2,
    energyUpkeep: 0,
    gatherer: false,
    builder: false,
    repairer: false,
    radius: 0.38,
    minAge: 3,
  },
  siege: {
    maxHealth: 140,
    attack: 40,
    range: 6.5,
    speed: 1.4,
    armor: 3,
    attackInterval: 3.2,
    trainTime: 45,
    cost: { wood: 160, gold: 80, money: 40 },
    pop: 3,
    energyUpkeep: 6,
    // A voltaic siege engine: its discharge depends on the energy grid.
    energyWeapon: true,
    gatherer: false,
    builder: false,
    repairer: false,
    radius: 0.46,
    minAge: 3,
  },
  // --- faction elites ------------------------------------------------------
  // Ember Legion: an armoured heavy-melee champion that anchors the line.
  praetorian: {
    maxHealth: 220,
    attack: 26,
    range: 0.8,
    speed: 2.9,
    armor: 7,
    attackInterval: 1.05,
    trainTime: 42,
    cost: { food: 110, gold: 100, money: 70 },
    pop: 2,
    energyUpkeep: 3,
    gatherer: false,
    builder: false,
    repairer: false,
    radius: 0.42,
    minAge: 4,
  },
  // Steppe Horde: a fast horse-archer that kites from long range.
  keshig: {
    maxHealth: 150,
    attack: 19,
    range: 6.5,
    speed: 4.6,
    armor: 3,
    attackInterval: 1.35,
    trainTime: 40,
    cost: { food: 90, gold: 95, money: 70 },
    pop: 2,
    energyUpkeep: 3,
    // The Keshig's composite bow is strung with an energy-drawn mechanism.
    energyWeapon: true,
    gatherer: false,
    builder: false,
    repairer: false,
    radius: 0.4,
    minAge: 4,
  },
  // Verdant Pact: a heavy-cavalry shock trooper with a devastating charge.
  huscarl: {
    maxHealth: 200,
    attack: 30,
    range: 0.9,
    speed: 4.2,
    armor: 5,
    attackInterval: 1.25,
    trainTime: 44,
    cost: { food: 120, gold: 90, money: 75 },
    pop: 2,
    energyUpkeep: 4,
    gatherer: false,
    builder: false,
    repairer: false,
    radius: 0.44,
    minAge: 4,
  },
};

/** Energy generated per second by a completed Fortress (logistical hub). */
export const FORTRESS_ENERGY_RATE = 3.0;

/**
 * Passive Energy per second produced by each generating building kind.
 *
 * Windmills and Watermills are cheap Age I-II trickle sources; Thermal Power
 * Stations burn Wood for a medium yield; Solar Arrays and Nuclear Reactors are
 * the Age IV heavy hitters.
 */
export const ENERGY_GENERATION_RATE: Record<string, number> = {
  windmill: 1.6,
  watermill: 2.2,
  thermalPlant: 6.0,
  solarArray: 9.0,
  nuclearReactor: 18.0,
};

/** Seconds between Wood burns at a Thermal Power Station. */
export const THERMAL_FUEL_SECONDS = 12;

/** Wood consumed per Thermal Power Station burn. */
export const THERMAL_FUEL_WOOD = 8;

/** Energy produced per Thermal Power Station burn. */
export const THERMAL_FUEL_ENERGY = THERMAL_FUEL_SECONDS * 6.0;

/** Radius in world units within which a Hospital heals damaged units. */
export const HOSPITAL_HEAL_RADIUS = 9;

/** Health restored per second to each unit inside a powered Hospital. */
export const HOSPITAL_HEAL_RATE = 4;

/** Energy per second a Hospital draws while healing. */
export const HOSPITAL_ENERGY_DRAW = 2.5;

/**
 * Production multiplier applied to Barracks, Workshops, and Markets while the
 * owner's energy balance is negative.
 */
export const ENERGY_DEFICIT_PRODUCTION_MULTIPLIER = 0.5;

/** Building kinds whose production is throttled by an energy deficit. */
export const ENERGY_SENSITIVE_PRODUCTION: readonly string[] = [
  "barracks",
  "archeryRange",
  "stable",
  "market",
  "fortress",
];

export const BUILDING_STATS: Record<BuildingKind, BuildingStats> = {
  townCenter: {
    maxHealth: 1200,
    size: 4,
    cost: { wood: 350, stone: 100 },
    buildTime: 60,
    popProvided: 10,
    dropOff: true,
    trains: ["villager", "scout"],
    researches: false,
    advancesAge: true,
    generatesMoney: false,
    generatesEnergy: false,
    energyUpkeep: 0,
    energyConsumer: false,
    distributionRadius: 0,
    attack: 8,
    range: 6,
    attackInterval: 1.6,
    minAge: 1,
    production: true,
  },
  house: {
    maxHealth: 240,
    size: 2,
    cost: { wood: 30 },
    buildTime: 18,
    popProvided: 5,
    dropOff: false,
    trains: [],
    researches: false,
    advancesAge: false,
    generatesMoney: false,
    generatesEnergy: false,
    energyUpkeep: 0,
    energyConsumer: false,
    distributionRadius: 0,
    attack: 0,
    range: 0,
    attackInterval: 0,
    minAge: 1,
    production: false,
  },
  mill: {
    maxHealth: 320,
    size: 2,
    cost: { wood: 100 },
    buildTime: 25,
    popProvided: 0,
    dropOff: true,
    trains: [],
    researches: false,
    advancesAge: false,
    generatesMoney: false,
    generatesEnergy: false,
    energyUpkeep: 0,
    energyConsumer: false,
    distributionRadius: 0,
    attack: 0,
    range: 0,
    attackInterval: 0,
    minAge: 1,
    production: false,
  },
  farm: {
    maxHealth: 120,
    size: 2,
    cost: { wood: 60 },
    buildTime: 14,
    popProvided: 0,
    dropOff: false,
    trains: [],
    researches: false,
    advancesAge: false,
    generatesMoney: false,
    generatesEnergy: false,
    energyUpkeep: 0,
    energyConsumer: false,
    distributionRadius: 0,
    attack: 0,
    range: 0,
    attackInterval: 0,
    minAge: 1,
    production: false,
  },
  market: {
    maxHealth: 400,
    size: 3,
    cost: { wood: 175 },
    buildTime: 35,
    popProvided: 0,
    dropOff: false,
    trains: [],
    researches: false,
    advancesAge: false,
    generatesMoney: true,
    generatesEnergy: false,
    energyUpkeep: 0,
    energyConsumer: false,
    distributionRadius: 0,
    attack: 0,
    range: 0,
    attackInterval: 0,
    minAge: 2,
    production: false,
  },
  barracks: {
    maxHealth: 500,
    size: 3,
    cost: { wood: 150 },
    buildTime: 32,
    popProvided: 0,
    dropOff: false,
    trains: ["meleeInfantry"],
    researches: false,
    advancesAge: false,
    generatesMoney: false,
    generatesEnergy: false,
    energyUpkeep: 0,
    energyConsumer: false,
    distributionRadius: 0,
    attack: 0,
    range: 0,
    attackInterval: 0,
    minAge: 2,
    production: true,
  },
  archeryRange: {
    maxHealth: 500,
    size: 3,
    cost: { wood: 175 },
    buildTime: 34,
    popProvided: 0,
    dropOff: false,
    trains: ["rangedInfantry"],
    researches: false,
    advancesAge: false,
    generatesMoney: false,
    generatesEnergy: false,
    energyUpkeep: 0,
    energyConsumer: false,
    distributionRadius: 0,
    attack: 0,
    range: 0,
    attackInterval: 0,
    minAge: 2,
    production: true,
  },
  stable: {
    maxHealth: 520,
    size: 3,
    cost: { wood: 175 },
    buildTime: 36,
    popProvided: 0,
    dropOff: false,
    trains: ["cavalry"],
    researches: false,
    advancesAge: false,
    generatesMoney: false,
    generatesEnergy: false,
    energyUpkeep: 0,
    energyConsumer: false,
    distributionRadius: 0,
    attack: 0,
    range: 0,
    attackInterval: 0,
    minAge: 3,
    production: true,
  },
  blacksmith: {
    maxHealth: 480,
    size: 3,
    cost: { wood: 150, stone: 50 },
    buildTime: 38,
    popProvided: 0,
    dropOff: false,
    trains: [],
    researches: true,
    advancesAge: false,
    generatesMoney: false,
    generatesEnergy: false,
    energyUpkeep: 0,
    energyConsumer: false,
    distributionRadius: 0,
    attack: 0,
    range: 0,
    attackInterval: 0,
    minAge: 2,
    production: false,
  },
  tower: {
    maxHealth: 700,
    size: 2,
    cost: { wood: 50, stone: 150 },
    buildTime: 40,
    popProvided: 0,
    dropOff: false,
    trains: [],
    researches: false,
    advancesAge: false,
    generatesMoney: false,
    generatesEnergy: false,
    energyUpkeep: 8,
    energyConsumer: true,
    distributionRadius: 0,
    attack: 14,
    range: 8,
    attackInterval: 1.4,
    minAge: 2,
    production: false,
  },
  wall: {
    maxHealth: 400,
    size: 1,
    cost: { stone: 12 },
    buildTime: 6,
    popProvided: 0,
    dropOff: false,
    trains: [],
    researches: false,
    advancesAge: false,
    generatesMoney: false,
    generatesEnergy: false,
    energyUpkeep: 0,
    energyConsumer: false,
    distributionRadius: 0,
    attack: 0,
    range: 0,
    attackInterval: 0,
    minAge: 2,
    production: false,
  },
  fortress: {
    maxHealth: 1600,
    size: 4,
    cost: { wood: 300, stone: 400, gold: 200 },
    buildTime: 75,
    popProvided: 0,
    dropOff: false,
    trains: ["siege", "praetorian", "keshig", "huscarl"],
    researches: true,
    advancesAge: false,
    generatesMoney: false,
    generatesEnergy: true,
    energyUpkeep: 0,
    energyConsumer: true,
    distributionRadius: 0,
    attack: 18,
    range: 9,
    attackInterval: 1.5,
    minAge: 3,
    production: true,
  },
  energyDistribution: {
    maxHealth: 620,
    size: 3,
    cost: { wood: 180, stone: 120, gold: 60 },
    buildTime: 42,
    popProvided: 0,
    dropOff: false,
    trains: [],
    researches: false,
    advancesAge: false,
    generatesMoney: false,
    generatesEnergy: false,
    energyUpkeep: 2,
    energyConsumer: false,
    distributionRadius: 14,
    attack: 0,
    range: 0,
    attackInterval: 0,
    minAge: 2,
    production: false,
  },
  // --- Age I-II energy generation -----------------------------------------
  windmill: {
    maxHealth: 260,
    size: 2,
    cost: { wood: 70, stone: 20 },
    buildTime: 20,
    popProvided: 0,
    dropOff: false,
    trains: [],
    researches: false,
    advancesAge: false,
    generatesMoney: false,
    generatesEnergy: true,
    energyUpkeep: 0,
    energyConsumer: false,
    distributionRadius: 0,
    attack: 0,
    range: 0,
    attackInterval: 0,
    minAge: 1,
    production: false,
  },
  watermill: {
    maxHealth: 300,
    size: 2,
    cost: { wood: 90, stone: 40 },
    buildTime: 24,
    popProvided: 0,
    dropOff: false,
    trains: [],
    researches: false,
    advancesAge: false,
    generatesMoney: false,
    generatesEnergy: true,
    energyUpkeep: 0,
    energyConsumer: false,
    distributionRadius: 0,
    attack: 0,
    range: 0,
    attackInterval: 0,
    minAge: 2,
    production: false,
  },
  // --- Age III energy generation ------------------------------------------
  thermalPlant: {
    maxHealth: 520,
    size: 3,
    cost: { wood: 220, stone: 140, gold: 80 },
    buildTime: 46,
    popProvided: 0,
    dropOff: false,
    trains: [],
    researches: false,
    advancesAge: false,
    generatesMoney: false,
    generatesEnergy: true,
    energyUpkeep: 0,
    energyConsumer: false,
    distributionRadius: 0,
    attack: 0,
    range: 0,
    attackInterval: 0,
    minAge: 3,
    production: false,
  },
  // --- Age IV energy generation -------------------------------------------
  solarArray: {
    maxHealth: 480,
    size: 3,
    cost: { wood: 180, stone: 200, gold: 220, money: 120 },
    buildTime: 52,
    popProvided: 0,
    dropOff: false,
    trains: [],
    researches: false,
    advancesAge: false,
    generatesMoney: false,
    generatesEnergy: true,
    energyUpkeep: 0,
    energyConsumer: false,
    distributionRadius: 0,
    attack: 0,
    range: 0,
    attackInterval: 0,
    minAge: 4,
    production: false,
  },
  nuclearReactor: {
    maxHealth: 900,
    size: 4,
    cost: { wood: 260, stone: 420, gold: 380, money: 260 },
    buildTime: 90,
    popProvided: 0,
    dropOff: false,
    trains: [],
    researches: false,
    advancesAge: false,
    generatesMoney: false,
    generatesEnergy: true,
    energyUpkeep: 0,
    energyConsumer: false,
    distributionRadius: 0,
    attack: 0,
    range: 0,
    attackInterval: 0,
    minAge: 4,
    production: false,
  },
  // --- Support ------------------------------------------------------------
  hospital: {
    maxHealth: 420,
    size: 3,
    cost: { wood: 160, stone: 90, gold: 70 },
    buildTime: 40,
    popProvided: 0,
    dropOff: false,
    trains: [],
    researches: false,
    advancesAge: false,
    generatesMoney: false,
    generatesEnergy: false,
    energyUpkeep: HOSPITAL_ENERGY_DRAW,
    energyConsumer: true,
    distributionRadius: 0,
    attack: 0,
    range: 0,
    attackInterval: 0,
    minAge: 3,
    production: false,
  },
};

/** Gather rate per second for each resource node kind. */
export const GATHER_RATES: Record<string, number> = {
  tree: 0.55,
  gold: 0.45,
  stone: 0.4,
  forage: 0.5,
  animal: 0.7,
  farm: 0.6,
};

/** Carry capacity per villager trip. */
export const CARRY_CAPACITY = 12;

/** Money generated per second by a completed Market. */
export const MARKET_MONEY_RATE = 0.35;

/** Stockpile below which the grid drops to Low Power. */
export const LOW_POWER_THRESHOLD = 5;

/** Attack-speed multiplier applied to energy weapons in Low Power. */
export const LOW_POWER_ATTACK_SPEED = 0.5;

/** Damage multiplier applied to energy weapons in Low Power. */
export const LOW_POWER_DAMAGE = 0.6;

/** Recharge multiplier applied to energy weapons in Low Power (slower). */
export const LOW_POWER_RECHARGE = 1.5;

/** Food held by a freshly sown farm plot. */
export const FARM_PLOT_FOOD = 220;

/** Seconds a depleted farm plot takes to resow itself. */
export const FARM_REGROW_SECONDS = 30;

/**
 * Seconds between automated harvests from a completed Farm. A Farm feeds its
 * owner's stockpile on this cadence with no Villager assigned to it.
 */
export const FARM_PRODUCTION_SECONDS = 20;

/** Food added to the owner's stockpile per automated farm harvest. */
export const FARM_PRODUCTION_FOOD = 12;

/** Food per second a single completed Farm contributes to the resource bar. */
export const FARM_FOOD_RATE = FARM_PRODUCTION_FOOD / FARM_PRODUCTION_SECONDS;

/** Money received per unit of resource sold at the Market. */
export const MARKET_SELL_RATE: Record<string, number> = {
  food: 0.35,
  wood: 0.4,
  gold: 0.9,
  stone: 0.6,
};

/**
 * Money paid per unit of resource bought at the Market. Buying is dearer than
 * selling so the spread keeps the exchange meaningful.
 */
export const MARKET_BUY_RATE: Record<string, number> = {
  food: 0.6,
  wood: 0.7,
  gold: 1.5,
  stone: 1.0,
};

/** Resources that can be traded at the Market. */
export const SELLABLE_RESOURCES: readonly ResourceKind[] = [
  "food",
  "wood",
  "gold",
  "stone",
];

/** Resources that can be bought at the Market. */
export const BUYABLE_RESOURCES: readonly ResourceKind[] = [
  "food",
  "wood",
  "gold",
  "stone",
];

/** Default investment proposal terms offered in the Market interface. */
export const INVESTMENT_DEFAULT_PRINCIPAL = 1000;
export const INVESTMENT_DEFAULT_RATE = 0.15;
export const INVESTMENT_DEFAULT_INTERVAL_SECONDS = 180;
export const INVESTMENT_DEFAULT_PAYMENTS = 4;

/** Bounds the Market interface clamps proposals to. */
export const INVESTMENT_MIN_PRINCIPAL = 100;
export const INVESTMENT_MAX_PRINCIPAL = 10000;
export const INVESTMENT_MIN_RATE = 0.05;
export const INVESTMENT_MAX_RATE = 0.5;
export const INVESTMENT_MIN_INTERVAL_SECONDS = 30;
export const INVESTMENT_MAX_INTERVAL_SECONDS = 600;
export const INVESTMENT_MAX_PAYMENTS = 12;

/** Seconds a pending proposal waits before it lapses. */
export const INVESTMENT_PROPOSAL_TTL_SECONDS = 120;

/** Seconds of match time covered by one gather-rate sample bucket. */
export const GATHER_SAMPLE_SECONDS = 2;

/** Number of sample buckets kept for the rolling gather-rate window. */
export const GATHER_WINDOW_BUCKETS = 15;

/** Upgrades offered by the Blacksmith and Fortress. */
export const UPGRADES: Record<UpgradeKind, UpgradeDefinition> = {
  forgedBlades: {
    id: "forgedBlades",
    name: "Forged Blades",
    description: "All units strike 15% harder.",
    cost: { food: 150, gold: 100 },
    minAge: 2,
    buildings: ["blacksmith"],
    attackMultiplier: 1.15,
  },
  temperedArmor: {
    id: "temperedArmor",
    name: "Tempered Armor",
    description: "All units gain +2 armor.",
    cost: { food: 120, gold: 120, stone: 60 },
    minAge: 2,
    buildings: ["blacksmith"],
    armorBonus: 2,
  },
  swiftMarshalling: {
    id: "swiftMarshalling",
    name: "Swift Marshalling",
    description: "All units move 12% faster.",
    cost: { food: 180, gold: 140 },
    minAge: 3,
    buildings: ["blacksmith"],
    speedMultiplier: 1.12,
  },
  siegeWorks: {
    id: "siegeWorks",
    name: "Siege Works",
    description: "Siege engines and elites gain 20% attack.",
    cost: { wood: 200, gold: 180, money: 80 },
    minAge: 3,
    buildings: ["fortress"],
    attackMultiplier: 1.2,
  },
  eliteMuster: {
    id: "eliteMuster",
    name: "Elite Muster",
    description: "Fortress elites gain +3 armor and 10% speed.",
    cost: { food: 250, gold: 220, money: 120 },
    minAge: 4,
    buildings: ["fortress"],
    armorBonus: 3,
    speedMultiplier: 1.1,
  },
  economicPartners: {
    id: "economicPartners",
    name: "Economic Partners",
    description:
      "Sign a trade charter with your allies: both sides share line of sight for the rest of the match.",
    cost: { food: 200, gold: 150, money: 100 },
    minAge: 2,
    buildings: ["market"],
    sharesVision: true,
  },
};

/** Upgrades that only affect siege engines and faction elites. */
export const ELITE_ONLY_UPGRADES: readonly UpgradeKind[] = [
  "siegeWorks",
  "eliteMuster",
];

/** Veterancy thresholds and multipliers. */
export const RANK_XP = [0, 40, 110, 240];
export const RANK_DAMAGE_MULT = [1, 1.15, 1.3, 1.5];
export const RANK_HEALTH_MULT = [1, 1.1, 1.2, 1.35];

/**
 * Map dimensions in tiles for each size option.
 *
 * The largest option is roughly ten times the area of the original 144x144
 * "large" map (144 * 144 = 20,736 tiles; 456 * 456 = 207,936 tiles), and the
 * smaller options scale proportionally so every size keeps the same feel.
 */
export const MAP_DIMENSIONS: Record<string, { width: number; height: number }> =
  {
    small: { width: 144, height: 144 },
    medium: { width: 264, height: 264 },
    large: { width: 456, height: 456 },
  };

/** The map size key that produces the largest footprint. */
export const LARGEST_MAP_SIZE = "large";

/** AI tuning per difficulty. */
export const AI_TUNING: Record<
  string,
  {
    gatherMult: number;
    armyTarget: number;
    attackWaveSeconds: number;
    buildDelay: number;
  }
> = {
  easy: {
    gatherMult: 0.75,
    armyTarget: 8,
    attackWaveSeconds: 150,
    buildDelay: 6,
  },
  normal: {
    gatherMult: 1.0,
    armyTarget: 16,
    attackWaveSeconds: 110,
    buildDelay: 3,
  },
  hard: {
    gatherMult: 1.3,
    armyTarget: 26,
    attackWaveSeconds: 80,
    buildDelay: 1.5,
  },
};

/**
 * Build-menu grouping. The UI renders one section per entry, in this order,
 * and filters each entry by the player's current age.
 */
export const BUILD_MENU: ReadonlyArray<{
  section: string;
  kinds: readonly BuildingKind[];
}> = [
  {
    section: "Economy",
    kinds: ["house", "mill", "farm", "market"],
  },
  {
    section: "Military",
    kinds: [
      "barracks",
      "archeryRange",
      "stable",
      "blacksmith",
      "tower",
      "wall",
    ],
  },
  {
    section: "Power",
    kinds: [
      "energyDistribution",
      "windmill",
      "watermill",
      "thermalPlant",
      "solarArray",
      "nuclearReactor",
    ],
  },
  {
    section: "Support",
    kinds: ["hospital", "fortress"],
  },
];

/** Building kinds that generate Energy, in ascending age order. */
export const ENERGY_BUILDING_KINDS: readonly BuildingKind[] = [
  "windmill",
  "watermill",
  "thermalPlant",
  "solarArray",
  "nuclearReactor",
];

// ---------------------------------------------------------------------------
// Performance auto-scaling
// ---------------------------------------------------------------------------

/** FPS below which the client is considered to be struggling. */
export const PERF_LOW_FPS = 20;

/** Seconds the frame rate must stay low before the client reacts. */
export const PERF_LOW_FPS_SECONDS = 5;

/** Seconds the "optimizing" banner stays on screen once shown. */
export const PERF_BANNER_SECONDS = 60;

/** Seconds between successive auto-scaling steps while load stays critical. */
export const PERF_STEP_COOLDOWN_SECONDS = 20;

/** Render frame cap applied at each detail tier (0 = uncapped). */
export const PERF_FRAME_CAP: Record<string, number> = {
  high: 0,
  medium: 45,
  low: 30,
};

/** Terrain detail stride applied at each tier (1 = every tile). */
export const PERF_TERRAIN_STRIDE: Record<string, number> = {
  high: 1,
  medium: 2,
  low: 3,
};

/** Population ceiling reduction applied per critical auto-scaling step. */
export const PERF_POPULATION_STEP = 50;

/** Lowest population ceiling auto-scaling will ever apply. */
export const PERF_MIN_POPULATION = 100;
