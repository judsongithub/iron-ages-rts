import { AiDifficulty, Faction, MapSize } from "@/backend";
import { DEFAULT_POPULATION_LIMIT } from "@/game/constants";
import type { TeamId } from "@/types/game";
import { create } from "zustand";

export type AppView = "menu" | "match" | "gameOver";

/** One AI opponent configured in the lobby, in slot order. */
export interface AiSlotConfig {
  team: TeamId;
  populationLimit: number;
  color: string;
  /** Difficulty this specific AI slot runs at. */
  difficulty: AiDifficulty;
}

interface MatchSetupState {
  faction: Faction;
  mapSize: MapSize;
  difficulty: AiDifficulty;
  /** Team assigned to the human player (1-6). */
  playerTeam: TeamId;
  /** Team assigned to the AI opponent (1-6). */
  aiTeam: TeamId;
  /** Population ceiling for the human player (100-500). */
  populationLimit: number;
  /** Population ceiling for the AI opponent (100-500). */
  aiPopulationLimit: number;
  /** Lobby-assigned commander color for the human player. */
  playerColor: string;
  /** Every active AI opponent, in slot order. */
  aiSlots: AiSlotConfig[];
  /** Seed for the next generated map. */
  seed: number;
  setFaction: (faction: Faction) => void;
  setMapSize: (size: MapSize) => void;
  setDifficulty: (difficulty: AiDifficulty) => void;
  setPlayerTeam: (team: TeamId) => void;
  setAiTeam: (team: TeamId) => void;
  setPopulationLimit: (limit: number) => void;
  setAiPopulationLimit: (limit: number) => void;
  setPlayerColor: (color: string) => void;
  setAiSlots: (slots: AiSlotConfig[]) => void;
  /** Rolls a fresh seed so every skirmish generates a new map. */
  rerollSeed: () => void;
}

export const useMatchSetupStore = create<MatchSetupState>((set) => ({
  faction: Faction.romans,
  mapSize: MapSize.medium,
  difficulty: AiDifficulty.normal,
  playerTeam: 1,
  aiTeam: 2,
  populationLimit: DEFAULT_POPULATION_LIMIT,
  aiPopulationLimit: DEFAULT_POPULATION_LIMIT,
  playerColor: "",
  aiSlots: [],
  seed: Math.floor(Math.random() * 1_000_000),
  setFaction: (faction) => set({ faction }),
  setMapSize: (mapSize) => set({ mapSize }),
  setDifficulty: (difficulty) => set({ difficulty }),
  setPlayerTeam: (playerTeam) => set({ playerTeam }),
  setAiTeam: (aiTeam) => set({ aiTeam }),
  setPopulationLimit: (populationLimit) => set({ populationLimit }),
  setAiPopulationLimit: (aiPopulationLimit) => set({ aiPopulationLimit }),
  setPlayerColor: (playerColor) => set({ playerColor }),
  setAiSlots: (aiSlots) => set({ aiSlots }),
  rerollSeed: () => set({ seed: Math.floor(Math.random() * 1_000_000) }),
}));
