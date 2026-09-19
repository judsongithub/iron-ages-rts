import { AgeIndicator } from "@/components/game/AgeIndicator";
import { CommandPanel } from "@/components/game/CommandPanel";
import { EventLog } from "@/components/game/EventLog";
import { GameCanvas } from "@/components/game/GameCanvas";
import { HelpOverlay } from "@/components/game/HelpOverlay";
import { Minimap } from "@/components/game/Minimap";
import { ResourceBar } from "@/components/game/ResourceBar";
import { formatClock } from "@/components/game/hudTokens";
import { Button } from "@/components/ui/button";
import {
  BUILDING_STATS,
  PERF_BANNER_SECONDS,
  PERF_LOW_FPS,
  PERF_LOW_FPS_SECONDS,
} from "@/game/constants";
import { buildingLabel } from "@/game/engine";
import { useGameInput } from "@/hooks/useGameInput";
import { type PerformanceTelemetry, useGameLoop } from "@/hooks/useGameLoop";
import { useCameraStore } from "@/store/cameraStore";
import { useMatchStore } from "@/store/matchStore";
import { useSelectionStore } from "@/store/selectionStore";
import {
  type BuildingKind,
  type Order,
  RENDER_DETAIL_LABELS,
} from "@/types/game";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface MatchPageProps {
  onExitToMenu: () => void;
  onRestart: () => void;
}

/** Human-readable label for a queued order. */
function orderLabel(order: Order): string {
  switch (order.type) {
    case "move":
      return "Move";
    case "attackMove":
      return "Attack-move";
    case "attack":
      return "Attack";
    case "gather":
      return "Gather";
    case "build":
      return "Build";
    case "repair":
      return "Repair";
    case "stop":
      return "Hold";
  }
}

/**
 * Samples the live frame rate into the same `PerformanceTelemetry` shape the
 * game loop uses, so the performance banner reacts to the identical signal
 * (below `PERF_LOW_FPS` for `PERF_LOW_FPS_SECONDS`).
 */
function usePerformanceTelemetry(active: boolean): PerformanceTelemetry {
  const [telemetry, setTelemetry] = useState<PerformanceTelemetry>({
    fps: 60,
    struggling: false,
  });
  const frame = useRef(0);
  const last = useRef(0);
  const fps = useRef(60);
  const lowSeconds = useRef(0);

  useEffect(() => {
    if (!active) return;
    last.current = performance.now();
    fps.current = 60;
    lowSeconds.current = 0;

    const sample = (now: number): void => {
      const dt = Math.min((now - last.current) / 1000, 0.25);
      last.current = now;
      if (dt > 0) {
        fps.current = fps.current * 0.9 + (1 / dt) * 0.1;
      }
      if (fps.current < PERF_LOW_FPS) {
        lowSeconds.current += dt;
      } else {
        lowSeconds.current = 0;
      }
      const struggling = lowSeconds.current >= PERF_LOW_FPS_SECONDS;
      setTelemetry((previous) =>
        previous.struggling === struggling &&
        Math.abs(previous.fps - fps.current) < 0.5
          ? previous
          : { fps: fps.current, struggling },
      );
      frame.current = requestAnimationFrame(sample);
    };
    frame.current = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(frame.current);
  }, [active]);

  return telemetry;
}

/**
 * Live match view: a full-viewport battlefield canvas with an overlay HUD.
 *
 * The page owns the in-match experience — it mounts the canvas, drives the
 * simulation, wires the classic RTS control scheme, and presents the resource
 * bar, minimap, command panel, event log, pause menu, and help overlay.
 */
