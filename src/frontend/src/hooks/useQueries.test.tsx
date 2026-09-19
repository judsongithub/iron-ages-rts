import { AiDifficulty, Faction, MapSize, MatchResult } from "@/backend";
import {
  useMatchStats,
  usePlayerSettings,
  useRecentMatches,
  useRecordMatch,
  useSaveSettings,
} from "@/hooks/useQueries";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
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

describe("useQueries backend consumer contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actorMock.getSettings.mockResolvedValue(null);
    actorMock.listRecentMatches.mockResolvedValue([]);
    actorMock.getMatchStats.mockResolvedValue(null);
    actorMock.saveSettings.mockResolvedValue(undefined);
    actorMock.recordMatch.mockResolvedValue(0n);
  });

  it("passes the recent-match limit as a bigint", async () => {
    const { result } = renderHook(() => useRecentMatches(5), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(actorMock.listRecentMatches).toHaveBeenCalledWith(5n);
  });

  it("converts a match duration in seconds to a bigint for recordMatch", async () => {
    const { result } = renderHook(() => useRecordMatch(), { wrapper });
    result.current.mutate({
      faction: Faction.romans,
      mapSize: MapSize.medium,
      difficulty: AiDifficulty.normal,
      result: MatchResult.victory,
      durationSeconds: 125.6,
    });
    await waitFor(() => expect(actorMock.recordMatch).toHaveBeenCalledTimes(1));
    expect(actorMock.recordMatch).toHaveBeenCalledWith(
      Faction.romans,
      MapSize.medium,
      AiDifficulty.normal,
      MatchResult.victory,
      126n,
    );
  });

  it("clamps a negative duration to zero rather than sending a negative bigint", async () => {
    const { result } = renderHook(() => useRecordMatch(), { wrapper });
    result.current.mutate({
      faction: Faction.vikings,
      mapSize: MapSize.small,
      difficulty: AiDifficulty.easy,
      result: MatchResult.defeat,
      durationSeconds: -10,
    });
    await waitFor(() => expect(actorMock.recordMatch).toHaveBeenCalledTimes(1));
    expect(actorMock.recordMatch).toHaveBeenCalledWith(
      Faction.vikings,
      MapSize.small,
      AiDifficulty.easy,
      MatchResult.defeat,
      0n,
    );
  });

  it("degrades to empty reads when the backend rejects", async () => {
    actorMock.getSettings.mockRejectedValue(new Error("offline"));
    actorMock.listRecentMatches.mockRejectedValue(new Error("offline"));
    actorMock.getMatchStats.mockRejectedValue(new Error("offline"));

    const settings = renderHook(() => usePlayerSettings(), { wrapper });
    const recent = renderHook(() => useRecentMatches(), { wrapper });
    const stats = renderHook(() => useMatchStats(), { wrapper });

    await waitFor(() => expect(settings.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(recent.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(stats.result.current.isSuccess).toBe(true));

    expect(settings.result.current.data).toBeNull();
    expect(recent.result.current.data).toEqual([]);
    expect(stats.result.current.data).toBeNull();
  });

  it("sends the full settings object through saveSettings", async () => {
    const { result } = renderHook(() => useSaveSettings(), { wrapper });
    result.current.mutate({
      preferredFaction: Faction.mongols,
      preferredDifficulty: AiDifficulty.hard,
      lastMapSize: MapSize.large,
    });
    await waitFor(() =>
      expect(actorMock.saveSettings).toHaveBeenCalledTimes(1),
    );
    expect(actorMock.saveSettings).toHaveBeenCalledWith({
      preferredFaction: Faction.mongols,
      preferredDifficulty: AiDifficulty.hard,
      lastMapSize: MapSize.large,
    });
  });
});
