import { AiDifficulty, Faction, MapSize, MatchResult } from "@/backend";
import {
  BUILDING_STATS,
  CARRY_CAPACITY,
  POP_CEILING,
  TICK_SECONDS,
} from "@/game/constants";
import {
  advanceAge,
  buildingCost,
  cancelBuilding,
  createGame,
  enqueueUnit,
  factionEliteKind,
  getControlGroup,
  isFactionElite,
  issueAttack,
  issueGather,
  issueMove,
  placeBuilding,
  population,
  populationCap,
  recomputeFog,
  sellResource,
  setControlGroup,
  setStance,
  step,
  unitCost,
} from "@/game/engine";
import type { GameState } from "@/game/engine";
import type { Building, Unit } from "@/types/game";
import { describe, expect, it } from "vitest";

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

function playerUnits(state: GameState): Unit[] {
  return state.units.filter((u) => u.owner === 0);
}

function playerBuildings(state: GameState): Building[] {
  return state.buildings.filter((b) => b.owner === 0);
}

function run(state: GameState, seconds: number): void {
  const ticks = Math.ceil(seconds / TICK_SECONDS);
  for (let i = 0; i < ticks && !state.finished; i += 1) step(state);
}

describe("createGame", () => {
  it("spawns a starting town for both players with a Town Center, villagers, and a scout", () => {
    const state = newGame();
    for (const owner of [0, 1] as const) {
      const buildings = state.buildings.filter((b) => b.owner === owner);
      const units = state.units.filter((u) => u.owner === owner);
      expect(buildings.some((b) => b.kind === "townCenter")).toBe(true);
      expect(
        units.filter((u) => u.kind === "villager").length,
      ).toBeGreaterThanOrEqual(3);
      expect(units.some((u) => u.kind === "scout")).toBe(true);
    }
  });

  it("places the two players at separate corner start positions", () => {
    const state = newGame();
    const [a, b] = state.map.starts;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(20);
  });

  it("generates a large map with terrain, forests, and mineral deposits", () => {
    const state = newGame();
    expect(state.map.width).toBeGreaterThanOrEqual(72);
    expect(state.map.height).toBeGreaterThanOrEqual(72);
    expect(state.map.tiles.length).toBe(state.map.width * state.map.height);
    const kinds = new Set(state.map.nodes.map((n) => n.kind));
    expect(kinds.has("tree")).toBe(true);
    expect(kinds.has("gold")).toBe(true);
    expect(kinds.has("stone")).toBe(true);
    expect(kinds.has("forage")).toBe(true);
  });

  it("starts the player with the six tracked resources", () => {
    const state = newGame();
    expect(Object.keys(state.players[0].resources).sort()).toEqual(
      ["energy", "food", "gold", "money", "stone", "wood"].sort(),
    );
  });

  it("is deterministic for a given seed", () => {
    const a = newGame(99);
    const b = newGame(99);
    expect(a.map.nodes.map((n) => `${n.kind}:${n.x}:${n.y}`)).toEqual(
      b.map.nodes.map((n) => `${n.kind}:${n.x}:${n.y}`),
    );
  });
});

describe("fog of war", () => {
  it("marks tiles around the player's start visible and the far corner hidden", () => {
    const state = newGame();
    const start = state.map.starts[0];
    const visible =
      state.fog[Math.floor(start.y) * state.map.width + Math.floor(start.x)];
    expect(visible).toBe(2);

    const far = state.map.starts[1];
    const hidden =
      state.fog[Math.floor(far.y) * state.map.width + Math.floor(far.x)];
    expect(hidden).toBe(0);
  });

  it("downgrades visible tiles to explored once the player's units and buildings leave", () => {
    const state = newGame();
    const start = state.map.starts[0];
    const idx = Math.floor(start.y) * state.map.width + Math.floor(start.x);
    expect(state.fog[idx]).toBe(2);
    // Move every player unit and building far away, then recompute.
    const far = state.map.starts[1];
    for (const unit of playerUnits(state)) {
      unit.x = far.x;
      unit.y = far.y;
    }
    for (const building of playerBuildings(state)) {
      building.tx = Math.floor(far.x);
      building.ty = Math.floor(far.y);
    }
    recomputeFog(state);
    expect(state.fog[idx]).toBe(1);
  });
});

