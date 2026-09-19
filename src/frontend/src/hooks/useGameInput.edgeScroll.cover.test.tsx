import { AiDifficulty, Faction, MapSize } from "@/backend";
import { useGameInput } from "@/hooks/useGameInput";
import { useCameraStore } from "@/store/cameraStore";
import { useMatchStore } from "@/store/matchStore";
import { useSelectionStore } from "@/store/selectionStore";
import { act, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for edge-scroll camera panning.
 *
 * Moving the cursor within the edge zone (15-20px of a viewport border) must
 * pan the camera continuously in that direction, including diagonally at
 * corners, and stop once the cursor leaves the zone.
 */
const VIEWPORT = { width: 800, height: 600 };
const EDGE = 18;

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

function Harness({
  onReady,
}: { onReady: (input: ReturnType<typeof useGameInput>) => void }) {
  const input = useGameInput();
  const ref = useRef<HTMLCanvasElement | null>(null);
  ref.current = input.canvasRef.current;
  onReady(input);
  return (
    <canvas
      ref={input.canvasRef}
      data-testid="input-canvas"
      onPointerDown={input.onPointerDown}
      onPointerMove={input.onPointerMove}
      onPointerUp={input.onPointerUp}
      onPointerLeave={input.onPointerLeave}
      onWheel={input.onWheel}
      onContextMenu={input.onContextMenu}
    />
  );
}

function renderInput(): HTMLCanvasElement {
  let captured: ReturnType<typeof useGameInput> | null = null;
  render(
    <Harness
      onReady={(input) => {
        captured = input;
      }}
    />,
  );
  const canvas = document.querySelector(
    '[data-testid="input-canvas"]',
  ) as HTMLCanvasElement;
  if (!captured) throw new Error("hook did not mount");
  // jsdom reports zero layout size; give the canvas a real viewport so the
  // edge zones have meaningful coordinates.
  Object.defineProperty(canvas, "clientWidth", {
    configurable: true,
    value: VIEWPORT.width,
  });
  Object.defineProperty(canvas, "clientHeight", {
    configurable: true,
    value: VIEWPORT.height,
  });
  return canvas;
}

/** Advances the rAF-driven edge-scroll loop by a few frames. */
function advanceFrames(frames = 4): void {
  act(() => {
    vi.advanceTimersByTime(16 * frames);
  });
}

describe("useGameInput edge scroll cover", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useMatchStore.getState().reset();
    useSelectionStore.getState().clearSelection();
    useCameraStore.getState().setPosition(0, 0);
    useCameraStore.getState().setZoom(16);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pans left when the cursor sits within the left edge zone", () => {
    startMatch();
    const canvas = renderInput();
    useCameraStore.getState().setPosition(0, 0);

    fireEvent.pointerMove(canvas, {
      pointerId: 1,
      clientX: EDGE - 4,
      clientY: VIEWPORT.height / 2,
    });
    advanceFrames();

    expect(useCameraStore.getState().x).toBeLessThan(0);
    expect(useCameraStore.getState().y).toBe(0);
  });

  it("pans right when the cursor sits within the right edge zone", () => {
    startMatch();
    const canvas = renderInput();
    useCameraStore.getState().setPosition(0, 0);

    fireEvent.pointerMove(canvas, {
      pointerId: 1,
      clientX: VIEWPORT.width - (EDGE - 4),
      clientY: VIEWPORT.height / 2,
    });
    advanceFrames();

    expect(useCameraStore.getState().x).toBeGreaterThan(0);
  });

  it("pans diagonally when the cursor sits in a corner zone", () => {
    startMatch();
    const canvas = renderInput();
    useCameraStore.getState().setPosition(0, 0);

    fireEvent.pointerMove(canvas, {
      pointerId: 1,
      clientX: EDGE - 4,
      clientY: EDGE - 4,
    });
    advanceFrames();

    const camera = useCameraStore.getState();
    expect(camera.x).toBeLessThan(0);
    expect(camera.y).toBeLessThan(0);
  });

  it("stops panning once the cursor leaves the edge zone", () => {
    startMatch();
    const canvas = renderInput();
    useCameraStore.getState().setPosition(0, 0);

    fireEvent.pointerMove(canvas, {
      pointerId: 1,
      clientX: EDGE - 4,
      clientY: VIEWPORT.height / 2,
    });
    advanceFrames();
    const panned = useCameraStore.getState().x;
    expect(panned).toBeLessThan(0);

    // Move to the centre of the viewport, well outside every edge zone.
    fireEvent.pointerMove(canvas, {
      pointerId: 1,
      clientX: VIEWPORT.width / 2,
      clientY: VIEWPORT.height / 2,
    });
    advanceFrames();

    expect(useCameraStore.getState().x).toBe(panned);
  });

  it("stops panning when the pointer leaves the canvas", () => {
    startMatch();
    const canvas = renderInput();
    useCameraStore.getState().setPosition(0, 0);

    fireEvent.pointerMove(canvas, {
      pointerId: 1,
      clientX: EDGE - 4,
      clientY: VIEWPORT.height / 2,
    });
    advanceFrames();
    const panned = useCameraStore.getState().x;
    expect(panned).toBeLessThan(0);

    fireEvent.pointerLeave(canvas);
    advanceFrames();

    expect(useCameraStore.getState().x).toBe(panned);
  });
});
