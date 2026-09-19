import {
  PERF_FRAME_CAP,
  PERF_LOW_FPS,
  PERF_LOW_FPS_SECONDS,
} from "@/game/constants";
import { useMatchStore } from "@/store/matchStore";
import { useEffect, useRef } from "react";

/** Live frame-rate telemetry the performance banner reads. */
export interface PerformanceTelemetry {
  /** Smoothed frames per second. */
  fps: number;
  /** Whether the client is currently in a low-frame-rate stretch. */
  struggling: boolean;
}

/**
 * Drives the simulation with requestAnimationFrame at a fixed timestep.
 * The store's `tick` consumes real elapsed time and advances the simulation
 * in fixed increments, so behaviour is frame-rate independent.
 *
 * The same loop doubles as the performance monitor: it tracks a smoothed frame
 * rate, and when the client stays below the low-FPS threshold for the required
 * stretch it steps the render detail down and, if load stays critical, lowers
 * the global population cap for every player.
 */
export function useGameLoop(active: boolean): void {
  const frame = useRef(0);
  const last = useRef(0);
  const fps = useRef(60);
  const lowSeconds = useRef(0);
  const lastStep = useRef(0);
  const frameBudget = useRef(0);

  useEffect(() => {
    if (!active) return;
    last.current = performance.now();
    fps.current = 60;
    lowSeconds.current = 0;
    lastStep.current = 0;

    const loop = (now: number): void => {
      const dt = Math.min((now - last.current) / 1000, 0.25);
      last.current = now;

      // Exponential moving average keeps the reading stable frame to frame.
      if (dt > 0) {
        const instant = 1 / dt;
        fps.current = fps.current * 0.9 + instant * 0.1;
      }

      const store = useMatchStore.getState();
      const game = store.game;

      // Frame cap: at reduced detail tiers the loop skips simulation frames
      // so the renderer is not asked to keep up with an uncapped display.
      const cap = game ? (PERF_FRAME_CAP[game.renderDetail] ?? 0) : 0;
      const minInterval = cap > 0 ? 1 / cap : 0;
      if (minInterval > 0) {
        frameBudget.current += dt;
        if (frameBudget.current < minInterval) {
          frame.current = requestAnimationFrame(loop);
          return;
        }
        frameBudget.current = 0;
      }

      store.tick(dt);

      // --- performance auto-scaling ---------------------------------------
      if (fps.current < PERF_LOW_FPS) {
        lowSeconds.current += dt;
      } else {
        lowSeconds.current = 0;
      }
      if (lowSeconds.current >= PERF_LOW_FPS_SECONDS) {
        lowSeconds.current = 0;
        const current = useMatchStore.getState();
        const live = current.game;
        if (live) {
          // Step the render detail down first; only once it is exhausted do we
          // touch the global population cap.
          const lowered = current.lowerRenderDetail();
          if (lowered === null) {
            current.lowerGlobalPopulationCap();
          }
        }
      }

      frame.current = requestAnimationFrame(loop);
    };
    frame.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame.current);
  }, [active]);
}
