import { AiDifficulty, Faction, MapSize } from "@/backend";
import { GameCanvas } from "@/components/game/GameCanvas";
import { useGameInput } from "@/hooks/useGameInput";
import { useCameraStore } from "@/store/cameraStore";
import { useMatchStore } from "@/store/matchStore";
import { useSelectionStore } from "@/store/selectionStore";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the continuous battlefield redraw.
 *
 * The canvas must keep drawing every animation frame so unit movement, combat,
 * and camera pans appear live without the loop pausing and resuming.
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

function startMatch(): void {
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
}

describe("GameCanvas cover: continuous redraw", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    renderGame.mockClear();
    useMatchStore.getState().reset();
    useSelectionStore.getState().clearSelection();
    useCameraStore.getState().setPosition(0, 0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws a new frame on every animation frame without restarting", () => {
    startMatch();
    render(<Harness />);

    // Let the first frame run.
    act(() => {
      vi.advanceTimersByTime(16);
    });
    const afterFirst = renderGame.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    // Several more frames must each produce another draw.
    act(() => {
      vi.advanceTimersByTime(16 * 5);
    });
    expect(renderGame.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it("keeps drawing after the camera moves, so pans appear live", () => {
    startMatch();
    render(<Harness />);

    act(() => {
      vi.advanceTimersByTime(16);
    });
    const before = renderGame.mock.calls.length;

    act(() => {
      useCameraStore.getState().pan(5, 5);
      vi.advanceTimersByTime(16 * 3);
    });

    expect(renderGame.mock.calls.length).toBeGreaterThan(before);
    // The latest frame observes the moved camera.
    const calls = renderGame.mock.calls;
    const lastCall = calls[calls.length - 1] as [
      CanvasRenderingContext2D,
      unknown,
      { camera: { x: number; y: number } },
      unknown,
    ];
    expect(lastCall[2].camera.x).toBe(5);
    expect(lastCall[2].camera.y).toBe(5);
  });
});