describe("gathering", () => {
  it("sends a villager to a forest and increases the Wood counter", () => {
    const state = newGame();
    const villager = playerUnits(state).find((u) => u.kind === "villager");
    expect(villager).toBeDefined();
    const tree = state.map.nodes.find((n) => n.kind === "tree");
    expect(tree).toBeDefined();
    if (!villager || !tree) return;

    const before = state.players[0].resources.wood;
    issueGather(state, [villager.id], tree.id, false);
    // The map is now far larger than the legacy 72x72 grid, so a villager
    // needs a longer budget to walk to a forest and haul the load back.
    run(state, 180);
    expect(state.players[0].resources.wood).toBeGreaterThan(before);
  });

  it("records a positive per-minute gather rate after a delivery", () => {
    const state = newGame();
    const villager = playerUnits(state).find((u) => u.kind === "villager");
    const tree = state.map.nodes.find((n) => n.kind === "tree");
    if (!villager || !tree) throw new Error("missing villager or tree");
    issueGather(state, [villager.id], tree.id, false);
    // The larger map makes the round trip long, and the rate is a rolling
    // 30-second window, so step until a delivery lands inside the window
    // rather than assuming a fixed completion time.
    const ticks = Math.ceil(300 / TICK_SECONDS);
    for (let i = 0; i < ticks; i += 1) {
      step(state);
      if (state.players[0].gatherRates.wood > 0) break;
    }
    expect(state.players[0].gatherRates.wood).toBeGreaterThan(0);
  });

  it("delivers a full load to the drop-off instead of walking back to the node", () => {
    const state = newGame();
    const villager = playerUnits(state).find((u) => u.kind === "villager");
    const tree = state.map.nodes.find((n) => n.kind === "tree");
    const tc = playerBuildings(state).find((b) => b.kind === "townCenter");
    if (!villager || !tree || !tc) throw new Error("missing setup");

    // A loaded villager standing at the drop-off, far from the resource node.
    // The delivery check must run before the node-distance branch, so it
    // deposits rather than turning around and oscillating.
    villager.x = tc.tx + tc.size / 2;
    villager.y = tc.ty + tc.size / 2;
    villager.carrying = CARRY_CAPACITY;
    villager.carryingKind = "wood";
    const before = state.players[0].resources.wood;
    issueGather(state, [villager.id], tree.id, false);

    step(state);

    expect(villager.carrying).toBe(0);
    expect(villager.carryingKind).toBeNull();
    expect(state.players[0].resources.wood).toBeGreaterThan(before);
  });

  it("delivers Food, Gold, and Stone loads as well as Wood", () => {
    const cases: ReadonlyArray<{
      nodeKind: "tree" | "forage" | "gold" | "stone";
      resource: "wood" | "food" | "gold" | "stone";
    }> = [
      { nodeKind: "tree", resource: "wood" },
      { nodeKind: "forage", resource: "food" },
      { nodeKind: "gold", resource: "gold" },
      { nodeKind: "stone", resource: "stone" },
    ];

    for (const { nodeKind, resource } of cases) {
      const state = newGame();
      const villager = playerUnits(state).find((u) => u.kind === "villager");
      const node = state.map.nodes.find((n) => n.kind === nodeKind);
      const tc = playerBuildings(state).find((b) => b.kind === "townCenter");
      if (!villager || !node || !tc) throw new Error(`missing ${nodeKind}`);

      villager.x = tc.tx + tc.size / 2;
      villager.y = tc.ty + tc.size / 2;
      villager.carrying = CARRY_CAPACITY;
      villager.carryingKind = resource;
      const before = state.players[0].resources[resource];
      issueGather(state, [villager.id], node.id, false);

      step(state);

      expect(villager.carrying).toBe(0);
      expect(state.players[0].resources[resource]).toBeGreaterThan(before);
    }
  });
});

describe("orders", () => {
  it("queues multiple orders with Shift and exposes the queue on the unit", () => {
    const state = newGame();
    const villager = playerUnits(state).find((u) => u.kind === "villager");
    if (!villager) throw new Error("no villager");
    issueMove(state, [villager.id], { x: 10, y: 10 }, false);
    issueMove(state, [villager.id], { x: 20, y: 20 }, true);
    issueMove(state, [villager.id], { x: 30, y: 30 }, true);
    expect(villager.orders).toHaveLength(3);
    expect(villager.orders.map((o) => o.type)).toEqual([
      "move",
      "move",
      "move",
    ]);
  });

  it("replaces the queue when an order is issued without Shift", () => {
    const state = newGame();
    const villager = playerUnits(state).find((u) => u.kind === "villager");
    if (!villager) throw new Error("no villager");
    issueMove(state, [villager.id], { x: 10, y: 10 }, false);
    issueMove(state, [villager.id], { x: 20, y: 20 }, false);
    expect(villager.orders).toHaveLength(1);
  });

  it("applies a stance to the selected units", () => {
    const state = newGame();
    const villager = playerUnits(state).find((u) => u.kind === "villager");
    if (!villager) throw new Error("no villager");
    setStance(state, [villager.id], "standGround");
    expect(villager.stance).toBe("standGround");
  });
});

