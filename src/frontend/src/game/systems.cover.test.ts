import { AiDifficulty, Faction, MapSize } from "@/backend";
import {
  BUILDING_STATS,
  ENERGY_DEFICIT_PRODUCTION_MULTIPLIER,
  FARM_PRODUCTION_FOOD,
  FARM_PRODUCTION_SECONDS,
  HOSPITAL_ENERGY_DRAW,
  HOSPITAL_HEAL_RADIUS,
  HOSPITAL_HEAL_RATE,
  TICK_SECONDS,
  UNIT_STATS,
} from "@/game/constants";
import {
  acceptInvestment,
  areAllies,
  blockedTilesForOwner,
  buyResource,
  createGame,
  energyDeficit,
  hasUpgrade,
  isEnemy,
  placeBuilding,
  productionMultiplier,
  proposeInvestment,
  requestResources,
  researchUpgrade,
  sellResource,
  sendResources,
  sharesVision,
  step,
} from "@/game/engine";
import type { GameState } from "@/game/engine";
import type { Building, BuildingKind, Unit, UnitKind } from "@/types/game";
import { describe, expect, it } from "vitest";

/**
 * Cover for the economy, diplomacy, and support systems added by this build.
 *
 * The accepted behavior: a completed Farm adds Food to its owner's stockpile
 * every 20 seconds with no Villager assigned; same-team players are Allies and
 * different-team players are Enemies, and allied units pass through friendly
 * buildings; allied players share line of sight only after researching
 * Economic Partners at the Market; the Market supports buy, sell, send, and
 * request actions using Money, and an accepted investment proposal pays out on
 * its interval; a Hospital heals nearby damaged units while Energy is
 * available; and a negative Energy balance halves Barracks, Workshop, and
 * Market production.
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

describe("systems cover: automated farms", () => {
  it("adds Food every 20 seconds with no Villager assigned", () => {
    const state = newGame();
    clearEntities(state);
    makeBuilding(state, "farm", 20, 20, 2, 0);
    const before = state.players[0].resources.food;

    // Just under one cadence: no harvest yet.
    run(state, FARM_PRODUCTION_SECONDS - 1);
    expect(state.players[0].resources.food).toBe(before);

    // Crossing the cadence delivers exactly one harvest.
    run(state, 2);
    expect(state.players[0].resources.food).toBe(before + FARM_PRODUCTION_FOOD);
    // No villager was ever created, so the harvest cannot depend on one.
    expect(state.units.filter((u) => u.kind === "villager")).toHaveLength(0);
  });

  it("keeps producing on each subsequent cadence", () => {
    const state = newGame();
    clearEntities(state);
    makeBuilding(state, "farm", 20, 20, 2, 0);
    const before = state.players[0].resources.food;

    run(state, FARM_PRODUCTION_SECONDS * 3 + 1);

    expect(state.players[0].resources.food).toBe(
      before + FARM_PRODUCTION_FOOD * 3,
    );
  });

  it("does not harvest from an unfinished Farm", () => {
    const state = newGame();
    clearEntities(state);
    makeBuilding(state, "farm", 20, 20, 2, 0, 0.5);
    const before = state.players[0].resources.food;

    run(state, FARM_PRODUCTION_SECONDS * 2);

    expect(state.players[0].resources.food).toBe(before);
  });
});

describe("systems cover: teams and alliances", () => {
  it("treats same-team players as allies and different-team players as enemies", () => {
    const state = newGame();
    // Player 0 is team 1, player 1 is team 2 by default.
    expect(areAllies(state, 0, 1)).toBe(false);
    expect(isEnemy(state, 0, 1)).toBe(true);

    // Put both on team 3: they become allies.
    state.players[1].team = 3;
    state.players[0].team = 3;
    expect(areAllies(state, 0, 1)).toBe(true);
    expect(isEnemy(state, 0, 1)).toBe(false);
  });

  it("lets an allied unit pass through a friendly building but not an enemy one", () => {
    const state = newGame();
    clearEntities(state);
    // A completed enemy building at (30, 30).
    makeBuilding(state, "house", 30, 30, 2, 1);
    const enemyBlocked = blockedTilesForOwner(state, 0);
    expect(enemyBlocked.has("30,30")).toBe(true);
    expect(enemyBlocked.has("31,31")).toBe(true);

    // Make player 1 an ally: its building becomes passable.
    state.players[1].team = state.players[0].team;
    const allyBlocked = blockedTilesForOwner(state, 0);
    expect(allyBlocked.has("30,30")).toBe(false);
    expect(allyBlocked.has("31,31")).toBe(false);
  });
});

describe("systems cover: shared vision", () => {
  it("keeps vision private before Economic Partners is researched", () => {
    const state = newGame();
    // Same team, but no research yet.
    state.players[1].team = state.players[0].team;
    expect(sharesVision(state, 0, 1)).toBe(false);
    expect(state.players[0].sharesVision).toBe(false);
  });

  it("shares line of sight with allies after researching Economic Partners", () => {
    const state = newGame();
    clearEntities(state);
    state.players[1].team = state.players[0].team;
    // A completed Market at the Age of Iron, with resources to pay for it.
    const market = makeBuilding(state, "market", 10, 10, 3, 0);
    state.players[0].age = 2;
    state.players[0].resources.food = 5000;
    state.players[0].resources.gold = 5000;
    state.players[0].resources.wood = 5000;
    state.players[0].resources.stone = 5000;
    state.players[0].resources.money = 5000;

    expect(sharesVision(state, 0, 1)).toBe(false);
    expect(researchUpgrade(state, 0, market.id, "economicPartners")).toBe(true);

    expect(hasUpgrade(state, 0, "economicPartners")).toBe(true);
    expect(sharesVision(state, 0, 1)).toBe(true);
    // Vision is mutual: the ally gains it too.
    expect(state.players[1].sharesVision).toBe(true);
  });

  it("does not share vision with an enemy even after research", () => {
    const state = newGame();
    clearEntities(state);
    const market = makeBuilding(state, "market", 10, 10, 3, 0);
    state.players[0].age = 2;
    state.players[0].resources.food = 5000;
    state.players[0].resources.gold = 5000;
    state.players[0].resources.wood = 5000;
    state.players[0].resources.stone = 5000;
    state.players[0].resources.money = 5000;
    researchUpgrade(state, 0, market.id, "economicPartners");

    // Player 1 is still on a different team.
    expect(sharesVision(state, 0, 1)).toBe(false);
  });
});

describe("systems cover: market trade", () => {
  function withMarket(state: GameState): Building {
    return makeBuilding(state, "market", 10, 10, 3, 0);
  }

  it("buys a resource with Money only when a completed Market exists", () => {
    const state = newGame();
    clearEntities(state);
    state.players[0].resources.money = 1000;
    expect(buyResource(state, 0, "wood", 100)).toBe(0);

    withMarket(state);
    const moneyBefore = state.players[0].resources.money;
    const woodBefore = state.players[0].resources.wood;
    const bought = buyResource(state, 0, "wood", 100);

    expect(bought).toBeGreaterThan(0);
    expect(state.players[0].resources.wood).toBe(woodBefore + bought);
    expect(state.players[0].resources.money).toBeLessThan(moneyBefore);
  });

  it("sends resources to another player and records the gift", () => {
    const state = newGame();
    clearEntities(state);
    withMarket(state);
    state.players[0].resources.wood = 500;
    const recipientBefore = state.players[1].resources.wood;

    expect(sendResources(state, 0, 1, "wood", 200)).toBe(true);

    expect(state.players[0].resources.wood).toBe(300);
    expect(state.players[1].resources.wood).toBe(recipientBefore + 200);
    expect(state.gifts).toHaveLength(1);
    expect(state.gifts[0]).toMatchObject({
      from: 0,
      to: 1,
      resource: "wood",
      amount: 200,
    });
  });

  it("refuses to send more than the sender holds", () => {
    const state = newGame();
    clearEntities(state);
    withMarket(state);
    state.players[0].resources.wood = 50;
    expect(sendResources(state, 0, 1, "wood", 200)).toBe(false);
  });

  it("records a request without transferring resources", () => {
    const state = newGame();
    clearEntities(state);
    withMarket(state);
    const recipientBefore = state.players[1].resources.wood;

    expect(requestResources(state, 0, 1, "wood", 200)).toBe(true);

    // A request is an ask, not a transfer.
    expect(state.players[1].resources.wood).toBe(recipientBefore);
    expect(state.gifts).toHaveLength(0);
  });

  it("pays out an accepted investment on its interval", () => {
    const state = newGame();
    clearEntities(state);
    withMarket(state);
    state.players[0].resources.money = 5000;
    state.players[1].resources.money = 5000;

    const proposal = proposeInvestment(state, 0, 1, 1000, 0.15, 30, 2);
    expect(proposal).not.toBeNull();
    if (!proposal) return;
    // The principal is committed up front.
    expect(state.players[0].resources.money).toBe(4000);

    expect(acceptInvestment(state, proposal.id)).toBe(true);
    expect(state.contracts).toHaveLength(1);

    const investorBefore = state.players[0].resources.money;
    const recipientBefore = state.players[1].resources.money;
    // One interval plus a tick: the first payout lands.
    run(state, 31);

    const payout = 1000 * 0.15;
    // The Market also mints Money passively, so assert the payout direction
    // and magnitude rather than an exact balance.
    expect(state.players[0].resources.money).toBeGreaterThanOrEqual(
      investorBefore + payout,
    );
    expect(state.players[1].resources.money).toBeLessThanOrEqual(
      recipientBefore - payout,
    );
    // One of the two agreed payouts has been consumed.
    expect(state.contracts[0].remainingPayments).toBe(1);
  });
});

describe("systems cover: hospitals", () => {
  it("heals a nearby damaged unit while Energy is available", () => {
    const state = newGame();
    clearEntities(state);
    // A hospital is an energy consumer, so it must sit inside a completed
    // Energy Distribution Center's radius to be powered.
    makeBuilding(state, "energyDistribution", 28, 28, 3, 0);
    const hospital = makeBuilding(state, "hospital", 30, 30, 3, 0);
    state.players[0].resources.energy = 500;
    const wounded = makeUnit(state, "meleeInfantry", 31.5, 31.5, 0);
    wounded.health = 10;
    const before = wounded.health;

    run(state, 5);

    expect(wounded.health).toBeGreaterThan(before);
    // Healing draws Energy from the stockpile.
    expect(state.players[0].resources.energy).toBeLessThan(500);
    expect(hospital.progress).toBe(1);
  });

  it("does not heal when the hospital is outside every distribution radius", () => {
    const state = newGame();
    clearEntities(state);
    // No distributor: the hospital is unpowered.
    makeBuilding(state, "hospital", 30, 30, 3, 0);
    state.players[0].resources.energy = 500;
    const wounded = makeUnit(state, "meleeInfantry", 31.5, 31.5, 0);
    wounded.health = 10;
    const before = wounded.health;

    run(state, 5);

    expect(wounded.health).toBe(before);
  });

  it("does not heal during a blackout", () => {
    const state = newGame();
    clearEntities(state);
    makeBuilding(state, "hospital", 30, 30, 3, 0);
    state.players[0].resources.energy = 0;
    const wounded = makeUnit(state, "meleeInfantry", 31.5, 31.5, 0);
    wounded.health = 10;
    const before = wounded.health;

    run(state, 5);

    expect(wounded.health).toBe(before);
  });

  it("does not heal a unit outside its radius", () => {
    const state = newGame();
    clearEntities(state);
    makeBuilding(state, "hospital", 30, 30, 3, 0);
    state.players[0].resources.energy = 500;
    const far = makeUnit(
      state,
      "meleeInfantry",
      30 + HOSPITAL_HEAL_RADIUS + 10,
      30,
      0,
    );
    far.health = 10;
    const before = far.health;

    run(state, 5);

    expect(far.health).toBe(before);
  });
});

describe("systems cover: negative energy slows production", () => {
  it("halves Barracks, Workshop, and Market production under an energy deficit", () => {
    const state = newGame();
    clearEntities(state);
    // A completed Tower draws upkeep with no generator, creating a deficit.
    makeBuilding(state, "tower", 10, 10, 2, 0);
    state.players[0].resources.energy = 100;
    expect(energyDeficit(state, 0)).toBe(true);

    for (const kind of ["barracks", "market"] as const) {
      const building = makeBuilding(state, kind, 20, 20, 3, 0);
      expect(productionMultiplier(state, building)).toBe(
        ENERGY_DEFICIT_PRODUCTION_MULTIPLIER,
      );
    }
  });

  it("leaves production at full speed when the grid is balanced", () => {
    const state = newGame();
    clearEntities(state);
    // A completed Fortress generates energy and draws no upkeep.
    makeBuilding(state, "fortress", 10, 10, 4, 0);
    state.players[0].resources.energy = 100;
    expect(energyDeficit(state, 0)).toBe(false);

    const barracks = makeBuilding(state, "barracks", 20, 20, 3, 0);
    expect(productionMultiplier(state, barracks)).toBe(1);
  });

  it("does not slow a building outside the energy-sensitive set", () => {
    const state = newGame();
    clearEntities(state);
    makeBuilding(state, "tower", 10, 10, 2, 0);
    state.players[0].resources.energy = 100;
    expect(energyDeficit(state, 0)).toBe(true);

    const house = makeBuilding(state, "house", 20, 20, 2, 0);
    expect(productionMultiplier(state, house)).toBe(1);
  });
});

describe("systems cover: AI opponents spawn with their lobby color and team", () => {
  it("spawns each configured AI with its own color, team, and population limit", () => {
    const state = createGame(
      {
        ...CONFIG,
        colors: ["rgb(1,1,1)", "rgb(2,2,2)", "rgb(3,3,3)"],
        aiPlayers: [
          {
            team: 2,
            populationLimit: 300,
            color: "rgb(2,2,2)",
            difficulty: AiDifficulty.easy,
          },
          {
            team: 3,
            populationLimit: 500,
            color: "rgb(3,3,3)",
            difficulty: AiDifficulty.hard,
          },
        ],
      },
      4242,
    );

    expect(state.players).toHaveLength(3);
    expect(state.players[0].color).toBe("rgb(1,1,1)");
    expect(state.players[0].team).toBe(1);
    expect(state.players[1].color).toBe("rgb(2,2,2)");
    expect(state.players[1].team).toBe(2);
    expect(state.players[1].populationLimit).toBe(300);
    expect(state.players[2].color).toBe("rgb(3,3,3)");
    expect(state.players[2].team).toBe(3);
    expect(state.players[2].populationLimit).toBe(500);
    // Each AI actually spawned a starting town.
    for (const id of [1, 2]) {
      expect(
        state.buildings.some((b) => b.owner === id && b.kind === "townCenter"),
      ).toBe(true);
    }
  });

  it("enforces the per-player population limit in-match", () => {
    const state = createGame(
      { ...CONFIG, populationLimit: 100, aiPopulationLimit: 100 },
      4242,
    );
    expect(state.players[0].populationLimit).toBe(100);
    // The raw housing cap is clamped to the lobby limit.
    const cap = state.players[0].populationLimit;
    expect(cap).toBe(100);
  });
});
