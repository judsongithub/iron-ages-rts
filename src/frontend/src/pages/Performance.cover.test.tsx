import { AiDifficulty, Faction, MapSize } from "@/backend";
import {
  PERF_BANNER_SECONDS,
  PERF_FRAME_CAP,
  PERF_LOW_FPS,
  PERF_LOW_FPS_SECONDS,
  PERF_MIN_POPULATION,
  PERF_POPULATION_STEP,
} from "@/game/constants";
import {
  createGame,
  globalPopulationCap,
  lowerGlobalPopulationCap,
  lowerRenderDetail,
  setRenderDetail,
} from "@/game/engine";
import type { GameState } from "@/game/engine";
import { MatchPage } from "@/pages/MatchPage";
import { useCameraStore } from "@/store/cameraStore";
import { useMatchSetupStore } from "@/store/matchSetupStore";
import { useMatchStore } from "@/store/matchStore";
import { useSelectionStore } from "@/store/selectionStore";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the performance auto-scaling system.
 *
 * The accepted behavior: when the client stays below `PERF_LOW_FPS` for
 * `PERF_LOW_FPS_SECONDS`, the render detail steps down from high to medium to
 * low; once detail is exhausted the global population cap drops by
 * `PERF_POPULATION_STEP` per player, never below `PERF_MIN_POPULATION`; and the
 * HUD shows a dismissible "High system load detected" banner for
 * `PERF_BANNER_SECONDS`.
 *
 * The engine seams are driven directly. The banner is exercised by rendering
 * the real MatchPage with a controlled requestAnimationFrame clock, so the
 * assertion is on the rendered HUD rather than a mock.
 */

const CONFIG = {
  faction: Faction.romans,
  mapSize: MapSize.small,
  difficulty: AiDifficulty.normal,
  playerTeam: 1 as const,
  aiTeam: 2 as const,
  populationLimit: 200,
  aiPopulationLimit: 200,
};

function newGame(seed = 4242): GameState {
  return createGame(CONFIG, seed);
}

describe("performance cover: render detail auto-scaling", () => {
  it("steps render detail high -> medium -> low and then stops", () => {
    const state = newGame();
    expect(state.renderDetail).toBe("high");

    expect(lowerRenderDetail(state)).toBe("medium");
    expect(state.renderDetail).toBe("medium");

    expect(lowerRenderDetail(state)).toBe("low");
    expect(state.renderDetail).toBe("low");

    // Already at the lowest tier: no further reduction.
    expect(lowerRenderDetail(state)).toBeNull();
    expect(state.renderDetail).toBe("low");
  });

  it("sets render detail explicitly", () => {
    const state = newGame();
    setRenderDetail(state, "low");
    expect(state.renderDetail).toBe("low");
    setRenderDetail(state, "high");
    expect(state.renderDetail).toBe("high");
  });

  it("caps the frame rate at reduced detail tiers", () => {
    // The loop reads PERF_FRAME_CAP[renderDetail]; high is uncapped and lower
    // detail means a lower cap.
    expect(PERF_FRAME_CAP.high).toBe(0);
    expect(PERF_FRAME_CAP.medium).toBeGreaterThan(PERF_FRAME_CAP.low);
    expect(PERF_FRAME_CAP.low).toBeGreaterThan(0);
  });
});

describe("performance cover: global population cap", () => {
  it("lowers the cap by one step per player and reports it as an event", () => {
    const state = newGame();
    const before = globalPopulationCap(state);
    expect(before).toBe(200);

    const event = lowerGlobalPopulationCap(state);
    expect(event).not.toBeNull();
    expect(state.populationPenalty).toBe(PERF_POPULATION_STEP);
    expect(globalPopulationCap(state)).toBe(200 - PERF_POPULATION_STEP);
    expect(event?.message).toContain("global population cap");
  });

  it("never lowers the cap below the minimum population", () => {
    const state = newGame();
    // Drive the cap down to the floor.
    let guard = 0;
    while (lowerGlobalPopulationCap(state) !== null && guard < 100) {
      guard += 1;
    }
    expect(globalPopulationCap(state)).toBe(PERF_MIN_POPULATION);
    // A further attempt is refused.
    expect(lowerGlobalPopulationCap(state)).toBeNull();
  });
});

