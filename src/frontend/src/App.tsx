import { GameOverPage } from "@/pages/GameOverPage";
import { MainMenuPage } from "@/pages/MainMenuPage";
import { MatchPage } from "@/pages/MatchPage";
import { useMatchSetupStore } from "@/store/matchSetupStore";
import { useMatchStore } from "@/store/matchStore";
import type { MatchOutcome } from "@/types/game";
import { useCallback, useEffect, useState } from "react";

export type AppView = "menu" | "match" | "gameOver";

/**
 * Application shell. A small route state machine switches between the main
 * menu, the live match, and the game-over summary — no router dependency is
 * needed for three top-level views.
 */
export default function App() {
  const [view, setView] = useState<AppView>("menu");
  const [outcome, setOutcome] = useState<MatchOutcome | null>(null);
  const startMatch = useMatchStore((s) => s.start);
  const resetMatch = useMatchStore((s) => s.reset);
  const storeOutcome = useMatchStore((s) => s.outcome);

  // Surface the simulation's outcome to the shell exactly once.
  useEffect(() => {
    if (storeOutcome && view === "match") {
      setOutcome(storeOutcome);
      setView("gameOver");
    }
  }, [storeOutcome, view]);

  const handleStart = useCallback(() => {
    const setup = useMatchSetupStore.getState();
    // Roll a fresh seed in the setup store, then read it back so the store
    // remains the single source of truth for the generated map.
    setup.rerollSeed();
    const seed = useMatchSetupStore.getState().seed;
    const aiPlayers =
      setup.aiSlots.length > 0
        ? setup.aiSlots
        : [
            {
              team: setup.aiTeam,
              populationLimit: setup.aiPopulationLimit,
              color: "",
              difficulty: setup.difficulty,
            },
          ];
    startMatch(
      {
        faction: setup.faction,
        mapSize: setup.mapSize,
        difficulty: setup.difficulty,
        playerTeam: setup.playerTeam,
        aiTeam: setup.aiTeam,
        populationLimit: setup.populationLimit,
        aiPopulationLimit: setup.aiPopulationLimit,
        colors: [setup.playerColor, ...aiPlayers.map((ai) => ai.color)],
        aiPlayers,
      },
      seed,
    );
    setOutcome(null);
    setView("match");
  }, [startMatch]);

  const handleRestart = useCallback(() => {
    handleStart();
  }, [handleStart]);

  const handleReturnToMenu = useCallback(() => {
    resetMatch();
    setOutcome(null);
    setView("menu");
  }, [resetMatch]);

  if (view === "match") {
    return (
      <MatchPage onExitToMenu={handleReturnToMenu} onRestart={handleRestart} />
    );
  }

  if (view === "gameOver" && outcome) {
    return (
      <GameOverPage
        outcome={outcome}
        onPlayAgain={handleRestart}
        onReturnToMenu={handleReturnToMenu}
      />
    );
  }

  return <MainMenuPage onStartMatch={handleStart} />;
}
