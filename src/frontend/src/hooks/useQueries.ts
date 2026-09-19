import { createActor } from "@/backend";
import type { MatchRecord, MatchStats, PlayerSettings } from "@/backend";
import { useActor } from "@caffeineai/core-infrastructure";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Loads the caller's saved settings. Returns `null` when the backend is
 * unreachable or the caller has no settings yet — the game stays playable
 * offline either way.
 */
export function usePlayerSettings() {
  const { actor, isFetching } = useActor(createActor);
  return useQuery<PlayerSettings | null>({
    queryKey: ["playerSettings"],
    queryFn: async () => {
      if (!actor) return null;
      try {
        return await actor.getSettings();
      } catch {
        return null;
      }
    },
    enabled: !!actor && !isFetching,
    retry: false,
  });
}

export function useSaveSettings() {
  const { actor } = useActor(createActor);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (value: PlayerSettings) => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.saveSettings(value);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["playerSettings"] });
    },
  });
}

export function useRecentMatches(limit = 8) {
  const { actor, isFetching } = useActor(createActor);
  return useQuery<MatchRecord[]>({
    queryKey: ["recentMatches", limit],
    queryFn: async () => {
      if (!actor) return [];
      try {
        return await actor.listRecentMatches(BigInt(limit));
      } catch {
        return [];
      }
    },
    enabled: !!actor && !isFetching,
    retry: false,
  });
}

export function useMatchStats() {
  const { actor, isFetching } = useActor(createActor);
  return useQuery<MatchStats | null>({
    queryKey: ["matchStats"],
    queryFn: async () => {
      if (!actor) return null;
      try {
        return await actor.getMatchStats();
      } catch {
        return null;
      }
    },
    enabled: !!actor && !isFetching,
    retry: false,
  });
}

/**
 * Records a completed match. Failures are swallowed so an unreachable
 * backend never blocks the game-over flow.
 */
export function useRecordMatch() {
  const { actor } = useActor(createActor);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      faction: import("@/backend").Faction;
      mapSize: import("@/backend").MapSize;
      difficulty: import("@/backend").AiDifficulty;
      result: import("@/backend").MatchResult;
      durationSeconds: number;
    }) => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.recordMatch(
        input.faction,
        input.mapSize,
        input.difficulty,
        input.result,
        BigInt(Math.max(0, Math.round(input.durationSeconds))),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recentMatches"] });
      void queryClient.invalidateQueries({ queryKey: ["matchStats"] });
    },
    onError: () => {
      // Offline play is fully supported; a failed record is non-fatal.
    },
  });
}
