import { AiDifficulty, Faction, MapSize } from "@/backend";
import { TICK_SECONDS } from "@/game/constants";
import { useMatchStore } from "@/store/matchStore";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Characterization baseline for the match store's command seam.
 *
 * The request adds new systems (flow-field group movement, energy buildings,
 * market contracts, a 10-slot lobby) that all route their commands through this
 * store. This file freezes the store contract those systems build on: the
 * fixed-timestep `tick`, the HUD snapshot shape, and the command wrappers that
 * delegate to the engine. It does NOT assert anything about the new systems.
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

function start(seed = 4242): void {
  useMatchStore.getState().start(CONFIG, seed);
}

function game() {
  const state = useMatchStore.getState().game;
  if (!state) throw new Error("match did not start");
  return state;
}

describe("matchStore characterization", () => {
  beforeEach(() => {
    useMatchStore.getState().reset();
  });

  it("starts a match and exposes a HUD snapshot with the six resources", () => {
    start();
    const hud = useMatchStore.getState().hud;
    expect(hud).not.toBeNull();
    expect(Object.keys(hud?.resources ?? {}).sort()).toEqual(
      ["energy", "food", "gold", "money", "stone", "wood"].sort(),
    );
    expect(hud?.populationCap).toBeGreaterThan(0);
    expect(hud?.elapsed).toBe(0);
  });

  it("advances the simulation by fixed timesteps and bumps the revision", () => {
    start();
    const before = useMatchStore.getState().revision;
    const elapsedBefore = game().elapsed;

    // One second of frame time at the fixed timestep.
    useMatchStore.getState().tick(1);

    const state = useMatchStore.getState();
    expect(state.revision).toBe(before + 1);
    // The engine advances in whole TICK_SECONDS steps, so elapsed is a
    // multiple of the timestep and never overshoots the frame time.
    const advanced = state.game?.elapsed ?? 0;
    expect(advanced).toBeGreaterThan(elapsedBefore);
    expect(advanced).toBeLessThanOrEqual(elapsedBefore + 1 + TICK_SECONDS);
    expect(
      Math.abs(advanced / TICK_SECONDS - Math.round(advanced / TICK_SECONDS)),
    ).toBeLessThan(1e-9);
  });

  it("clamps a huge frame delta so a stalled tab cannot fast-forward the match", () => {
    start();
    const elapsedBefore = game().elapsed;
    // A 10-second stall must be clamped to the 0.25s ceiling.
    useMatchStore.getState().tick(10);
    const advanced = game().elapsed - elapsedBefore;
    expect(advanced).toBeLessThanOrEqual(0.25 + TICK_SECONDS);
  });

  it("is a no-op when no match is running", () => {
    useMatchStore.getState().reset();
    expect(() => useMatchStore.getState().tick(1)).not.toThrow();
    expect(useMatchStore.getState().game).toBeNull();
    expect(useMatchStore.getState().hud).toBeNull();
  });

  it("issues a move order through the store wrapper", () => {
    start();
    const villager = game().units.find(
      (u) => u.owner === 0 && u.kind === "villager",
    );
    if (!villager) throw new Error("no villager");

    useMatchStore.getState().move([villager.id], { x: 10, y: 10 }, false);
    expect(villager.orders[0]).toMatchObject({ type: "move" });
  });

  it("assigns and recalls a control group through the store", () => {
    start();
    const ids = game()
      .units.filter((u) => u.owner === 0)
      .map((u) => u.id);

    useMatchStore.getState().assignGroup(3, ids);
    expect(useMatchStore.getState().recallGroup(3)).toEqual(ids);
    expect(useMatchStore.getState().recallGroup(4)).toEqual([]);
  });

  it("applies a stance through the store wrapper", () => {
    start();
    const villager = game().units.find(
      (u) => u.owner === 0 && u.kind === "villager",
    );
    if (!villager) throw new Error("no villager");

    useMatchStore.getState().applyStance([villager.id], "standGround");
    expect(villager.stance).toBe("standGround");
  });

  it("reports affordability and faction-scaled costs from the live game", () => {
    start();
    const store = useMatchStore.getState();
    expect(store.canAfford({ food: 1 })).toBe(true);
    expect(store.canAfford({ food: 1_000_000 })).toBe(false);
    // Romans pay full price for a villager.
    expect(store.costOfUnit("villager").food).toBe(50);
  });

  it("returns safe defaults from command wrappers before a match starts", () => {
    useMatchStore.getState().reset();
    const store = useMatchStore.getState();
    expect(store.recallGroup(1)).toEqual([]);
    expect(store.train(1, "villager")).toBe(false);
    expect(store.advance()).toBe(false);
    expect(store.sell("wood", 10)).toBe(0);
    expect(store.upgradesFor(1)).toEqual([]);
    expect(store.costOfUnit("villager")).toEqual({});
    expect(store.costOfBuilding("house")).toEqual({});
  });
});
