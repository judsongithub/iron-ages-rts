import { renderMinimap } from "@/game/renderer";
import { useCameraStore } from "@/store/cameraStore";
import { useMatchStore } from "@/store/matchStore";
import { useEffect, useRef } from "react";

interface MinimapProps {
  /** Whether to draw the fog-of-war overlay. */
  showFog: boolean;
  className?: string;
}

/**
 * Terrain, resource, unit, and building overview with a camera viewport
 * rectangle. Clicking or dragging jumps the camera to that world position.
 */
export function Minimap({ showFog, className }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const revision = useMatchStore((s) => s.revision);
  const dragging = useRef(false);

  useEffect(() => {
    // `revision` is read so the effect re-runs as the simulation mutates.
    void revision;
    const canvas = canvasRef.current;
    const game = useMatchStore.getState().game;
    if (!canvas || !game) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const camera = useCameraStore.getState();
    renderMinimap(ctx, game, camera, { width, height }, showFog);
  }, [revision, showFog]);

  const jumpTo = (clientX: number, clientY: number): void => {
    const canvas = canvasRef.current;
    const game = useMatchStore.getState().game;
    if (!canvas || !game) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * game.map.width;
    const y = ((clientY - rect.top) / rect.height) * game.map.height;
    useCameraStore.getState().setPosition(x, y);
  };

  return (
    <canvas
      ref={canvasRef}
      className={`h-full w-full cursor-crosshair ${className ?? ""}`}
      data-ocid="hud.minimap"
      aria-label="Minimap — click to move the camera"
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        jumpTo(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (dragging.current) jumpTo(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        dragging.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
    />
  );
}
