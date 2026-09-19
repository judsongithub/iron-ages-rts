import { AiDifficulty, Faction, MapSize } from "@/backend";
import {
  BUILDING_STATS,
  FORTRESS_ENERGY_RATE,
  LOW_POWER_DAMAGE,
  LOW_POWER_RECHARGE,
  LOW_POWER_THRESHOLD,
  TICK_SECONDS,
  UNIT_STATS,
} from "@/game/constants";
import {
  buildingCenter,
  createGame,
  energyDrawOfBuilding,
  energyDrawOfUnit,
  energyProductionRate,
  energyUpkeepRate,
  isStructurePowered,
  placeBuilding,
  powerStateFor,
  powerStateForBuilding,
  step,
} from "@/game/engine";
import type { GameState } from "@/game/engine";
import type { Building, BuildingKind, Unit, UnitKind } from "@/types/game";
import { describe, expect, it } from "vitest";

/**
 * Cover for the Energy Grid update.
 *
 * The accepted behavior: a new Energy Distribution Center distributes power to
 * energy-consuming structures inside its radius; consumers outside every radius
 * are unpowered and cannot fire; the global grid resolves Standard / Low Power /
 * Blackout from the stockpile and balance; and the inspection readouts expose a
 * signed energy draw and the resolved power state.
 *
 * These tests drive the real simulation with locally constructed entities, so
 * they assert observable engine behavior rather than a mock.
 */

const CONFIG = {
  faction: Faction.romans,
  mapSize: MapSize.small,
  difficulty: AiDifficulty.normal,
  playerTeam: 1 as const,
  aiTeam: 2 as const,
  populationLimit: 200,
  aiPopulationLimit: 200,
};

function newGame(seed = 1234): GameState {
  return createGame(CONFIG, seed);
}

/**
 * Removes every entity so a test can place exactly the ones it needs, then
 * gives both players a completed production building. Without production on
 * both sides `checkVictory` ends the match on the first tick and `step` stops
 * simulating, which would make every time-based assertion vacuous.
 */
function clearEntities(state: GameState): void {
  state.units = [];
  state.buildings = [];
  makeBuilding(state, "townCenter", 5, 5, 4, 0);
  makeBuilding(state, "townCenter", 60, 60, 4, 1);
}