describe("control groups", () => {
  it("assigns and recalls a control group", () => {
    const state = newGame();
    const ids = playerUnits(state).map((u) => u.id);
    setControlGroup(state, 1, ids);
    expect(getControlGroup(state, 1)).toEqual(ids);
    expect(getControlGroup(state, 2)).toEqual([]);
  });
});

describe("population", () => {
  it("raises the cap when a House completes", () => {
    const state = newGame();
    const before = populationCap(state, 0);
    const villager = playerUnits(state).find((u) => u.kind === "villager");
    if (!villager) throw new Error("no villager");

    // Find a buildable spot near the start and place a House.
    const start = state.map.starts[0];
    let placed: Building | null = null;
    for (let dx = -6; dx <= 6 && !placed; dx += 1) {
      for (let dy = -6; dy <= 6 && !placed; dy += 1) {
        placed = placeBuilding(
          state,
          0,
          "house",
          Math.floor(start.x) + dx,
          Math.floor(start.y) + dy,
          [villager.id],
        );
      }
    }
    expect(placed).not.toBeNull();
    run(state, 40);
    expect(populationCap(state, 0)).toBeGreaterThan(before);
  });

  it("never exceeds the population ceiling", () => {
    const state = newGame();
    // The ceiling is now the per-player lobby limit rather than a global
    // constant, so raise this player's limit to the maximum before pushing the
    // raw housing cap past it.
    state.players[0].populationLimit = POP_CEILING;
    // Add many completed Town Centers to push the raw housing cap past the
    // configured ceiling.
    for (let i = 0; i < 60; i += 1) {
      state.buildings.push({
        id: state.nextId++,
        owner: 0,
        kind: "townCenter",
        tx: 0,
        ty: 0,
        size: 4,
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
      });
    }
    expect(populationCap(state, 0)).toBe(POP_CEILING);
  });
});

describe("training", () => {
  it("trains a military unit at the Barracks that can be selected and ordered to attack", () => {
    const state = newGame();
    const villager = playerUnits(state).find((u) => u.kind === "villager");
    if (!villager) throw new Error("no villager");
    // Advance to age 2 so the Barracks is available.
    state.players[0].resources.food = 5000;
    state.players[0].resources.gold = 5000;
    state.players[0].resources.wood = 5000;
    state.players[0].resources.stone = 5000;
    expect(advanceAge(state, 0)).toBe(true);
    run(state, 50);
    expect(state.players[0].age).toBe(2);

    const start = state.map.starts[0];
    let barracks: Building | null = null;
    for (let dx = -8; dx <= 8 && !barracks; dx += 1) {
      for (let dy = -8; dy <= 8 && !barracks; dy += 1) {
        barracks = placeBuilding(
          state,
          0,
          "barracks",
          Math.floor(start.x) + dx,
          Math.floor(start.y) + dy,
          [villager.id],
        );
      }
    }
    expect(barracks).not.toBeNull();
    if (!barracks) return;
    run(state, 60);
    expect(barracks.progress).toBe(1);

    expect(enqueueUnit(state, barracks.id, "meleeInfantry")).toBe(true);
    run(state, 30);
    const soldier = playerUnits(state).find((u) => u.kind === "meleeInfantry");
    expect(soldier).toBeDefined();
    if (!soldier) return;

    const enemy = state.units.find((u) => u.owner === 1);
    if (!enemy) throw new Error("no enemy");
    issueAttack(state, [soldier.id], enemy.id, false);
    expect(soldier.orders[0]).toMatchObject({
      type: "attack",
      targetId: enemy.id,
    });
  });
});

