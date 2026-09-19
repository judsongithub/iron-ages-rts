import { AiDifficulty, Faction, MapSize, MatchResult } from "@/backend";
import { GameOverPage } from "@/pages/GameOverPage";
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
  recordMatch: vi.fn(),
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

describe("GameOverPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actorMock.listRecentMatches.mockResolvedValue([]);
    actorMock.getMatchStats.mockResolvedValue(null);
    actorMock.recordMatch.mockResolvedValue(undefined);
    useMatchSetupStore.setState({
      faction: Faction.romans,
      mapSize: MapSize.medium,
      difficulty: AiDifficulty.normal,
      seed: 1,
    });
  });

  it("shows a victory summary and records the match once", async () => {
    render(
      <GameOverPage
        outcome={{ result: MatchResult.victory, durationSeconds: 125 }}
        onPlayAgain={vi.fn()}
        onReturnToMenu={vi.fn()}
      />,
      { wrapper },
    );

    expect(screen.getByText("Victory")).toBeInTheDocument();
    expect(screen.getByText("02:05")).toBeInTheDocument();
    await waitFor(() =>
      expect(actorMock.recordMatch).toHaveBeenCalledWith(
        Faction.romans,
        MapSize.medium,
        AiDifficulty.normal,
        MatchResult.victory,
        125n,
      ),
    );
    expect(actorMock.recordMatch).toHaveBeenCalledTimes(1);
  });

  it("shows a defeat summary", () => {
    render(
      <GameOverPage
        outcome={{ result: MatchResult.defeat, durationSeconds: 60 }}
        onPlayAgain={vi.fn()}
        onReturnToMenu={vi.fn()}
      />,
      { wrapper },
    );
    expect(screen.getByText("Defeat")).toBeInTheDocument();
  });

  it("invokes the play-again and menu callbacks", async () => {
    const user = userEvent.setup();
    const onPlayAgain = vi.fn();
    const onReturnToMenu = vi.fn();
    render(
      <GameOverPage
        outcome={{ result: MatchResult.victory, durationSeconds: 10 }}
        onPlayAgain={onPlayAgain}
        onReturnToMenu={onReturnToMenu}
      />,
      { wrapper },
    );

    await user.click(screen.getByRole("button", { name: /Play Again/i }));
    await user.click(
      screen.getByRole("button", { name: /Return to Main Menu/i }),
    );
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
    expect(onReturnToMenu).toHaveBeenCalledTimes(1);
  });

  it("renders the record and recent engagements from the backend", async () => {
    actorMock.getMatchStats.mockResolvedValue({
      totalMatches: 2n,
      wins: 1n,
      losses: 1n,
      byFaction: [
        { faction: Faction.romans, totalMatches: 2n, wins: 1n, losses: 1n },
      ],
    });
    actorMock.listRecentMatches.mockResolvedValue([
      {
        id: 7n,
        faction: Faction.romans,
        mapSize: MapSize.medium,
        difficulty: AiDifficulty.normal,
        result: MatchResult.victory,
        durationSeconds: 300n,
        recordedAt: 1_700_000_000_000_000_000n,
      },
    ]);

    render(
      <GameOverPage
        outcome={{ result: MatchResult.victory, durationSeconds: 300 }}
        onPlayAgain={vi.fn()}
        onReturnToMenu={vi.fn()}
      />,
      { wrapper },
    );

    expect(await screen.findByText("50%")).toBeInTheDocument();
    expect(await screen.findByText("Win")).toBeInTheDocument();
    const recentList = document.querySelector(
      '[data-ocid="gameover.recent.list"]',
    );
    expect(recentList?.textContent).toContain("05:00");
  });

  it("stays usable when the backend is unreachable", async () => {
    actorMock.getMatchStats.mockRejectedValue(new Error("offline"));
    actorMock.listRecentMatches.mockRejectedValue(new Error("offline"));
    actorMock.recordMatch.mockRejectedValue(new Error("offline"));

    render(
      <GameOverPage
        outcome={{ result: MatchResult.defeat, durationSeconds: 30 }}
        onPlayAgain={vi.fn()}
        onReturnToMenu={vi.fn()}
      />,
      { wrapper },
    );

    expect(screen.getByText("Defeat")).toBeInTheDocument();
    expect(
      await screen.findByText(/No record available yet/i),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/No engagements on record/i),
    ).toBeInTheDocument();
  });
});
