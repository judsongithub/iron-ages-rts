import { AiDifficulty, Faction, MapSize } from "@/backend";
import { AgeIndicator } from "@/components/game/AgeIndicator";
import { Minimap } from "@/components/game/Minimap";
import { ResourceBar } from "@/components/game/ResourceBar";
import { useCameraStore } from "@/store/cameraStore";
import { useMatchStore } from "@/store/matchStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Characterization baseline for the existing HUD chrome the Energy Grid update
 * must not disturb.
 *
 * The request intentionally changes selection overlays and the entity
 * inspection panel, so this file does NOT touch those. It freezes the adjacent
 * top-bar and minimap readouts: the age indicator, the six-resource bar with
 * its per-minute rates, and the minimap's click-to-move-camera contract.
 */

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

describe("AgeIndicator characterization", () => {
  it("shows the current age numeral and name", () => {
    render(<AgeIndicator age={2} progress={0} advancing={false} />);
    expect(
      document.querySelector('[data-ocid="hud.age_indicator"]'),
    ).toBeInTheDocument();
    expect(screen.getByText("II")).toBeInTheDocument();
    expect(screen.getByText("Iron")).toBeInTheDocument();
  });

  it("shows an advancement progress bar only while advancing", () => {
    const { rerender } = render(
      <AgeIndicator age={1} progress={0.5} advancing={false} />,
    );
    expect(screen.getByText("Settlement")).toBeInTheDocument();
    // No progress bar when not advancing.
    expect(document.querySelectorAll("span[style]")).toHaveLength(0);

    rerender(<AgeIndicator age={1} progress={0.5} advancing />);
    const bar = document.querySelector("span[style]") as HTMLElement | null;
    expect(bar).not.toBeNull();
    expect(bar?.style.width).toBe("50%");
  });
});

describe("ResourceBar characterization", () => {
  it("renders all six resources with their amounts and per-minute rates", () => {
    render(
      <ResourceBar
        resources={{
          food: 300,
          wood: 300,
          gold: 150,
          stone: 100,
          money: 0,
          energy: 0,
        }}
        gatherRates={{
          food: 0,
          wood: 12.3,
          gold: 0,
          stone: 0,
          money: 0,
          energy: 0,
        }}
      />,
    );

    for (const kind of ["food", "wood", "gold", "stone", "money", "energy"]) {
      expect(
        document.querySelector(`[data-ocid="hud.resource.${kind}"]`),
      ).toBeInTheDocument();
    }
    // Scope to each resource cell: several resources share the amount 300.
    const food = document.querySelector('[data-ocid="hud.resource.food"]');
    expect(food).toHaveTextContent("300");
    const wood = document.querySelector('[data-ocid="hud.resource.wood"]');
    expect(wood).toHaveTextContent("300");
    expect(wood).toHaveTextContent("+12.3/m");
  });
});

describe("Minimap characterization", () => {
  beforeEach(() => {
    useMatchStore.getState().reset();
    useCameraStore.getState().setPosition(0, 0);
  });

  it("jumps the camera to the clicked world position", () => {
    startMatch();
    render(<Minimap showFog />);

    const canvas = document.querySelector(
      '[data-ocid="hud.minimap"]',
    ) as HTMLCanvasElement;
    expect(canvas).toBeInTheDocument();
    expect(canvas).toHaveAttribute(
      "aria-label",
      "Minimap — click to move the camera",
    );

    // jsdom reports a zero-size rect; stub it so the click maps to a known
    // fraction of the map. Clicking the centre should land near the middle.
    canvas.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 200,
        height: 200,
        right: 200,
        bottom: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });

    const game = useMatchStore.getState().game;
    if (!game) throw new Error("match did not start");
    expect(useCameraStore.getState().x).toBeCloseTo(game.map.width / 2, 5);
    expect(useCameraStore.getState().y).toBeCloseTo(game.map.height / 2, 5);
  });
});
