import { AiDifficulty, Faction, MapSize } from "@/backend";
import type { GameState } from "@/game/engine";
import { worldToScreen } from "@/hooks/useGameInput";
import { MatchPage } from "@/pages/MatchPage";
import { useCameraStore } from "@/store/cameraStore";
import { useMatchSetupStore } from "@/store/matchSetupStore";
import { useMatchStore } from "@/store/matchStore";
import { useSelectionStore } from "@/store/selectionStore";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

/** Screen-space point for a world position under the current camera. */
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

function renderMatch() {
  const onExitToMenu = vi.fn();
  const onRestart = vi.fn();
  render(<MatchPage onExitToMenu={onExitToMenu} onRestart={onRestart} />);
  return { onExitToMenu, onRestart };
}

describe("MatchPage", () => {
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

  it("renders the HUD with the six resources, population, clock, minimap, and command panel", () => {
    const game = startMatch();
    useCameraStore
      .getState()
      .setPosition(game.map.starts[0].x, game.map.starts[0].y);
    renderMatch();

    expect(
      document.querySelector('[data-ocid="hud.resource_bar"]'),
    ).toBeInTheDocument();
    for (const kind of ["food", "wood", "gold", "stone", "money", "energy"]) {
      expect(
        document.querySelector(`[data-ocid="hud.resource.${kind}"]`),
      ).toBeInTheDocument();
    }
    expect(
      document.querySelector('[data-ocid="hud.population"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="hud.clock"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="hud.minimap"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="hud.command_panel"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="hud.command_panel.empty_state"]'),
    ).toBeInTheDocument();
  });

  it("box-selects villagers with a drag and shows them in the command panel", () => {
    const game = startMatch();
    const start = game.map.starts[0];
    useCameraStore.getState().setPosition(start.x, start.y);
    renderMatch();

    const villagers = game.units.filter(
      (u) => u.owner === 0 && u.kind === "villager",
    );
    expect(villagers.length).toBeGreaterThan(0);
    const xs = villagers.map((u) => u.x);
    const ys = villagers.map((u) => u.y);
    const min = screenPoint(Math.min(...xs) - 1, Math.min(...ys) - 1);
    const max = screenPoint(Math.max(...xs) + 1, Math.max(...ys) + 1);

    const el = canvas();
    fireEvent.pointerDown(el, {
      button: 0,
      pointerId: 1,
      clientX: min.x,
      clientY: min.y,
    });
    fireEvent.pointerMove(el, {
      pointerId: 1,
      clientX: max.x,
      clientY: max.y,
    });
    fireEvent.pointerUp(el, {
      button: 0,
      pointerId: 1,
      clientX: max.x,
      clientY: max.y,
    });

    const selected = useSelectionStore.getState().unitIds;
    expect(selected.length).toBeGreaterThanOrEqual(villagers.length);
    expect(
      document.querySelector('[data-ocid="hud.command_panel.empty_state"]'),
    ).not.toBeInTheDocument();
  });

  it("right-clicks a forest to gather Wood and the Wood counter increases", async () => {
    const game = startMatch();
    const start = game.map.starts[0];
    useCameraStore.getState().setPosition(start.x, start.y);
    renderMatch();

    const villager = game.units.find(
      (u) => u.owner === 0 && u.kind === "villager",
    );
    const tree = game.map.nodes.find((n) => n.kind === "tree");
    if (!villager || !tree) throw new Error("missing villager or tree");

    useSelectionStore.getState().setSelection([villager.id], null);
    const point = screenPoint(tree.x, tree.y);
    fireEvent.pointerDown(canvas(), {
      button: 2,
      pointerId: 2,
      clientX: point.x,
      clientY: point.y,
    });

    expect(villager.orders[0]).toMatchObject({
      type: "gather",
      nodeId: tree.id,
    });

    const before =
      useMatchStore.getState().game?.players[0].resources.wood ?? 0;
    // Drive the simulation directly; the rAF loop is not deterministic in jsdom.
    for (let i = 0; i < 20 * 90; i += 1) {
      useMatchStore.getState().tick(1 / 20);
    }
    await waitFor(() =>
      expect(
        useMatchStore.getState().game?.players[0].resources.wood ?? 0,
      ).toBeGreaterThan(before),
    );
  });

  it("queues multiple orders with Shift and shows the order queue indicator", () => {
    const game = startMatch();
    const start = game.map.starts[0];
    useCameraStore.getState().setPosition(start.x, start.y);
    renderMatch();

    const villager = game.units.find(
      (u) => u.owner === 0 && u.kind === "villager",
    );
    if (!villager) throw new Error("no villager");
    useSelectionStore.getState().setSelection([villager.id], null);

    const first = screenPoint(start.x + 4, start.y + 4);
    const second = screenPoint(start.x + 8, start.y + 8);
    const el = canvas();
    fireEvent.pointerDown(el, {
      button: 2,
      pointerId: 3,
      clientX: first.x,
      clientY: first.y,
    });
    fireEvent.pointerDown(el, {
      button: 2,
      pointerId: 4,
      shiftKey: true,
      clientX: second.x,
      clientY: second.y,
    });

    expect(villager.orders.length).toBe(2);
    // The order-queue indicator is derived from a store revision, which only
    // advances on a simulation tick; flush the resulting render inside act.
    act(() => {
      useMatchStore.getState().tick(1 / 20);
    });
    expect(
      document.querySelector('[data-ocid="hud.order_queue"]'),
    ).toBeInTheDocument();
  });

  it("assigns a control group with Ctrl+1 and recalls it with 1", async () => {
    const game = startMatch();
    const start = game.map.starts[0];
    useCameraStore.getState().setPosition(start.x, start.y);
    renderMatch();

    const villager = game.units.find(
      (u) => u.owner === 0 && u.kind === "villager",
    );
    if (!villager) throw new Error("no villager");
    useSelectionStore.getState().setSelection([villager.id], null);

    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    expect(useMatchStore.getState().recallGroup(1)).toEqual([villager.id]);

    useSelectionStore.getState().clearSelection();
    fireEvent.keyDown(window, { key: "1" });
    expect(useSelectionStore.getState().unitIds).toEqual([villager.id]);
  });

  it("opens the pause menu and wires Resume, Restart, and Return to Menu", async () => {
    const game = startMatch();
    useCameraStore
      .getState()
      .setPosition(game.map.starts[0].x, game.map.starts[0].y);
    const { onExitToMenu, onRestart } = renderMatch();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /^Pause$/i }));
    expect(
      document.querySelector('[data-ocid="pause.modal"]'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Resume$/i }));
    expect(
      document.querySelector('[data-ocid="pause.modal"]'),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Pause$/i }));
    await user.click(screen.getByRole("button", { name: /Restart Match/i }));
    expect(onRestart).toHaveBeenCalledTimes(1);

    await user.click(
      screen.getByRole("button", { name: /Return to Main Menu/i }),
    );
    expect(onExitToMenu).toHaveBeenCalledTimes(1);
  });
});
