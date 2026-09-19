import { AiDifficulty, Faction, MapSize } from "@/backend";
import { MainMenuPage } from "@/pages/MainMenuPage";
import { useMatchSetupStore } from "@/store/matchSetupStore";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("MainMenuPage", () => {
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
      seed: 12345,
    });
  });

  it("renders the three factions, map sizes, and difficulties", async () => {
    renderMenu();
    expect(
      document.querySelector('[data-ocid="menu.faction.romans"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="menu.faction.mongols"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="menu.faction.vikings"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="menu.map_size.small"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="menu.map_size.medium"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="menu.map_size.large"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="menu.difficulty.easy"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="menu.difficulty.normal"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="menu.difficulty.hard"]'),
    ).toBeInTheDocument();
  });

  it("shows the empty campaign record when the backend has no history", async () => {
    renderMenu();
    expect(
      await screen.findByText(/No campaigns recorded yet/i, {
        selector: '[data-ocid="menu.stats.empty_state"]',
      }),
    ).toBeInTheDocument();
  });

  it("selects a faction and starts a skirmish with the chosen setup", async () => {
    const user = userEvent.setup();
    const onStartMatch = renderMenu();

    await user.click(
      document.querySelector('[data-ocid="menu.faction.mongols"]')!,
    );
    await user.click(
      document.querySelector('[data-ocid="menu.map_size.large"]')!,
    );
    await user.click(
      document.querySelector('[data-ocid="menu.difficulty.hard"]')!,
    );
    await user.click(
      screen.getByRole("button", { name: /Begin New Skirmish/i }),
    );

    expect(onStartMatch).toHaveBeenCalledTimes(1);
    const setup = useMatchSetupStore.getState();
    expect(setup.faction).toBe(Faction.mongols);
    expect(setup.mapSize).toBe(MapSize.large);
    expect(setup.difficulty).toBe(AiDifficulty.hard);
    await waitFor(() =>
      expect(actorMock.saveSettings).toHaveBeenCalledWith({
        preferredFaction: Faction.mongols,
        preferredDifficulty: AiDifficulty.hard,
        lastMapSize: MapSize.large,
      }),
    );
  });

  it("hydrates the setup from saved settings once", async () => {
    actorMock.getSettings.mockResolvedValue({
      preferredFaction: Faction.vikings,
      preferredDifficulty: AiDifficulty.easy,
      lastMapSize: MapSize.small,
    });
    renderMenu();
    await waitFor(() => {
      const setup = useMatchSetupStore.getState();
      expect(setup.faction).toBe(Faction.vikings);
      expect(setup.mapSize).toBe(MapSize.small);
      expect(setup.difficulty).toBe(AiDifficulty.easy);
    });
  });

  it("renders the campaign record when stats are available", async () => {
    actorMock.getMatchStats.mockResolvedValue({
      totalMatches: 4n,
      wins: 3n,
      losses: 1n,
      byFaction: [
        { faction: Faction.romans, totalMatches: 4n, wins: 3n, losses: 1n },
      ],
    });
    renderMenu();
    expect(await screen.findByText("75%")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