describe("ages", () => {
  it("advances to the next age when resources are sufficient and unlocks new build options", () => {
    const state = newGame();
    state.players[0].resources.food = 5000;
    state.players[0].resources.gold = 5000;
    state.players[0].resources.stone = 5000;
    expect(advanceAge(state, 0)).toBe(true);
    run(state, 50);
    expect(state.players[0].age).toBe(2);
    // Barracks requires age 2; it was not placeable at age 1.
    expect(BUILDING_STATS.barracks.minAge).toBe(2);
  });

  it("refuses to advance without enough resources", () => {
    const state = newGame();
    state.players[0].resources.food = 0;
    state.players[0].resources.gold = 0;
    expect(advanceAge(state, 0)).toBe(false);
    expect(state.players[0].age).toBe(1);
  });
});

describe("faction elites", () => {
  it("maps each faction to its unique elite and marks only those kinds as elites", () => {
    expect(factionEliteKind(Faction.romans)).toBe("praetorian");
    expect(factionEliteKind(Faction.mongols)).toBe("keshig");
    expect(factionEliteKind(Faction.vikings)).toBe("huscarl");
    expect(isFactionElite("praetorian")).toBe(true);
    expect(isFactionElite("meleeInfantry")).toBe(false);
  });

  it("refuses to train another faction's elite at the Fortress", () => {
    const state = newGame();
    state.players[0].resources.food = 9000;
    state.players[0].resources.gold = 9000;
    state.players[0].resources.wood = 9000;
    state.players[0].resources.stone = 9000;
    state.players[0].resources.money = 9000;
    state.players[0].age = 4;
    const fortress: Building = {
      id: state.nextId++,
      owner: 0,
      kind: "fortress",
      tx: 0,
      ty: 0,
      size: 4,
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
    state.buildings.push(fortress);
    // Player is Romans, so the Keshig must be rejected.
    expect(enqueueUnit(state, fortress.id, "keshig")).toBe(false);
    expect(enqueueUnit(state, fortress.id, "praetorian")).toBe(true);
  });
});

describe("market", () => {
  it("sells a resource for Money only when a completed Market exists", () => {
    const state = newGame();
    expect(sellResource(state, 0, "wood", 100)).toBe(0);

    state.buildings.push({
      id: state.nextId++,
      owner: 0,
      kind: "market",
      tx: 0,
      ty: 0,
      size: 3,
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
    });
    const before = state.players[0].resources.wood;
    const money = sellResource(state, 0, "wood", 100);
    expect(money).toBeGreaterThan(0);
    expect(state.players[0].resources.wood).toBe(before - 100);
    expect(state.players[0].resources.money).toBe(money);
  });
});

describe("victory", () => {
  it("ends the match with a victory when the enemy loses all production", () => {
    const state = newGame();
    // Destroy every enemy production building.
    for (const b of state.buildings) {
      if (b.owner === 1 && BUILDING_STATS[b.kind].production) b.health = 0;
    }
    run(state, 1);
    expect(state.finished).toBe(true);
    expect(state.outcome?.result).toBe(MatchResult.victory);
  });
});

describe("costs", () => {
  it("scales unit and building costs by the faction multiplier", () => {
    const romans = unitCost("villager", Faction.romans);
    const mongols = unitCost("villager", Faction.mongols);
    expect(mongols.food).toBeLessThan(romans.food ?? 0);
    expect(buildingCost("house", Faction.mongols).wood).toBeLessThan(
      buildingCost("house", Faction.romans).wood ?? 0,
    );
  });
});

describe("cancelling construction", () => {
  it("refunds the cost and removes the foundation", () => {
    const state = newGame();
    const villager = playerUnits(state).find((u) => u.kind === "villager");
    if (!villager) throw new Error("no villager");
    const start = state.map.starts[0];
    let placed: Building | null = null;
    for (let dx = -6; dx <= 6 && !placed; dx += 1) {
      for (let dy = -6; dy <= 6 && !placed; dy += 1) {
        placed = placeBuilding(
          state,
          0,
          "house",
          Math.floor(start.x) + dx,
          Math.floor(start.y) + dy,
          [villager.id],
        );
      }
    }
    if (!placed) throw new Error("could not place house");
    const afterPay = state.players[0].resources.wood;
    cancelBuilding(state, placed.id);
    expect(state.players[0].resources.wood).toBeGreaterThan(afterPay);
    expect(state.buildings.some((b) => b.id === placed?.id)).toBe(false);
  });
});

describe("population used", () => {
  it("counts each unit's population cost", () => {
    const state = newGame();
    const used = population(state, 0).used;
    expect(used).toBeGreaterThan(0);
  });
});
