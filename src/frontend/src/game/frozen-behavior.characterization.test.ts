import { AiDifficulty, Faction, MapSize } from "@/backend";
import {
  FORTRESS_ENERGY_RATE,
  MARKET_MONEY_RATE,
  TICK_SECONDS,
  UNIT_STATS,
} from "@/game/constants";
import {
  createGame,
  energyDeficit,
  issueAttack,
  recomputeFog,
  step,
} from "@/game/engine";
import type { GameState } from "@/game/engine";
import type { Building, Unit, UnitKind } from "@/types/game";
import { describe, expect, it } from "vitest";

/**
 * Characterization baseline for the Iron Ages systems the Energy Grid update
 * must not disturb.
 *
 * The request intentionally changes energy generation/consumption, weapon fire
 * rates and damage under low power, selection overlays, and the entity
 * inspection panel. This file therefore does NOT assert energy production,
 * energy upkeep, the deficit slow factor, or combat damage. It freezes the
 * adjacent systems named in the request: fog reveal radii, passive Market
 * income, and the fixed-timestep simulation contract.
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
 * Removes every entity so a test can place exactly the one it needs, then
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

function fogAt(state: GameState, x: number, y: number): number {
  return state.fog[Math.floor(y) * state.map.width + Math.floor(x)];
}

function makeBuilding(
  state: GameState,
  kind: Building["kind"],
  tx: number,
  ty: number,
  size: number,
  owner: 0 | 1 = 0,
): Building {
  const building: Building = {
    id: state.nextId++,
    owner,
    kind,
    tx,
    ty,
    size,
    health: 100,
    maxHealth: 100,
    progress: 1,
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

describe("fog reveal radii characterization", () => {
  it("reveals tiles within a unit's sight radius and leaves the rest hidden", () => {
    const state = newGame();
    clearEntities(state);
    // A lone unit at a known tile, far from both starts.
    const cx = 30;
    const cy = 30;
    state.units.push({
      id: state.nextId++,
      owner: 0,
      kind: "villager",
      x: cx + 0.5,
      y: cy + 0.5,
      health: 40,
      maxHealth: 40,
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
    });

    recomputeFog(state);

    // The unit's own tile is visible.
    expect(fogAt(state, cx, cy)).toBe(2);
    // A tile just inside the radius (distance 6) is visible.
    expect(fogAt(state, cx + 6, cy)).toBe(2);
    // A tile just outside the radius (distance 8) stays hidden.
    expect(fogAt(state, cx + 8, cy)).toBe(0);
    // A diagonal tile at distance ~7.07 is outside the Euclidean radius.
    expect(fogAt(state, cx + 5, cy + 5)).toBe(0);
  });

  it("reveals a larger radius around a building, scaled by its footprint", () => {
    const state = newGame();
    clearEntities(state);
    // A 4x4 building centred at (30, 30) reveals within 8 + size = 12.
    makeBuilding(state, "townCenter", 28, 28, 4);

    recomputeFog(state);

    // Centre tile visible.
    expect(fogAt(state, 30, 30)).toBe(2);
    // Just inside the building radius (distance 11) is visible.
    expect(fogAt(state, 30 + 11, 30)).toBe(2);
    // Just outside (distance 13) stays hidden.
    expect(fogAt(state, 30 + 13, 30)).toBe(0);
  });

  it("downgrades visible tiles to explored rather than hidden on recompute", () => {
    const state = newGame();
    clearEntities(state);
    const cx = 30;
    const cy = 30;
    state.units.push({
      id: state.nextId++,
      owner: 0,
      kind: "scout",
      x: cx + 0.5,
      y: cy + 0.5,
      health: 70,
      maxHealth: 70,
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
    });
    recomputeFog(state);
    expect(fogAt(state, cx, cy)).toBe(2);

    // Remove the unit and recompute: the tile is remembered, not forgotten.
    state.units = [];
    recomputeFog(state);
    expect(fogAt(state, cx, cy)).toBe(1);
  });
});

describe("market passive income characterization", () => {
  it("accrues Money over time from a completed Market", () => {
    const state = newGame();
    clearEntities(state);
    makeBuilding(state, "market", 30, 30, 3);
    const before = state.players[0].resources.money;

    const seconds = 20;
    const ticks = Math.ceil(seconds / TICK_SECONDS);
    for (let i = 0; i < ticks; i += 1) step(state);

    const gained = state.players[0].resources.money - before;
    expect(gained).toBeGreaterThan(0);
    // Roughly MARKET_MONEY_RATE per second; allow a tick of slack.
    expect(gained).toBeGreaterThan(MARKET_MONEY_RATE * seconds * 0.9);
    expect(gained).toBeLessThan(MARKET_MONEY_RATE * seconds * 1.1);
  });

  it("does not generate Money from an unfinished Market", () => {
    const state = newGame();
    clearEntities(state);
    const market = makeBuilding(state, "market", 30, 30, 3);
    market.progress = 0.5;
    const before = state.players[0].resources.money;

    for (let i = 0; i < 20 * 10; i += 1) step(state);

    expect(state.players[0].resources.money).toBe(before);
  });
});

describe("fixed-timestep simulation contract", () => {
  it("advances elapsed time by exactly one tick per step", () => {
    const state = newGame();
    const before = state.elapsed;
    step(state);
    expect(state.elapsed).toBeCloseTo(before + TICK_SECONDS, 10);
  });

  it("keeps a completed Fortress producing energy at the configured rate", () => {
    // Energy *generation* semantics are intentionally changing, but the
    // fortress-as-generator contract is the seam the Energy Grid builds on.
    // This asserts only that a completed Fortress adds FORTRESS_ENERGY_RATE
    // per second, not the pool/upkeep arithmetic around it.
    const state = newGame();
    clearEntities(state);
    makeBuilding(state, "fortress", 30, 30, 4);
    const before = state.players[0].resources.energy;

    const seconds = 20;
    for (let i = 0; i < Math.ceil(seconds / TICK_SECONDS); i += 1) step(state);

    const gained = state.players[0].resources.energy - before;
    expect(gained).toBeGreaterThan(FORTRESS_ENERGY_RATE * seconds * 0.9);
    expect(gained).toBeLessThan(FORTRESS_ENERGY_RATE * seconds * 1.1);
  });
});

describe("physical weapons during an energy blackout characterization", () => {
  /**
   * The Energy Grid update intentionally changes weapon fire rates and damage
   * under low/zero power, so this file does NOT freeze the combat numbers of
   * energy-consuming units. It protects the adjacent invariant the project
   * guidance states: physical (non-energy) weapons keep working during a
   * blackout. A unit with `energyUpkeep === 0` must still deal damage while its
   * owner is in energy deficit.
   */
  it("keeps a non-energy unit dealing damage while its owner is in deficit", () => {
    const state = newGame();
    clearEntities(state);

    // A completed Fortress generates energy; a Siege engine consumes it. With
    // no generator and one energy-consuming unit, the owner is in deficit.
    const siege = makeUnit(state, "siege", 30.5, 30.5, 0);
    expect(UNIT_STATS.siege.energyUpkeep).toBeGreaterThan(0);
    expect(energyDeficit(state, 0)).toBe(true);

    // A physical melee unit with no energy upkeep, adjacent to an enemy.
    const soldier = makeUnit(state, "meleeInfantry", 30.5, 31.5, 0);
    expect(UNIT_STATS.meleeInfantry.energyUpkeep).toBe(0);
    const target = makeUnit(state, "villager", 30.5, 32.5, 1);
    const before = target.health;

    issueAttack(state, [soldier.id], target.id, false);
    for (let i = 0; i < 40; i += 1) step(state);

    // The physical attacker still lands damage during the blackout.
    expect(target.health).toBeLessThan(before);
    // The energy-consuming unit is the one the deficit slows, not the physical
    // one; the siege engine is present only to create the deficit.
    expect(siege.health).toBeGreaterThan(0);
  });

  it("does not slow a non-energy unit's movement during a deficit", () => {
    const state = newGame();
    clearEntities(state);
    makeUnit(state, "siege", 30.5, 30.5, 0);
    expect(energyDeficit(state, 0)).toBe(true);

    const soldier = makeUnit(state, "meleeInfantry", 10.5, 10.5, 0);
    const startX = soldier.x;
    soldier.orders = [{ type: "move", x: 20.5, y: 10.5 }];
    for (let i = 0; i < 20; i += 1) step(state);

    // A full-speed physical unit covers roughly speed * seconds; the deficit
    // slow factor (0.55) would leave it far short of that.
    const travelled = soldier.x - startX;
    const fullSpeedDistance = UNIT_STATS.meleeInfantry.speed * 1;
    expect(travelled).toBeGreaterThan(fullSpeedDistance * 0.8);
  });
});
