import { AiDifficulty, Faction, MapSize } from "@/backend";
import { BUILDING_STATS, UNIT_STATS } from "@/game/constants";
import { buildingLabel, unitLabel } from "@/game/engine";
import type { GameState } from "@/game/engine";
import { worldToScreen } from "@/hooks/useGameInput";
import { MatchPage } from "@/pages/MatchPage";
import { useCameraStore } from "@/store/cameraStore";
import { useMatchSetupStore } from "@/store/matchSetupStore";
import { useMatchStore } from "@/store/matchStore";
import { useSelectionStore } from "@/store/selectionStore";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the Energy Grid user-facing surfaces.
 *
 * The accepted behavior: the Energy Distribution Center appears in the villager
 * build menu from the Age of Iron with its distribution radius in the tooltip;
 * the inspection panel reports an unpowered consumer with a clear status and
 * shows a signed energy draw; a resource node reports 0 E/sec; and left-clicking
 * a completed distributor selects it while clicking empty terrain clears it.
 */
const VIEWPORT = { width: 800, height: 600 };

function startMatch(seed = 4242): GameState {
  useMatchStore.getState().start(
    {
      faction: Faction.romans,
      mapSize: MapSize.small,
      difficulty: AiDifficulty.normal,
      playerTeam: 1,
      aiTeam: 2,
      populationLimit: 200,
      aiPopulationLimit: 200,
    },
    seed,
  );
  const game = useMatchStore.getState().game;
  if (!game) throw new Error("match did not start");
  return game;
}

function screenPoint(worldX: number, worldY: number): { x: number; y: number } {
  const camera = useCameraStore.getState();
  const p = worldToScreen(worldX, worldY, camera, VIEWPORT);
  return { x: p.x, y: p.y };
}

function canvas(): HTMLCanvasElement {
  const el = document.querySelector('[data-ocid="game.canvas_target"]');
  if (!(el instanceof HTMLCanvasElement)) throw new Error("no canvas");
  return el;
}

function clickAt(worldX: number, worldY: number): void {
  const point = screenPoint(worldX, worldY);
  const el = canvas();
  fireEvent.pointerDown(el, {
    button: 0,
    pointerId: 1,
    clientX: point.x,
    clientY: point.y,
  });
  fireEvent.pointerUp(el, {
    button: 0,
    pointerId: 1,
    clientX: point.x,
    clientY: point.y,
  });
}

function renderMatch(): void {
  render(<MatchPage onExitToMenu={vi.fn()} onRestart={vi.fn()} />);
}

describe("energy grid cover: build menu", () => {
  beforeEach(() => {
    useMatchStore.getState().reset();
    useSelectionStore.getState().clearSelection();
    useMatchSetupStore.setState({
      faction: Faction.romans,
      mapSize: MapSize.small,
      difficulty: AiDifficulty.normal,
      seed: 4242,
    });
    useCameraStore.getState().setPosition(0, 0);
  });

  it("offers the Energy Distribution Center from the Age of Iron with its radius in the tooltip", async () => {
    const game = startMatch();
    const start = game.map.starts[0];
    useCameraStore.getState().setPosition(start.x, start.y);
    // Advance to the Age of Iron so the building is unlocked.
    game.players[0].age = 2;
    // Grant enough resources that the button is enabled rather than gated on cost.
    game.players[0].resources.wood = 1000;
    game.players[0].resources.stone = 1000;
    game.players[0].resources.gold = 1000;
    renderMatch();

    const villager = game.units.find(
      (u) => u.owner === 0 && u.kind === "villager",
    );
    if (!villager) throw new Error("no villager");
    act(() => {
      useSelectionStore.getState().setSelection([villager.id], null);
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Build$/i }));

    const button = document.querySelector(
      '[data-ocid="hud.build.energyDistribution"]',
    );
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("Energy Distribution Center");
    const radius = BUILDING_STATS.energyDistribution.distributionRadius;
    expect(button).toHaveAttribute(
      "title",
      expect.stringContaining(`Distribution radius ${radius} units`),
    );
    expect(button).not.toBeDisabled();
  });

  it("does not offer the Energy Distribution Center at the Age of Settlement", async () => {
    const game = startMatch();
    const start = game.map.starts[0];
    useCameraStore.getState().setPosition(start.x, start.y);
    // Age 1: the building is not yet available.
    expect(game.players[0].age).toBe(1);
    renderMatch();

    const villager = game.units.find(
      (u) => u.owner === 0 && u.kind === "villager",
    );
    if (!villager) throw new Error("no villager");
    act(() => {
      useSelectionStore.getState().setSelection([villager.id], null);
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Build$/i }));

    // The build menu only lists structures unlocked at the current age, so the
    // Age-of-Iron distributor is absent rather than present-but-disabled.
    expect(
      document.querySelector('[data-ocid="hud.build.energyDistribution"]'),
    ).not.toBeInTheDocument();
  });
});

