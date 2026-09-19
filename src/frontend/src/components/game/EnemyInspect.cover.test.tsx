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
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for enemy-entity inspection.
 *
 * Left-clicking an enemy unit or building must select it for inspection only:
 * the bottom-left command panel shows its name, type, current/max HP with a
 * health bar, and its base attack/armor, and offers no action controls.
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

describe("enemy entity inspection", () => {
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

  it("selects an enemy unit for inspection and shows its stats with no actions", () => {
    const game = startMatch();
    const enemyStart = game.map.starts[1];
    useCameraStore.getState().setPosition(enemyStart.x, enemyStart.y);
    renderMatch();

    const enemy = game.units.find((u) => u.owner === 1);
    if (!enemy) throw new Error("no enemy unit");
    clickAt(enemy.x, enemy.y);

    expect(useSelectionStore.getState().inspectTarget).toEqual({
      kind: "unit",
      id: enemy.id,
    });
    // Inspection never mixes the enemy into the player's own selection.
    expect(useSelectionStore.getState().unitIds).toEqual([]);
    expect(useSelectionStore.getState().buildingId).toBeNull();

    const panel = document.querySelector('[data-ocid="hud.inspect_panel"]');
    expect(panel).toBeInTheDocument();
    expect(screen.getByText("Enemy Unit")).toBeInTheDocument();
    expect(screen.getByText(unitLabel(enemy.kind))).toBeInTheDocument();
    // Current/max HP with a health bar.
    expect(
      screen.getByText(`${Math.ceil(enemy.health)}/${enemy.maxHealth}`),
    ).toBeInTheDocument();
    // Base attack and armor values.
    const stats = UNIT_STATS[enemy.kind];
    const attackArmor = `ATK ${Math.round(stats.attack)} · ARM ${Math.round(
      stats.armor,
    )}`;
    expect(screen.getByText(attackArmor)).toBeInTheDocument();
    // No action controls are offered for an inspected enemy.
    expect(
      document.querySelector('[data-ocid="hud.inspect_notice"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="hud.tab.orders"]'),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="hud.tab.build"]'),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="hud.advance_age_button"]'),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="hud.stance.aggressive"]'),
    ).not.toBeInTheDocument();
  });

  it("selects an enemy building for inspection with no actions", () => {
    const game = startMatch();
    const enemyStart = game.map.starts[1];
    useCameraStore.getState().setPosition(enemyStart.x, enemyStart.y);
    renderMatch();

    const enemyBuilding = game.buildings.find((b) => b.owner === 1);
    if (!enemyBuilding) throw new Error("no enemy building");
    clickAt(
      enemyBuilding.tx + enemyBuilding.size / 2,
      enemyBuilding.ty + enemyBuilding.size / 2,
    );

    expect(useSelectionStore.getState().inspectTarget).toEqual({
      kind: "building",
      id: enemyBuilding.id,
    });
    expect(useSelectionStore.getState().unitIds).toEqual([]);
    expect(useSelectionStore.getState().buildingId).toBeNull();

    expect(
      document.querySelector('[data-ocid="hud.inspect_panel"]'),
    ).toBeInTheDocument();
    expect(screen.getByText("Enemy Building")).toBeInTheDocument();
    expect(
      screen.getByText(buildingLabel(enemyBuilding.kind)),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `${Math.ceil(enemyBuilding.health)}/${enemyBuilding.maxHealth}`,
      ),
    ).toBeInTheDocument();
    const stats = BUILDING_STATS[enemyBuilding.kind];
    expect(
      screen.getByText(`ATK ${Math.round(stats.attack)} · ARM 0`),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="hud.inspect_notice"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="hud.tab.orders"]'),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="hud.advance_age_button"]'),
    ).not.toBeInTheDocument();
  });

  it("clears the inspect target when clicking empty ground", () => {
    const game = startMatch();
    const enemyStart = game.map.starts[1];
    useCameraStore.getState().setPosition(enemyStart.x, enemyStart.y);
    renderMatch();

    const enemy = game.units.find((u) => u.owner === 1);
    if (!enemy) throw new Error("no enemy unit");
    clickAt(enemy.x, enemy.y);
    expect(useSelectionStore.getState().inspectTarget).not.toBeNull();

    // Empty ground far from any entity clears the inspection.
    clickAt(enemyStart.x + 30, enemyStart.y + 30);
    expect(useSelectionStore.getState().inspectTarget).toBeNull();
    expect(
      document.querySelector('[data-ocid="hud.inspect_panel"]'),
    ).not.toBeInTheDocument();
  });
});
