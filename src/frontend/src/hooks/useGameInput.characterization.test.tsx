import { AiDifficulty, Faction, MapSize } from "@/backend";
import type { GameState } from "@/game/engine";
import { useGameInput, worldToScreen } from "@/hooks/useGameInput";
import { useCameraStore } from "@/store/cameraStore";
import { useMatchStore } from "@/store/matchStore";
import { useSelectionStore } from "@/store/selectionStore";
import { act, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization baseline for the classic RTS control scheme.
 *
 * The request intentionally changes enemy-entity selection and the edge-scroll
 * constants, so this file deliberately does NOT assert that enemy entities are
 * unselectable or freeze the edge-scroll numbers. It protects the adjacent
 * behavior that must survive: own-unit/building selection, additive selection,
 * box-select, right-click context orders, control groups, stances, and
 * keyboard/middle-drag camera panning.
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

/** Mounts the hook and exposes its handlers plus the canvas it attaches to. */
function Harness({
  onReady,
}: { onReady: (input: ReturnType<typeof useGameInput>) => void }) {
  const input = useGameInput();
  const ref = useRef<HTMLCanvasElement | null>(null);
  // The hook owns its own canvasRef; mirror it onto a real canvas element.
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

function renderInput(): {
  input: ReturnType<typeof useGameInput>;
  canvas: HTMLCanvasElement;
} {
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
  return { input: captured, canvas };
}

function pointerDown(
  canvas: HTMLCanvasElement,
  init: {
    button: number;
    clientX: number;
    clientY: number;
    shiftKey?: boolean;
  },
): void {
  fireEvent.pointerDown(canvas, { pointerId: 1, ...init });
}

function pointerUp(
  canvas: HTMLCanvasElement,
  init: {
    button: number;
    clientX: number;
    clientY: number;
    shiftKey?: boolean;
  },
): void {
  fireEvent.pointerUp(canvas, { pointerId: 1, ...init });
}

describe("useGameInput characterization", () => {
  beforeEach(() => {
    useMatchStore.getState().reset();
    useSelectionStore.getState().clearSelection();
    useCameraStore.getState().setPosition(0, 0);
    useCameraStore.getState().setZoom(16);
  });

  it("selects an own unit on a left click and clears on empty ground", () => {
    const game = startMatch();
    const start = game.map.starts[0];
    useCameraStore.getState().setPosition(start.x, start.y);
    const { canvas } = renderInput();

    const villager = game.units.find(
      (u) => u.owner === 0 && u.kind === "villager",
    );
    if (!villager) throw new Error("no villager");

    const point = screenPoint(villager.x, villager.y);
    pointerDown(canvas, { button: 0, clientX: point.x, clientY: point.y });
    pointerUp(canvas, { button: 0, clientX: point.x, clientY: point.y });
    expect(useSelectionStore.getState().unitIds).toEqual([villager.id]);

    // Empty ground far from any entity clears the selection.
    const empty = screenPoint(start.x + 30, start.y + 30);
    pointerDown(canvas, { button: 0, clientX: empty.x, clientY: empty.y });
    pointerUp(canvas, { button: 0, clientX: empty.x, clientY: empty.y });
    expect(useSelectionStore.getState().unitIds).toEqual([]);
  });

  it("adds to the selection with Shift instead of replacing it", () => {
    const game = startMatch();
    const start = game.map.starts[0];
    useCameraStore.getState().setPosition(start.x, start.y);
    const { canvas } = renderInput();

    const villagers = game.units.filter(
      (u) => u.owner === 0 && u.kind === "villager",
    );
    if (villagers.length < 2) throw new Error("need two villagers");

    const first = screenPoint(villagers[0].x, villagers[0].y);
    pointerDown(canvas, { button: 0, clientX: first.x, clientY: first.y });
    pointerUp(canvas, { button: 0, clientX: first.x, clientY: first.y });

    const second = screenPoint(villagers[1].x, villagers[1].y);
    pointerDown(canvas, {
      button: 0,
      clientX: second.x,
      clientY: second.y,
      shiftKey: true,
    });
    pointerUp(canvas, {
      button: 0,
      clientX: second.x,
      clientY: second.y,
      shiftKey: true,
    });

    expect(useSelectionStore.getState().unitIds.sort()).toEqual(
      [villagers[0].id, villagers[1].id].sort(),
    );
  });

  it("box-selects every own unit inside the drag rectangle", () => {
    const game = startMatch();
    const start = game.map.starts[0];
    useCameraStore.getState().setPosition(start.x, start.y);
    const { canvas } = renderInput();

    const villagers = game.units.filter(
      (u) => u.owner === 0 && u.kind === "villager",
    );
    const xs = villagers.map((u) => u.x);
    const ys = villagers.map((u) => u.y);
    const min = screenPoint(Math.min(...xs) - 1, Math.min(...ys) - 1);
    const max = screenPoint(Math.max(...xs) + 1, Math.max(...ys) + 1);

    pointerDown(canvas, { button: 0, clientX: min.x, clientY: min.y });
    fireEvent.pointerMove(canvas, {
      pointerId: 1,
      clientX: max.x,
      clientY: max.y,
    });
    pointerUp(canvas, { button: 0, clientX: max.x, clientY: max.y });

    const selected = useSelectionStore.getState().unitIds;
    expect(selected.length).toBeGreaterThanOrEqual(villagers.length);
    for (const villager of villagers) {
      expect(selected).toContain(villager.id);
    }
  });

  it("selects an own building when no unit is under the cursor", () => {
    const game = startMatch();
    const start = game.map.starts[0];
    useCameraStore.getState().setPosition(start.x, start.y);
    const { canvas } = renderInput();

    const tc = game.buildings.find(
      (b) => b.owner === 0 && b.kind === "townCenter",
    );
    if (!tc) throw new Error("no town center");
    const point = screenPoint(tc.tx + tc.size / 2, tc.ty + tc.size / 2);

    pointerDown(canvas, { button: 0, clientX: point.x, clientY: point.y });
    pointerUp(canvas, { button: 0, clientX: point.x, clientY: point.y });

    expect(useSelectionStore.getState().buildingId).toBe(tc.id);
    expect(useSelectionStore.getState().unitIds).toEqual([]);
  });

  it("issues a move order on right-click ground and queues with Shift", () => {
    const game = startMatch();
    const start = game.map.starts[0];
    useCameraStore.getState().setPosition(start.x, start.y);
    const { canvas } = renderInput();

    const villager = game.units.find(
      (u) => u.owner === 0 && u.kind === "villager",
    );
    if (!villager) throw new Error("no villager");
    useSelectionStore.getState().setSelection([villager.id], null);

    const first = screenPoint(start.x + 4, start.y + 4);
    pointerDown(canvas, { button: 2, clientX: first.x, clientY: first.y });
    expect(villager.orders).toHaveLength(1);
    expect(villager.orders[0]).toMatchObject({ type: "move" });

    const second = screenPoint(start.x + 8, start.y + 8);
    pointerDown(canvas, {
      button: 2,
      clientX: second.x,
      clientY: second.y,
      shiftKey: true,
    });
    expect(villager.orders).toHaveLength(2);
  });

  it("issues a gather order when right-clicking a resource node", () => {
    const game = startMatch();
    const start = game.map.starts[0];
    useCameraStore.getState().setPosition(start.x, start.y);
    const { canvas } = renderInput();

    const villager = game.units.find(
      (u) => u.owner === 0 && u.kind === "villager",
    );
    const tree = game.map.nodes.find((n) => n.kind === "tree");
    if (!villager || !tree) throw new Error("missing villager or tree");
    useSelectionStore.getState().setSelection([villager.id], null);

    const point = screenPoint(tree.x, tree.y);
    pointerDown(canvas, { button: 2, clientX: point.x, clientY: point.y });

    expect(villager.orders[0]).toMatchObject({
      type: "gather",
      nodeId: tree.id,
    });
  });

  it("assigns and recalls a control group from the keyboard", () => {
    const game = startMatch();
    const villager = game.units.find(
      (u) => u.owner === 0 && u.kind === "villager",
    );
    if (!villager) throw new Error("no villager");
    renderInput();
    useSelectionStore.getState().setSelection([villager.id], null);

    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    expect(useMatchStore.getState().recallGroup(1)).toEqual([villager.id]);

    useSelectionStore.getState().clearSelection();
    fireEvent.keyDown(window, { key: "1" });
    expect(useSelectionStore.getState().unitIds).toEqual([villager.id]);
  });

  it("applies a stance hotkey to the selected units", () => {
    const game = startMatch();
    const villager = game.units.find(
      (u) => u.owner === 0 && u.kind === "villager",
    );
    if (!villager) throw new Error("no villager");
    renderInput();
    useSelectionStore.getState().setSelection([villager.id], null);

    fireEvent.keyDown(window, { key: "s" });
    expect(villager.stance).toBe("standGround");
    expect(useSelectionStore.getState().stance).toBe("standGround");
  });

  it("pans the camera with arrow keys", () => {
    vi.useFakeTimers();
    try {
      startMatch();
      renderInput();
      useCameraStore.getState().setPosition(0, 0);

      fireEvent.keyDown(window, { key: "ArrowRight" });
      // The edge-scroll effect runs on rAF; jsdom's rAF is a setTimeout.
      act(() => {
        vi.advanceTimersByTime(64);
      });
      fireEvent.keyUp(window, { key: "ArrowRight" });

      expect(useCameraStore.getState().x).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pans the camera with a middle-mouse drag", () => {
    startMatch();
    const { canvas } = renderInput();
    useCameraStore.getState().setPosition(0, 0);

    pointerDown(canvas, { button: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(canvas, {
      pointerId: 1,
      clientX: 440,
      clientY: 300,
    });
    pointerUp(canvas, { button: 1, clientX: 440, clientY: 300 });

    // Dragging right moves the world left, so the camera x decreases.
    expect(useCameraStore.getState().x).toBeLessThan(0);
  });

  it("zooms toward the cursor on wheel and clamps at the zoom limits", () => {
    startMatch();
    const { canvas } = renderInput();
    useCameraStore.getState().setPosition(0, 0);
    useCameraStore.getState().setZoom(16);

    fireEvent.wheel(canvas, { deltaY: -100, clientX: 400, clientY: 300 });
    expect(useCameraStore.getState().zoom).toBeGreaterThan(16);

    for (let i = 0; i < 40; i += 1) {
      fireEvent.wheel(canvas, { deltaY: -100, clientX: 400, clientY: 300 });
    }
    expect(useCameraStore.getState().zoom).toBeLessThanOrEqual(34);
  });
});