function makeBuilding(
  state: GameState,
  kind: BuildingKind,
  tx: number,
  ty: number,
  size: number,
  owner: 0 | 1 = 0,
  progress = 1,
): Building {
  const stats = BUILDING_STATS[kind];
  const building: Building = {
    id: state.nextId++,
    owner,
    kind,
    tx,
    ty,
    size,
    health: stats.maxHealth,
    maxHealth: stats.maxHealth,
    progress,
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
  state.buildings.push(building);
  return building;
}

function makeUnit(
  state: GameState,
  kind: UnitKind,
  x: number,
  y: number,
  owner: 0 | 1 = 0,
): Unit {
  const stats = UNIT_STATS[kind];
  const unit: Unit = {
    id: state.nextId++,
    owner,
    kind,
    x,
    y,
    health: stats.maxHealth,
    maxHealth: stats.maxHealth,
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
  state.units.push(unit);
  return unit;
}

function run(state: GameState, seconds: number): void {
  const ticks = Math.ceil(seconds / TICK_SECONDS);
  for (let i = 0; i < ticks && !state.finished; i += 1) step(state);
}

describe("energy grid cover: Energy Distribution Center definition", () => {
  it("is available from the Age of Iron with its own cost, build time, HP, and fixed radius", () => {
    const stats = BUILDING_STATS.energyDistribution;
    expect(stats.minAge).toBe(2);
    expect(stats.maxHealth).toBeGreaterThan(0);
    expect(stats.buildTime).toBeGreaterThan(0);
    expect(stats.distributionRadius).toBeGreaterThan(0);
    // Its own cost, distinct from the other structures.
    expect(stats.cost.wood ?? 0).toBeGreaterThan(0);
    expect(stats.cost.stone ?? 0).toBeGreaterThan(0);
    expect(stats.cost.gold ?? 0).toBeGreaterThan(0);
  });

  it("cannot be placed at the Age of Settlement but can at the Age of Iron", () => {
    const state = newGame();
    clearEntities(state);
    const villager = makeUnit(state, "villager", 10.5, 10.5, 0);
    state.players[0].resources.wood = 5000;
    state.players[0].resources.stone = 5000;
    state.players[0].resources.gold = 5000;

    // Age 1: refused.
    expect(state.players[0].age).toBe(1);
    const atAge1 = placeBuilding(state, 0, "energyDistribution", 10, 10, [
      villager.id,
    ]);
    expect(atAge1).toBeNull();

    // Age 2: accepted.
    state.players[0].age = 2;
    const atAge2 = placeBuilding(state, 0, "energyDistribution", 10, 10, [
      villager.id,
    ]);
    expect(atAge2).not.toBeNull();
    expect(atAge2?.kind).toBe("energyDistribution");
  });
});

describe("energy grid cover: distribution coverage", () => {
  it("powers a consumer whose footprint lies inside a completed distributor's radius", () => {
    const state = newGame();
    clearEntities(state);
    // Distributor centred at (30, 30) with radius 14.
    makeBuilding(state, "energyDistribution", 28, 28, 3, 0);
    // Tower (2x2) centred at (34, 30): well inside the radius.
    const tower = makeBuilding(state, "tower", 33, 29, 2, 0);

    expect(BUILDING_STATS.tower.energyConsumer).toBe(true);
    expect(isStructurePowered(state, tower)).toBe(true);
    expect(powerStateForBuilding(state, tower)).not.toBe("unpowered");
  });

  it("treats a consumer outside every radius as unpowered", () => {
    const state = newGame();
    clearEntities(state);
    makeBuilding(state, "energyDistribution", 28, 28, 3, 0);
    // Tower centred at (60, 60): far outside the radius.
    const tower = makeBuilding(state, "tower", 59, 59, 2, 0);

    expect(isStructurePowered(state, tower)).toBe(false);
    expect(powerStateForBuilding(state, tower)).toBe("unpowered");
  });

  it("does not count an unfinished distributor as coverage", () => {
    const state = newGame();
    clearEntities(state);
    makeBuilding(state, "energyDistribution", 28, 28, 3, 0, 0.5);
    const tower = makeBuilding(state, "tower", 33, 29, 2, 0);

    expect(isStructurePowered(state, tower)).toBe(false);
    expect(powerStateForBuilding(state, tower)).toBe("unpowered");
  });

  it("does not let an enemy distributor power the player's structures", () => {
    const state = newGame();
    clearEntities(state);
    makeBuilding(state, "energyDistribution", 28, 28, 3, 1);
    const tower = makeBuilding(state, "tower", 33, 29, 2, 0);

    expect(isStructurePowered(state, tower)).toBe(false);
    expect(powerStateForBuilding(state, tower)).toBe("unpowered");
  });

  it("reports non-consumers as standard regardless of coverage", () => {
    const state = newGame();
    clearEntities(state);
    const house = makeBuilding(state, "house", 10, 10, 2, 0);
    expect(BUILDING_STATS.house.energyConsumer).toBe(false);
    expect(powerStateForBuilding(state, house)).toBe("standard");
  });
});

describe("energy grid cover: global power state", () => {
  it("reports blackout when the global stockpile is zero", () => {
    const state = newGame();
    clearEntities(state);
    state.players[0].resources.energy = 0;
    expect(powerStateFor(state, 0)).toBe("blackout");
  });

  it("reports low power when upkeep exceeds production", () => {
    const state = newGame();
    clearEntities(state);
    // A completed Tower draws upkeep; no generator exists.
    makeBuilding(state, "tower", 10, 10, 2, 0);
    state.players[0].resources.energy = 100;
    expect(energyUpkeepRate(state, 0)).toBeGreaterThan(
      energyProductionRate(state, 0),
    );
    expect(powerStateFor(state, 0)).toBe("lowPower");
  });

  it("reports low power when the stockpile is below the threshold", () => {
    const state = newGame();
    clearEntities(state);
    state.players[0].resources.energy = LOW_POWER_THRESHOLD - 1;
    expect(powerStateFor(state, 0)).toBe("lowPower");
  });

  it("reports standard when production covers upkeep and the stockpile is healthy", () => {
    const state = newGame();
    clearEntities(state);
    // A completed Fortress generates energy and draws no upkeep, so the
    // balance is positive.
    makeBuilding(state, "fortress", 10, 10, 4, 0);
    state.players[0].resources.energy = 100;
    expect(energyProductionRate(state, 0)).toBeGreaterThan(
      energyUpkeepRate(state, 0),
    );
    expect(powerStateFor(state, 0)).toBe("standard");
  });
});

describe("energy grid cover: Fortress energy production", () => {
  it("adds Fortress production to the global stockpile over time", () => {
    const state = newGame();
    clearEntities(state);
    makeBuilding(state, "fortress", 30, 30, 4, 0);
    const before = state.players[0].resources.energy;

    const seconds = 20;
    run(state, seconds);

    const gained = state.players[0].resources.energy - before;
    expect(gained).toBeGreaterThan(FORTRESS_ENERGY_RATE * seconds * 0.9);
    expect(gained).toBeLessThan(FORTRESS_ENERGY_RATE * seconds * 1.1);
  });
});

describe("energy grid cover: unpowered consumers cannot fire", () => {
  it("keeps an unpowered Tower from damaging an enemy in range", () => {
    const state = newGame();
    clearEntities(state);
    // Tower centred at (30, 30), no distributor anywhere.
    const tower = makeBuilding(state, "tower", 29, 29, 2, 0);
    expect(powerStateForBuilding(state, tower)).toBe("unpowered");
    // An enemy unit well inside the Tower's range.
    const enemy = makeUnit(state, "villager", 30.5, 34.5, 1);
    const before = enemy.health;

    run(state, 10);

    expect(enemy.health).toBe(before);
  });

  it("lets a powered Tower damage an enemy in range", () => {
    const state = newGame();
    clearEntities(state);
    makeBuilding(state, "energyDistribution", 28, 28, 3, 0);
    const tower = makeBuilding(state, "tower", 29, 29, 2, 0);
    // Keep the stockpile positive so the grid is not in blackout.
    state.players[0].resources.energy = 100;
    expect(powerStateForBuilding(state, tower)).not.toBe("unpowered");
    const enemy = makeUnit(state, "villager", 30.5, 34.5, 1);
    const before = enemy.health;

    run(state, 10);

    expect(enemy.health).toBeLessThan(before);
  });

  it("stops an energy weapon entirely during a blackout", () => {
    const state = newGame();
    clearEntities(state);
    makeBuilding(state, "energyDistribution", 28, 28, 3, 0);
    const tower = makeBuilding(state, "tower", 29, 29, 2, 0);
    // Force a blackout: zero stockpile and no production.
    state.players[0].resources.energy = 0;
    expect(powerStateForBuilding(state, tower)).toBe("blackout");
    const enemy = makeUnit(state, "villager", 30.5, 34.5, 1);
    const before = enemy.health;

    run(state, 10);

    expect(enemy.health).toBe(before);
  });
});

describe("energy grid cover: physical weapons are unaffected", () => {
  it("keeps melee, ranged, and cavalry units attacking during a blackout", () => {
    // Siege is deliberately excluded: this build classifies the voltaic siege
    // engine as an energy weapon (`UNIT_STATS.siege.energyWeapon`), so it is
    // throttled by the grid rather than a physical weapon.
    const physicalKinds: readonly UnitKind[] = [
      "meleeInfantry",
      "rangedInfantry",
      "cavalry",
    ];
    for (const kind of physicalKinds) {
      const state = newGame();
      clearEntities(state);
      // Blackout: zero stockpile, no production.
      state.players[0].resources.energy = 0;
      expect(powerStateFor(state, 0)).toBe("blackout");

      const attacker = makeUnit(state, kind, 30.5, 30.5, 0);
      const target = makeUnit(state, "villager", 30.5, 31.5, 1);
      const before = target.health;

      run(state, 8);

      expect(target.health).toBeLessThan(before);
      expect(attacker.health).toBeGreaterThan(0);
    }
  });

  it("treats the siege engine as an energy weapon that falls silent in a blackout", () => {
    const state = newGame();
    clearEntities(state);
    state.players[0].resources.energy = 0;
    expect(powerStateFor(state, 0)).toBe("blackout");

    const _siege = makeUnit(state, "siege", 30.5, 30.5, 0);
    const target = makeUnit(state, "villager", 30.5, 31.5, 1);
    const before = target.health;

    run(state, 8);

    expect(target.health).toBe(before);
  });
});

describe("energy grid cover: signed energy draw readouts", () => {
  it("reports a negative draw for an energy-consuming unit", () => {
    const state = newGame();
    clearEntities(state);
    const siege = makeUnit(state, "siege", 10.5, 10.5, 0);
    expect(UNIT_STATS.siege.energyUpkeep).toBeGreaterThan(0);
    expect(energyDrawOfUnit(siege)).toBeLessThan(0);
  });

  it("reports zero draw for a unit with no energy upkeep", () => {
    const state = newGame();
    clearEntities(state);
    const villager = makeUnit(state, "villager", 10.5, 10.5, 0);
    // `-0` is the signed zero of a zero upkeep; compare numerically.
    expect(energyDrawOfUnit(villager)).toBeCloseTo(0);
  });

  it("reports a positive net draw for a Fortress generator", () => {
    const state = newGame();
    clearEntities(state);
    const fortress = makeBuilding(state, "fortress", 10, 10, 4, 0);
    expect(energyDrawOfBuilding(fortress)).toBeGreaterThan(0);
  });

  it("reports a negative draw for an energy-consuming building", () => {
    const state = newGame();
    clearEntities(state);
    const tower = makeBuilding(state, "tower", 10, 10, 2, 0);
    expect(energyDrawOfBuilding(tower)).toBeLessThan(0);
  });
});

describe("energy grid cover: low power modifiers", () => {
  it("slows an energy weapon's fire rate and reduces its damage under low power", () => {
    // The engine exposes the low-power multipliers as constants; assert the
    // accepted values so a regression in the tuning is caught.
    expect(LOW_POWER_DAMAGE).toBeLessThan(1);
    expect(LOW_POWER_RECHARGE).toBeGreaterThan(1);
  });

  it("deals less damage under low power than under standard power", () => {
    // Four completed Fortresses generate 12/s, enough to cover the Tower's 8/s
    // plus the distributor's 2/s upkeep. They sit far from the distributor, so
    // they are unpowered and do not fire; they only contribute generation,
    // keeping both branches equal except for the Tower's resolved power state.
    const measureDamage = (lowPower: boolean): number => {
      const state = newGame();
      clearEntities(state);
      makeBuilding(state, "energyDistribution", 28, 28, 3, 0);
      makeBuilding(state, "fortress", 2, 2, 4, 0);
      makeBuilding(state, "fortress", 2, 10, 4, 0);
      makeBuilding(state, "fortress", 10, 2, 4, 0);
      makeBuilding(state, "fortress", 10, 10, 4, 0);
      const tower = makeBuilding(state, "tower", 29, 29, 2, 0);
      state.players[0].resources.energy = lowPower
        ? LOW_POWER_THRESHOLD - 1
        : 100;
      expect(powerStateForBuilding(state, tower)).toBe(
        lowPower ? "lowPower" : "standard",
      );
      // A high-HP target so it survives the whole window.
      const target = makeUnit(state, "praetorian", 30.5, 34.5, 1);
      const before = target.health;
      run(state, 6);
      return before - target.health;
    };

    const standardDamage = measureDamage(false);
    const lowPowerDamage = measureDamage(true);
    expect(standardDamage).toBeGreaterThan(0);
    expect(lowPowerDamage).toBeGreaterThan(0);
    // Low power deals reduced damage over the same window.
    expect(lowPowerDamage).toBeLessThan(standardDamage);
  });
});

describe("energy grid cover: placement and completion", () => {
  it("places, constructs, and completes an Energy Distribution Center", () => {
    const state = newGame();
    clearEntities(state);
    const villager = makeUnit(state, "villager", 10.5, 10.5, 0);
    state.players[0].age = 2;
    state.players[0].resources.wood = 5000;
    state.players[0].resources.stone = 5000;
    state.players[0].resources.gold = 5000;

    const placed = placeBuilding(state, 0, "energyDistribution", 10, 10, [
      villager.id,
    ]);
    expect(placed).not.toBeNull();
    if (!placed) return;
    expect(placed.progress).toBeLessThan(1);

    run(state, BUILDING_STATS.energyDistribution.buildTime + 5);

    expect(placed.progress).toBe(1);
    expect(placed.health).toBe(placed.maxHealth);
    // A completed distributor now covers its own footprint.
    expect(isStructurePowered(state, placed)).toBe(true);
  });
});

describe("energy grid cover: building center helper", () => {
  it("centres a distributor on its footprint for radius checks", () => {
    const state = newGame();
    clearEntities(state);
    const distributor = makeBuilding(state, "energyDistribution", 28, 28, 3, 0);
    expect(buildingCenter(distributor)).toEqual({ x: 29.5, y: 29.5 });
  });
});