export function MatchPage({ onExitToMenu, onRestart }: MatchPageProps) {
  const [pendingBuild, setPendingBuild] = useState<BuildingKind | null>(null);
  // The villagers chosen when placement mode began. The canvas pointerup that
  // precedes the wrapper's click clears the live selection, so the builders
  // must be captured here rather than read from the selection store on click.
  const placementBuilders = useRef<number[]>([]);
  const input = useGameInput(pendingBuild !== null);
  const hud = useMatchStore((s) => s.hud);
  const events = useMatchStore((s) => s.events);
  const game = useMatchStore((s) => s.game);
  const revision = useMatchStore((s) => s.revision);
  const selection = useSelectionStore();
  const [paused, setPaused] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showFog, setShowFog] = useState(true);
  const [attackMoveArmed, setAttackMoveArmed] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [perfBannerVisible, setPerfBannerVisible] = useState(false);
  const [perfBannerDismissed, setPerfBannerDismissed] = useState(false);

  useGameLoop(!paused && !helpOpen);
  const telemetry = usePerformanceTelemetry(!paused && !helpOpen);

  // Show the "optimizing" banner once the client has struggled long enough,
  // and keep it up for PERF_BANNER_SECONDS unless the player dismisses it.
  useEffect(() => {
    if (!telemetry.struggling || perfBannerDismissed) return;
    setPerfBannerVisible(true);
    const timer = window.setTimeout(
      () => setPerfBannerVisible(false),
      PERF_BANNER_SECONDS * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [telemetry.struggling, perfBannerDismissed]);

  // Surface the global population-cap reduction the engine emits when load
  // stays critical. The event also lands in the dispatch log; this keeps a
  // dedicated notice on screen long enough to be read.
  const populationLowered = useMemo(
    () =>
      events.find((event) => event.message.includes("global population cap")),
    [events],
  );
  const [popNoticeDismissed, setPopNoticeDismissed] = useState(false);
  useEffect(() => {
    if (populationLowered) setPopNoticeDismissed(false);
  }, [populationLowered]);

  // Centre the camera on the player's start when the match begins.
  useEffect(() => {
    if (!game) return;
    const start = game.map.starts[0];
    useCameraStore.getState().setPosition(start.x, start.y);
  }, [game]);

  // Global keyboard: pause, help, and the attack-move cursor mode.
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      ) {
        return;
      }
      if (event.key === "Escape") {
        if (helpOpen) setHelpOpen(false);
        else if (pendingBuild) setPendingBuild(null);
        else if (attackMoveArmed) setAttackMoveArmed(false);
        return;
      }
      if (event.key === "F1") {
        event.preventDefault();
        setHelpOpen((open) => !open);
        return;
      }
      if (event.key === "p" || event.key === "P") {
        setPaused((value) => !value);
        return;
      }
      if (event.key === "q" || event.key === "Q") {
        if (selection.unitIds.length > 0) {
          event.preventDefault();
          setAttackMoveArmed((armed) => !armed);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [attackMoveArmed, helpOpen, pendingBuild, selection.unitIds.length]);

  const selectedUnits = useMemo(() => {
    // `revision` is read so the memo recomputes as the simulation mutates.
    void revision;
    if (!game) return [];
    const ids = new Set(selection.unitIds);
    return game.units.filter((u) => ids.has(u.id));
  }, [game, selection.unitIds, revision]);

  const selectedBuilding = useMemo(() => {
    void revision;
    if (!game || selection.buildingId === null) return null;
    return game.buildings.find((b) => b.id === selection.buildingId) ?? null;
  }, [game, selection.buildingId, revision]);

  // Enemy entity selected for inspection only. Kept separate from the own
  // selection so the command panel can render an inspect-only branch.
  const inspectedUnit = useMemo(() => {
    void revision;
    if (!game || selection.inspectTarget?.kind !== "unit") return null;
    return game.units.find((u) => u.id === selection.inspectTarget?.id) ?? null;
  }, [game, selection.inspectTarget, revision]);

  const inspectedBuilding = useMemo(() => {
    void revision;
    if (!game || selection.inspectTarget?.kind !== "building") return null;
    return (
      game.buildings.find((b) => b.id === selection.inspectTarget?.id) ?? null
    );
  }, [game, selection.inspectTarget, revision]);

  // Resource node selected for inspection only.
  const inspectedNode = useMemo(() => {
    void revision;
    if (!game || selection.inspectTarget?.kind !== "node") return null;
    return (
      game.map.nodes.find((n) => n.id === selection.inspectTarget?.id) ?? null
    );
  }, [game, selection.inspectTarget, revision]);

  // The active unit's order queue, shown as a visible indicator.
  const orderQueue = useMemo(() => {
    void revision;
    const lead = selectedUnits[0];
    if (!lead) return [];
    return lead.orders.slice(0, 6);
  }, [selectedUnits, revision]);

  const handleCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>): void => {
      if (!game) return;
      const canvas = input.canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const camera = useCameraStore.getState();
      const worldX =
        camera.x + (event.clientX - rect.left - rect.width / 2) / camera.zoom;
      const worldY =
        camera.y + (event.clientY - rect.top - rect.height / 2) / camera.zoom;

      if (attackMoveArmed && selection.unitIds.length > 0) {
        useMatchStore
          .getState()
          .attackMove(selection.unitIds, { x: worldX, y: worldY }, false);
        setAttackMoveArmed(false);
        return;
      }

      if (!pendingBuild) return;
      const size = BUILDING_STATS[pendingBuild].size;
      const tx = Math.floor(worldX - size / 2);
      const ty = Math.floor(worldY - size / 2);
      const placed = useMatchStore
        .getState()
        .place(pendingBuild, tx, ty, placementBuilders.current);
      if (placed) setPendingBuild(null);
    },
    [attackMoveArmed, game, input.canvasRef, pendingBuild, selection.unitIds],
  );

  const handleStop = useCallback((): void => {
    if (selection.unitIds.length > 0) {
      useMatchStore.getState().stop(selection.unitIds);
    }
  }, [selection.unitIds]);

  const handleDelete = useCallback((): void => {
    if (selection.buildingId !== null) {
      useMatchStore.getState().cancelPlacement(selection.buildingId);
      selection.clearSelection();
    }
  }, [selection]);

  const handleAdvance = useCallback((): void => {
    useMatchStore.getState().advance();
  }, []);

  const handlePickBuild = useCallback((kind: BuildingKind | null): void => {
    // Snapshot the current selection as the builders for this placement.
    placementBuilders.current =
      kind === null ? [] : [...useSelectionStore.getState().unitIds];
    setPendingBuild(kind);
    setAttackMoveArmed(false);
  }, []);

  const cursorMode = attackMoveArmed
    ? "crosshair"
    : pendingBuild
      ? "copy"
      : "default";

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-background"
      data-ocid="match.page"
    >
      <div
        className="absolute inset-0"
        style={{ cursor: cursorMode }}
        onClick={handleCanvasClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
          }
        }}
      >
        <GameCanvas
          input={input}
          pendingBuild={pendingBuild}
          showFog={showFog}
          renderDetail={hud?.renderDetail ?? "high"}
        />
      </div>

      {/* --- top HUD bar --------------------------------------------------- */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-stretch justify-between border-b border-hud-border bg-gradient-hud texture-hud"
        data-ocid="hud.top_bar"
      >
        <div className="pointer-events-auto flex min-w-0 items-stretch overflow-x-auto">
          {hud && (
            <ResourceBar
              resources={hud.resources}
              gatherRates={hud.gatherRates}
              energyDeficit={hud.energyDeficit}
              powerState={hud.powerState}
              energyBalance={hud.energyProduction - hud.energyUpkeep}
              farmFoodRate={hud.farmFoodRate}
            />
          )}
        </div>
        <div className="pointer-events-auto flex items-stretch divide-x divide-hud-border">
          {hud && (
            <>
              <AgeIndicator
                age={hud.age}
                progress={hud.ageProgress}
                advancing={hud.advancing}
              />
              <div
                className="flex flex-col justify-center px-3 py-1.5"
                data-ocid="hud.population"
                title={`Population used / ceiling — lobby limit ${hud.populationLimit}, effective cap ${hud.globalPopulationCap}`}
              >
                <span className="label-stencil text-[10px] text-hud-muted">
                  Pop
                </span>
                <span className="font-mono text-sm font-semibold tabular-nums text-hud-foreground">
                  {hud.populationUsed}/{hud.populationCap}
                </span>
                <span
                  className={`font-mono text-[9px] tabular-nums ${
                    hud.globalPopulationCap < hud.populationLimit
                      ? "text-destructive"
                      : "text-hud-muted"
                  }`}
                  data-ocid="hud.population_limit"
                >
                  limit {hud.populationLimit}
                  {hud.globalPopulationCap < hud.populationLimit
                    ? ` · cap ${hud.globalPopulationCap}`
                    : ""}
                </span>
              </div>
              <div
                className="flex flex-col justify-center px-3 py-1.5"
                data-ocid="hud.render_detail"
                title="Graphics detail tier chosen by the performance monitor"
              >
                <span className="label-stencil text-[10px] text-hud-muted">
                  Detail
                </span>
                <span className="font-mono text-sm font-semibold tabular-nums text-hud-foreground">
                  {RENDER_DETAIL_LABELS[hud.renderDetail]}
                </span>
              </div>
              <div
                className="flex flex-col justify-center px-3 py-1.5"
                data-ocid="hud.clock"
                title="Match clock"
              >
                <span className="label-stencil text-[10px] text-hud-muted">
                  Time
                </span>
                <span className="font-mono text-sm font-semibold tabular-nums text-hud-foreground">
                  {formatClock(hud.elapsed)}
                </span>
              </div>
            </>
          )}
          <div className="flex items-center gap-1 px-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 rounded-sm px-2 text-[10px]"
              data-ocid="hud.help_button"
              onClick={() => setHelpOpen(true)}
            >
              Manual
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 rounded-sm px-2 text-[10px]"
              data-ocid="hud.fog_toggle"
              aria-pressed={showFog}
              onClick={() => setShowFog((value) => !value)}
            >
              Fog
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 rounded-sm px-2 text-[10px]"
              data-ocid="hud.pause_button"
              onClick={() => setPaused(true)}
            >
              Pause
            </Button>
          </div>
        </div>
      </div>

      {/* --- performance auto-scaling banner ------------------------------- */}
      {perfBannerVisible && (
        <output
          className="pointer-events-auto absolute left-1/2 top-16 z-30 flex -translate-x-1/2 items-center gap-3 panel-iron rounded-sm border-l-2 border-l-warning px-3 py-2"
          data-ocid="hud.performance_banner"
          aria-live="polite"
        >
          <span className="font-mono text-xs text-warning">
            High system load detected. Optimizing graphics settings...
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-6 rounded-sm px-2 text-[10px]"
            data-ocid="hud.performance_banner_dismiss"
            onClick={() => {
              setPerfBannerVisible(false);
              setPerfBannerDismissed(true);
            }}
          >
            Dismiss
          </Button>
        </output>
      )}

      {/* --- population cap reduction notice ------------------------------- */}
      {populationLowered && !popNoticeDismissed && (
        <output
          className="pointer-events-auto absolute left-1/2 top-28 z-30 flex -translate-x-1/2 items-center gap-3 panel-iron rounded-sm border-l-2 border-l-destructive px-3 py-2"
          data-ocid="hud.population_notice"
          aria-live="polite"
        >
          <span className="font-mono text-xs text-destructive">
            {populationLowered.message}
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-6 rounded-sm px-2 text-[10px]"
            data-ocid="hud.population_notice_dismiss"
            onClick={() => setPopNoticeDismissed(true)}
          >
            Dismiss
          </Button>
        </output>
      )}

      {/* --- side panel: minimap + log ------------------------------------- */}
      <div
        className={`absolute right-3 top-16 z-20 flex w-56 flex-col gap-2 transition-opacity ${
          panelOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        data-ocid="hud.side_panel"
      >
        <div className="panel-iron overflow-hidden rounded-sm p-1">
          <div className="h-40 w-full">
            <Minimap showFog={showFog} />
          </div>
        </div>
        <div className="panel-iron overflow-hidden rounded-sm">
          <EventLog events={events} />
        </div>
      </div>

      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="absolute right-3 top-16 z-30 h-6 rounded-sm px-2 text-[10px]"
        data-ocid="hud.side_panel_toggle"
        aria-pressed={panelOpen}
        onClick={() => setPanelOpen((open) => !open)}
      >
        {panelOpen ? "Hide" : "Show"}
      </Button>

      {/* --- order queue indicator ----------------------------------------- */}
      {orderQueue.length > 0 && (
        <div
          className="pointer-events-none absolute left-3 top-16 z-20 panel-iron rounded-sm px-2 py-1.5"
          data-ocid="hud.order_queue"
        >
          <span className="label-stencil text-[10px] text-hud-muted">
            Orders
          </span>
          <ol className="mt-1 flex flex-col gap-0.5">
            {orderQueue.map((order, index) => (
              <li
                key={`${order.type}-${index}`}
                className="flex items-center gap-1.5 font-mono text-[10px] text-hud-foreground"
              >
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-[2px] border border-hud-border bg-black/40 text-[9px] text-hud-accent">
                  {index + 1}
                </span>
                {orderLabel(order)}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* --- bottom command panel ------------------------------------------ */}
      <div className="absolute inset-x-0 bottom-0 z-20">
        <CommandPanel
          units={selectedUnits}
          building={selectedBuilding}
          inspectedUnit={inspectedUnit}
          inspectedBuilding={inspectedBuilding}
          inspectedNode={inspectedNode}
          pendingBuild={pendingBuild}
          onPickBuild={handlePickBuild}
        />
      </div>

      {/* --- placement / attack-move hint ---------------------------------- */}
      {pendingBuild && (
        <div
          className="pointer-events-none absolute left-1/2 top-20 z-30 -translate-x-1/2 panel-iron rounded-sm px-3 py-1.5"
          data-ocid="hud.placement_hint"
        >
          <span className="font-mono text-xs text-hud-accent">
            Placing {buildingLabel(pendingBuild)} — click valid ground, Escape
            to cancel
          </span>
        </div>
      )}
      {attackMoveArmed && (
        <div
          className="pointer-events-none absolute left-1/2 top-20 z-30 -translate-x-1/2 panel-iron rounded-sm px-3 py-1.5"
          data-ocid="hud.attack_move_hint"
        >
          <span className="font-mono text-xs text-hud-accent">
            Attack-move — click a destination, Escape to cancel
          </span>
        </div>
      )}

      {/* --- quick actions -------------------------------------------------- */}
      <div className="absolute bottom-36 left-3 z-20 flex flex-col gap-1">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 rounded-sm px-2 text-[10px]"
          data-ocid="hud.stop_button"
          disabled={selection.unitIds.length === 0}
          onClick={handleStop}
        >
          Stop (H)
        </Button>
        <Button
          type="button"
          size="sm"
          variant={attackMoveArmed ? "default" : "secondary"}
          className="h-7 rounded-sm px-2 text-[10px]"
          data-ocid="hud.attack_move_button"
          disabled={selection.unitIds.length === 0}
          aria-pressed={attackMoveArmed}
          onClick={() => setAttackMoveArmed((armed) => !armed)}
        >
          Attack-move (Q)
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 rounded-sm px-2 text-[10px]"
          data-ocid="hud.delete_button"
          disabled={selection.buildingId === null}
          onClick={handleDelete}
        >
          Cancel build
        </Button>
      </div>

      {/* --- pause menu ----------------------------------------------------- */}
      {paused && (
        <dialog
          open
          className="absolute inset-0 z-40 m-0 flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-black/75 p-4 text-foreground"
          data-ocid="pause.modal"
          aria-modal="true"
          aria-label="Match paused"
        >
          <div className="panel-parchment texture-grain w-full max-w-sm rounded-sm p-6">
            <h2 className="font-display text-2xl font-semibold text-foreground">
              Campaign Paused
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The field holds its breath.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Button
                type="button"
                className="rounded-sm"
                data-ocid="pause.resume_button"
                onClick={() => setPaused(false)}
              >
                Resume
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="rounded-sm"
                data-ocid="pause.restart_button"
                onClick={onRestart}
              >
                Restart Match
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="rounded-sm"
                data-ocid="pause.menu_button"
                onClick={onExitToMenu}
              >
                Return to Main Menu
              </Button>
            </div>
          </div>
        </dialog>
      )}

      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* Hidden control used by the HUD to advance the age from the keyboard. */}
      <button
        type="button"
        className="sr-only"
        data-ocid="hud.advance_age_hidden"
        onClick={handleAdvance}
      >
        Advance age
      </button>
    </div>
  );
}