describe("energy grid cover: inspection panel power state", () => {
  beforeEach(() => {
    useMatchStore.getState().reset();
    useSelectionStore.getState().clearSelection();
    useMatchSetupStore.setState({
      faction: Faction.romans,
      mapSize: MapSize.small,
      difficulty: AiDifficulty.normal,
      seed: 4242,
    });
    useCameraStore.getState().setPosition(0, 0);
  });

  it("reports an unpowered energy-consuming building with a clear status", () => {
    const game = startMatch();
    // Replace the map with a single enemy Tower far from any distributor.
    game.units = [];
    game.buildings = [];
    const tower = {
      id: game.nextId++,
      owner: 1 as const,
      kind: "tower" as const,
      tx: 30,
      ty: 30,
      size: 2,
      health: 700,
      maxHealth: 700,
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
    game.buildings.push(tower);
    useCameraStore.getState().setPosition(31, 31);
    renderMatch();

    clickAt(31, 31);

    expect(useSelectionStore.getState().inspectTarget).toEqual({
      kind: "building",
      id: tower.id,
    });
    expect(
      document.querySelector('[data-ocid="hud.inspect_panel"]'),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Unpowered — outside distribution grid"),
    ).toBeInTheDocument();
  });

  it("shows a signed energy draw for an inspected energy-consuming unit", () => {
    const game = startMatch();
    game.units = [];
    game.buildings = [];
    const siege = {
      id: game.nextId++,
      owner: 1 as const,
      kind: "siege" as const,
      x: 30.5,
      y: 30.5,
      health: UNIT_STATS.siege.maxHealth,
      maxHealth: UNIT_STATS.siege.maxHealth,
      stance: "aggressive" as const,
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
    game.units.push(siege);
    useCameraStore.getState().setPosition(30.5, 30.5);
    renderMatch();

    clickAt(30.5, 30.5);

    expect(useSelectionStore.getState().inspectTarget).toEqual({
      kind: "unit",
      id: siege.id,
    });
    const draw = document.querySelector(
      '[data-ocid="hud.inspect_energy_draw"]',
    );
    expect(draw).toBeInTheDocument();
    // Siege upkeep is 6/s, so the signed draw is negative.
    expect(draw).toHaveTextContent(`-${UNIT_STATS.siege.energyUpkeep} E/sec`);
  });

  it("shows 0 E/sec for an inspected resource node", () => {
    const game = startMatch();
    const node = game.map.nodes.find((n) => n.kind === "tree");
    if (!node) throw new Error("no tree node");
    useCameraStore.getState().setPosition(node.x, node.y);
    renderMatch();

    clickAt(node.x, node.y);

    expect(useSelectionStore.getState().inspectTarget).toEqual({
      kind: "node",
      id: node.id,
    });
    expect(
      document.querySelector('[data-ocid="hud.inspect_panel"]'),
    ).toBeInTheDocument();
    expect(screen.getByText("Resource Node")).toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="hud.inspect_energy_draw"]'),
    ).toHaveTextContent("0 E/sec");
  });
});

describe("energy grid cover: distributor selection journey", () => {
  beforeEach(() => {
    useMatchStore.getState().reset();
    useSelectionStore.getState().clearSelection();
    useMatchSetupStore.setState({
      faction: Faction.romans,
      mapSize: MapSize.small,
      difficulty: AiDifficulty.normal,
      seed: 4242,
    });
    useCameraStore.getState().setPosition(0, 0);
  });

  it("selects a completed distributor on left-click and clears on empty ground", () => {
    const game = startMatch();
    game.units = [];
    game.buildings = [];
    const distributor = {
      id: game.nextId++,
      owner: 0 as const,
      kind: "energyDistribution" as const,
      tx: 28,
      ty: 28,
      size: 3,
      health: BUILDING_STATS.energyDistribution.maxHealth,
      maxHealth: BUILDING_STATS.energyDistribution.maxHealth,
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
    game.buildings.push(distributor);
    useCameraStore.getState().setPosition(29.5, 29.5);
    renderMatch();

    clickAt(29.5, 29.5);
    expect(useSelectionStore.getState().buildingId).toBe(distributor.id);
    expect(
      screen.getByText(buildingLabel("energyDistribution")),
    ).toBeInTheDocument();

    // Clicking empty ground far from any entity clears the selection.
    clickAt(60, 60);
    expect(useSelectionStore.getState().buildingId).toBeNull();
  });

  it("shows the distributor's own power state as standard when covered", () => {
    const game = startMatch();
    game.units = [];
    game.buildings = [];
    const distributor = {
      id: game.nextId++,
      owner: 0 as const,
      kind: "energyDistribution" as const,
      tx: 28,
      ty: 28,
      size: 3,
      health: BUILDING_STATS.energyDistribution.maxHealth,
      maxHealth: BUILDING_STATS.energyDistribution.maxHealth,
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
    game.buildings.push(distributor);
    // A completed Tower inside the distributor's radius.
    const tower = {
      id: game.nextId++,
      owner: 0 as const,
      kind: "tower" as const,
      tx: 33,
      ty: 29,
      size: 2,
      health: BUILDING_STATS.tower.maxHealth,
      maxHealth: BUILDING_STATS.tower.maxHealth,
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
    game.buildings.push(tower);
    // Keep the stockpile healthy so the grid is not in blackout.
    game.players[0].resources.energy = 100;
    useCameraStore.getState().setPosition(34, 30);
    renderMatch();

    clickAt(34, 30);

    expect(useSelectionStore.getState().buildingId).toBe(tower.id);
    const powerState = document.querySelector(
      '[data-ocid="hud.building_power_state"]',
    );
    expect(powerState).toBeInTheDocument();
    // The Tower is inside the distributor's radius, so it is not unpowered.
    expect(powerState).not.toHaveTextContent(
      "Unpowered — outside distribution grid",
    );
  });
});
