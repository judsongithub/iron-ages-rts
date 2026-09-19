import { AiDifficulty, Faction, MapSize } from "@/backend";
import { GameCanvas } from "@/components/game/GameCanvas";
import { useGameInput } from "@/hooks/useGameInput";
import { useCameraStore } from "@/store/cameraStore";
import { useMatchStore } from "@/store/matchStore";
import { useSelectionStore } from "@/store/selectionStore";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization baseline for the battlefield canvas.
 *
 * The request intentionally restructures the render loop, so this file does
 * NOT assert the loop's effect dependencies, frame count, or rAF shape. It
 * protects the observable contract: the canvas mounts with its accessible
 * label, and a frame is drawn from live store state once a match exists.
 */
const renderGame = vi.fn();
vi.mock("@/game/renderer", () => ({
  renderGame: (...args: unknown[]) => renderGame(...args),
  renderMinimap: vi.fn(),
}));

function Harness() {
  const input = useGameInput();
  return (
    <GameCanvas input={input} pendingBuild={null} showFog renderDetail="high" />
  );
}

describe("GameCanvas characterization", () => {
  beforeEach(() => {
    renderGame.mockClear();
    useMatchStore.getState().reset();
    useSelectionStore.getState().clearSelection();
    useCameraStore.getState().setPosition(0, 0);
  });

  it("mounts a labelled battlefield canvas", () => {
    render(<Harness />);
    const canvas = document.querySelector('[data-ocid="game.canvas_target"]');
    expect(canvas).toBeInTheDocument();
    expect(canvas).toHaveAttribute("aria-label", "Battlefield view");
  });

  it("draws a frame from live store state once a match exists", async () => {
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
      4242,
    );
    render(<Harness />);

    await vi.waitFor(() => expect(renderGame).toHaveBeenCalled());
    const [ctx, state, options, viewport] = renderGame.mock.calls[0] as [
      CanvasRenderingContext2D,
      { map: { width: number } },
      { showFog: boolean; playerId: number },
      { width: number; height: number },
    ];
    expect(ctx).toBeTruthy();
    expect(state.map.width).toBeGreaterThan(0);
    expect(options.showFog).toBe(true);
    expect(options.playerId).toBe(0);
    expect(viewport.width).toBeGreaterThan(0);
    expect(viewport.height).toBeGreaterThan(0);
  });
});