describe("performance cover: HUD banner", () => {
  let rafCallbacks: Array<(time: number) => void>;
  let now: number;

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

    rafCallbacks = [];
    now = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: (time: number) => void) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Seconds of slow frames the exponential moving average needs before its
   * reading falls below `PERF_LOW_FPS`. The average is seeded at 60 FPS and
   * decays by 0.9 per frame, so at half the threshold it crosses below 20 FPS
   * after ~1.6s; 2s leaves margin. This is a property of the telemetry's
   * smoothing, not a production constant, so it lives with the test.
   */
  const EMA_WARMUP_SECONDS = 2;

  /**
   * Advances the mocked rAF clock by `seconds`, delivering slow frames.
   *
   * The telemetry uses an exponential moving average seeded at 60 FPS, so it
   * takes a couple of seconds of slow frames before the reading drops below the
   * threshold; callers add `EMA_WARMUP_SECONDS` on top of the required low-FPS
   * stretch.
   */
  function advanceSlowFrames(seconds: number): void {
    // Seed the mock clock from the real clock the effects captured at mount,
    // so the first delivered frame has a positive delta.
    if (now === 0) now = performance.now();
    const frameMs = 1000 / (PERF_LOW_FPS / 2); // half the low-FPS threshold
    const frames = Math.ceil((seconds * 1000) / frameMs);
    for (let i = 0; i < frames; i += 1) {
      now += frameMs;
      const pending = rafCallbacks;
      rafCallbacks = [];
      act(() => {
        for (const cb of pending) cb(now);
      });
    }
  }

  it("shows the optimizing banner after a sustained low frame rate", () => {
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
    const game = useMatchStore.getState().game;
    if (!game) throw new Error("match did not start");
    useCameraStore
      .getState()
      .setPosition(game.map.starts[0].x, game.map.starts[0].y);

    render(<MatchPage onExitToMenu={vi.fn()} onRestart={vi.fn()} />);

    // Not struggling yet.
    expect(
      document.querySelector('[data-ocid="hud.performance_banner"]'),
    ).not.toBeInTheDocument();

    // Stay below the threshold for longer than the required stretch.
    advanceSlowFrames(PERF_LOW_FPS_SECONDS + EMA_WARMUP_SECONDS);

    expect(
      document.querySelector('[data-ocid="hud.performance_banner"]'),
    ).toBeInTheDocument();
    expect(screen.getByText(/High system load detected/i)).toBeInTheDocument();
  });

  it("dismisses the banner and keeps it hidden", () => {
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
    const game = useMatchStore.getState().game;
    if (!game) throw new Error("match did not start");
    useCameraStore
      .getState()
      .setPosition(game.map.starts[0].x, game.map.starts[0].y);

    render(<MatchPage onExitToMenu={vi.fn()} onRestart={vi.fn()} />);
    advanceSlowFrames(PERF_LOW_FPS_SECONDS + EMA_WARMUP_SECONDS);

    const dismiss = document.querySelector(
      '[data-ocid="hud.performance_banner_dismiss"]',
    );
    expect(dismiss).toBeInTheDocument();
    act(() => {
      (dismiss as HTMLElement).click();
    });

    expect(
      document.querySelector('[data-ocid="hud.performance_banner"]'),
    ).not.toBeInTheDocument();

    // Continued low frame rate does not bring it back.
    advanceSlowFrames(PERF_LOW_FPS_SECONDS + EMA_WARMUP_SECONDS);
    expect(
      document.querySelector('[data-ocid="hud.performance_banner"]'),
    ).not.toBeInTheDocument();
  });

  it("keeps the banner up for the full display window", () => {
    // Fake only the banner's timeout. Faking requestAnimationFrame would
    // replace the stub installed in `beforeEach`, so no frames would be
    // delivered and the banner would never appear.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
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
      const game = useMatchStore.getState().game;
      if (!game) throw new Error("match did not start");
      useCameraStore
        .getState()
        .setPosition(game.map.starts[0].x, game.map.starts[0].y);

      render(<MatchPage onExitToMenu={vi.fn()} onRestart={vi.fn()} />);
      advanceSlowFrames(PERF_LOW_FPS_SECONDS + EMA_WARMUP_SECONDS);
      expect(
        document.querySelector('[data-ocid="hud.performance_banner"]'),
      ).toBeInTheDocument();

      // Just before the window closes it is still visible.
      act(() => {
        vi.advanceTimersByTime((PERF_BANNER_SECONDS - 1) * 1000);
      });
      expect(
        document.querySelector('[data-ocid="hud.performance_banner"]'),
      ).toBeInTheDocument();

      // After the window it auto-hides.
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(
        document.querySelector('[data-ocid="hud.performance_banner"]'),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
