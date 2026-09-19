import { BUILDING_STATS, PERF_TERRAIN_STRIDE } from "@/game/constants";
import { blockedTiles } from "@/game/engine";
import { renderGame } from "@/game/renderer";
import type { InputHandlers } from "@/hooks/useGameInput";
import { useCameraStore } from "@/store/cameraStore";
import { useMatchStore } from "@/store/matchStore";
import { useSelectionStore } from "@/store/selectionStore";
import type { BuildingKind, RenderDetail } from "@/types/game";
import { useEffect, useRef } from "react";

interface GameCanvasProps {
  input: InputHandlers;
  /** Building kind awaiting placement, if any. */
  pendingBuild: BuildingKind | null;
  /** Whether fog of war is drawn. */
  showFog: boolean;
  /**
   * Current render detail tier chosen by the performance monitor. Drives the
   * terrain sampling stride so auto-scaling actually sheds render load.
   */
  renderDetail: RenderDetail;
}

/**
 * Full-viewport canvas that renders the simulation.
 *
 * A single requestAnimationFrame loop runs for the lifetime of the component
 * and draws every frame. It reads the latest game state, camera, selection,
 * cursor, and placement props from refs and Zustand stores inside the frame
 * callback, so React re-renders never tear down or restart the loop.
 */
export function GameCanvas({
  input,
  pendingBuild,
  showFog,
  renderDetail,
}: GameCanvasProps) {
  const canvasRef = input.canvasRef;
  const frameRef = useRef(0);

  // Mirror the props the frame reads into refs so the loop stays stable while
  // still observing the latest values.
  const pendingBuildRef = useRef(pendingBuild);
  pendingBuildRef.current = pendingBuild;
  const showFogRef = useRef(showFog);
  showFogRef.current = showFog;
  const renderDetailRef = useRef(renderDetail);
  renderDetailRef.current = renderDetail;
  const cursorRef = useRef(input.cursor);
  cursorRef.current = input.cursor;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = (): void => {
      // Schedule the next frame first so a thrown frame never stops the loop.
      frameRef.current = requestAnimationFrame(draw);

      const game = useMatchStore.getState().game;
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (
        canvas.width !== Math.floor(width * dpr) ||
        canvas.height !== Math.floor(height * dpr)
      ) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!game) {
        ctx.fillStyle = "rgb(18, 16, 14)";
        ctx.fillRect(0, 0, width, height);
        return;
      }
      const camera = useCameraStore.getState();
      const selection = useSelectionStore.getState();
      const cursor = cursorRef.current;
      const build = pendingBuildRef.current;

      let ghost: {
        tx: number;
        ty: number;
        size: number;
        valid: boolean;
        distributionRadius: number;
      } | null = null;
      if (build && cursor) {
        const world = {
          x: camera.x + (cursor.x - width / 2) / camera.zoom,
          y: camera.y + (cursor.y - height / 2) / camera.zoom,
        };
        const size = BUILDING_STATS[build].size;
        const tx = Math.floor(world.x - size / 2);
        const ty = Math.floor(world.y - size / 2);
        const blocked = blockedTiles(game);
        let valid = true;
        for (let y = ty; y < ty + size && valid; y += 1) {
          for (let x = tx; x < tx + size; x += 1) {
            const tile = game.map.tiles[y * game.map.width + x];
            if (!tile || !tile.buildable || blocked.has(`${x},${y}`)) {
              valid = false;
              break;
            }
          }
        }
        ghost = {
          tx,
          ty,
          size,
          valid,
          distributionRadius: BUILDING_STATS[build].distributionRadius,
        };
      }

      renderGame(
        ctx,
        game,
        {
          camera,
          selectedUnitIds: selection.unitIds,
          selectedBuildingId: selection.buildingId,
          showFog: showFogRef.current,
          ghost,
          playerId: 0,
          terrainStride: PERF_TERRAIN_STRIDE[renderDetailRef.current] ?? 1,
        },
        { width, height },
      );
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameRef.current);
  }, [canvasRef]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full touch-none"
      data-ocid="game.canvas_target"
      aria-label="Battlefield view"
      onPointerDown={input.onPointerDown}
      onPointerMove={input.onPointerMove}
      onPointerUp={input.onPointerUp}
      onPointerLeave={input.onPointerLeave}
      onPointerEnter={input.onPointerEnter}
      onWheel={input.onWheel}
      onContextMenu={input.onContextMenu}
    />
  );
}
