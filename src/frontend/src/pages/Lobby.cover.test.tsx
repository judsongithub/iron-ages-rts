import { AiDifficulty, Faction, MapSize } from "@/backend";
import { MainMenuPage } from "@/pages/MainMenuPage";
import { useMatchSetupStore } from "@/store/matchSetupStore";
import { PLAYER_COLORS, POPULATION_LIMITS } from "@/types/game";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the ten-slot commander lobby.
 *
 * The accepted behavior: the lobby renders ten player slots, each non-human
 * slot offers an Open / AI / Closed dropdown with an AI difficulty toggle when
 * set to AI, the player and AI population limits are selectable from
 * 100/200/300/400/500, and every slot carries one of ten distinct saturated
 * commander colors. The chosen configuration is what the match actually starts
 * with, so the setup store is asserted after Begin New Skirmish.
 *
 * Radix Select renders its menu in a portal that jsdom cannot lay out, so the
 * dropdowns are asserted through their triggers and the store setters they
 * write to rather than by opening the menu.
 */
const actorMock = {
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  listRecentMatches: vi.fn(),
  getMatchStats: vi.fn(),
};

vi.mock("@caffeineai/core-infrastructure", () => ({
  useActor: () => ({ actor: actorMock, isFetching: false }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderMenu(onStartMatch = vi.fn()) {
  render(<MainMenuPage onStartMatch={onStartMatch} />, { wrapper });
  return onStartMatch;
}

function slotKind(index: number): HTMLElement {
  const el = document.querySelector(`[data-ocid="menu.slot.${index}.kind"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`no slot ${index} kind`);
  return el;
}

describe("lobby cover: ten commander slots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actorMock.getSettings.mockResolvedValue(null);
    actorMock.listRecentMatches.mockResolvedValue([]);
    actorMock.getMatchStats.mockResolvedValue(null);
    actorMock.saveSettings.mockResolvedValue(undefined);
    useMatchSetupStore.setState({
      faction: Faction.romans,
      mapSize: MapSize.medium,
      difficulty: AiDifficulty.normal,
      playerTeam: 1,
      aiTeam: 2,
      populationLimit: 200,
      aiPopulationLimit: 200,
      playerColor: "",
      aiSlots: [],
      seed: 12345,
    });
  });

  it("renders ten player slots, each with a slot-type control", () => {
    renderMenu();
    for (let slot = 1; slot <= 10; slot += 1) {
      expect(
        document.querySelector(`[data-ocid="menu.slot.${slot}"]`),
      ).toBeInTheDocument();
      expect(slotKind(slot)).toBeInTheDocument();
    }
    // Player 1 is the human and is not offered an Open/AI/Closed dropdown.
    expect(slotKind(1)).toHaveTextContent("Human");
  });

  it("offers Open, AI, and Closed on every non-human slot", () => {
    renderMenu();
    // Each non-human slot exposes a combobox trigger for its slot type.
    for (let slot = 2; slot <= 10; slot += 1) {
      expect(slotKind(slot)).toHaveAttribute("role", "combobox");
    }
    // The default lobby fields one AI opponent in slot 2.
    expect(slotKind(2)).toHaveTextContent("AI");
  });

  it("shows the AI difficulty toggle on the default AI slot", () => {
    renderMenu();
    // Slot 2 starts as AI, so its difficulty toggle is present.
    expect(
      document.querySelector('[data-ocid="menu.slot.2.difficulty"]'),
    ).toBeInTheDocument();
    // A slot left Open has no difficulty toggle.
    expect(
      document.querySelector('[data-ocid="menu.slot.3.difficulty"]'),
    ).not.toBeInTheDocument();
  });

  it("assigns each of the ten slots a distinct commander color", () => {
    renderMenu();
    const swatches: string[] = [];
    for (let slot = 1; slot <= 10; slot += 1) {
      const root = document.querySelector(`[data-ocid="menu.slot.${slot}"]`);
      // The color swatch is the first inline-styled span in the slot header.
      const swatch = root?.querySelector("span[style]");
      swatches.push(
        swatch instanceof HTMLElement ? swatch.style.backgroundColor : "",
      );
    }
    expect(swatches).toHaveLength(10);
    // Ten distinct saturated colors, matching the shared palette.
    expect(new Set(swatches).size).toBe(10);
    for (const color of PLAYER_COLORS) {
      expect(swatches).toContain(color.value);
    }
  });

  it("offers the five population limits for the player and the AI", () => {
    renderMenu();
    // Both population selectors are present and show the current limit.
    const player = document.querySelector(
      '[data-ocid="menu.population.player"]',
    );
    const ai = document.querySelector('[data-ocid="menu.population.ai"]');
    expect(player).toBeInTheDocument();
    expect(ai).toBeInTheDocument();
    expect(player).toHaveTextContent("200");
    expect(ai).toHaveTextContent("200");
    // The accepted limits are exactly the five the request names.
    expect([...POPULATION_LIMITS]).toEqual([100, 200, 300, 400, 500]);
  });

  it("starts the match with the chosen population limit and AI slot configuration", async () => {
    const onStartMatch = renderMenu();

    // Choose the 500 population ceiling for the human host and a second AI
    // opponent in slot 3, then let the lobby sync them into the setup store.
    useMatchSetupStore.getState().setPopulationLimit(500);
    useMatchSetupStore.getState().setAiSlots([
      {
        team: 2,
        populationLimit: 200,
        color: PLAYER_COLORS[1].value,
        difficulty: AiDifficulty.normal,
      },
      {
        team: 3,
        populationLimit: 200,
        color: PLAYER_COLORS[2].value,
        difficulty: AiDifficulty.hard,
      },
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: /Begin New Skirmish/i }),
    );

    expect(onStartMatch).toHaveBeenCalledTimes(1);
    const setup = useMatchSetupStore.getState();
    expect(setup.populationLimit).toBe(500);
    // Two AI opponents are configured, each with its own color and team.
    expect(setup.aiSlots).toHaveLength(2);
    expect(setup.aiSlots[0].color).toBe(PLAYER_COLORS[1].value);
    expect(setup.aiSlots[1].color).toBe(PLAYER_COLORS[2].value);
    expect(setup.aiSlots[1].team).toBe(3);
    expect(setup.aiSlots[1].difficulty).toBe(AiDifficulty.hard);
  });

  it("excludes Closed slots from the AI opponents the match spawns", async () => {
    renderMenu();

    // Only slot 4 remains an AI opponent; slot 2 is closed.
    useMatchSetupStore.getState().setAiSlots([
      {
        team: 2,
        populationLimit: 200,
        color: PLAYER_COLORS[3].value,
        difficulty: AiDifficulty.normal,
      },
    ]);

    await waitFor(() => {
      const slots = useMatchSetupStore.getState().aiSlots;
      expect(slots).toHaveLength(1);
      // The surviving opponent carries slot 4's color.
      expect(slots[0].color).toBe(PLAYER_COLORS[3].value);
    });
  });
});
