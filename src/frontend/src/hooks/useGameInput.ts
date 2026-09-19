import { BUILDING_STATS, TILE, UNIT_STATS } from "@/game/constants";
import { buildingCenter, distanceToBuilding, isEnemy } from "@/game/engine";
import { useCameraStore } from "@/store/cameraStore";
import { useMatchStore } from "@/store/matchStore";
import { useSelectionStore } from "@/store/selectionStore";
import type { Building, Stance, Unit, Vec2 } from "@/types/game";
import { useCallback, useEffect, useRef, useState } from "react";

export interface BoxSelection {
  active: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export interface InputHandlers {
  /** Attach to the canvas element. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  box: BoxSelection;
  /** Screen-space cursor position for the placement ghost. */
  cursor: Vec2 | null;
  /** Whether the pointer is over the canvas. */
  hovering: boolean;
  /**
   * While true, left-click pointer events do not change the selection, so a
   * pending building placement keeps the builders chosen when placement began.
   */
  suppressSelection: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerEnter: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerLeave: () => void;
  onWheel: (event: React.WheelEvent<HTMLCanvasElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLCanvasElement>) => void;
}

/** Converts a screen-space point to world coordinates. */
export function screenToWorld(
  screenX: number,
  screenY: number,
  camera: { x: number; y: number; zoom: number },
  viewport: { width: number; height: number },
): Vec2 {
  return {
    x: camera.x + (screenX - viewport.width / 2) / camera.zoom,
    y: camera.y + (screenY - viewport.height / 2) / camera.zoom,
  };
}

/** Converts a world point to screen coordinates. */
export function worldToScreen(
  worldX: number,
  worldY: number,
  camera: { x: number; y: number; zoom: number },
  viewport: { width: number; height: number },
): Vec2 {
  return {
    x: (worldX - camera.x) * camera.zoom + viewport.width / 2,
    y: (worldY - camera.y) * camera.zoom + viewport.height / 2,
  };
}

function pointInBuilding(world: Vec2, building: Building): boolean {
  return (
    world.x >= building.tx &&
    world.x <= building.tx + building.size &&
    world.y >= building.ty &&
    world.y <= building.ty + building.size
  );
}

function unitHitRadius(unit: Unit): number {
  return Math.max(0.45, UNIT_STATS[unit.kind].radius + 0.25);
}

/**
 * Mounts the classic RTS control scheme on the match canvas.
 *
 * Left-click selects, drag box-selects, right-click issues context orders,
 * Shift queues orders, Ctrl+1-9 assigns control groups, 1-9 recalls them,
 * and the camera pans with edge-scroll, drag-scroll, and wheel zoom.
 */
export function useGameInput(suppressSelection = false): InputHandlers {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [box, setBox] = useState<BoxSelection>({
    active: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
  });
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [hovering, setHovering] = useState(false);
  const dragging = useRef(false);
  const dragMoved = useRef(false);
  const panning = useRef(false);
  const panLast = useRef<Vec2>({ x: 0, y: 0 });
  const edgeScroll = useRef<Vec2>({ x: 0, y: 0 });
  const keysDown = useRef<Set<string>>(new Set());
  // Latest pointer position in canvas space. Kept in a ref so the persistent
  // edge-scroll loop reads the newest value without re-subscribing each move.
  const pointerRef = useRef<Vec2 | null>(null);
  const hoveringRef = useRef(false);
  // Read inside stable pointer callbacks so the latest value wins without
  // re-creating the handlers on every render.
  const suppressSelectionRef = useRef(suppressSelection);
  suppressSelectionRef.current = suppressSelection;

  const viewport = useCallback((): { width: number; height: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { width: 0, height: 0 };
    return { width: canvas.clientWidth, height: canvas.clientHeight };
  }, []);

  const toWorld = useCallback(
    (screenX: number, screenY: number): Vec2 => {
      const camera = useCameraStore.getState();
      return screenToWorld(screenX, screenY, camera, viewport());
    },
    [viewport],
  );

  const selectAt = useCallback((world: Vec2, additive: boolean): void => {
    const game = useMatchStore.getState().game;
    if (!game) return;
    const selection = useSelectionStore.getState();

    // Prefer units under the cursor, then buildings. Enemy entities are
    // selectable too, but only as a single inspect target: an additive click
    // never mixes them into the player's own selection.
    let bestUnit: Unit | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const unit of game.units) {
      const d = Math.hypot(unit.x - world.x, unit.y - world.y);
      if (d < unitHitRadius(unit) && d < bestDist) {
        bestDist = d;
        bestUnit = unit;
      }
    }
    if (bestUnit) {
      if (isEnemy(game, 0, bestUnit.owner)) {
        selection.setSelection([], null);
        selection.setInspectTarget({ kind: "unit", id: bestUnit.id });
        return;
      }
      selection.setInspectTarget(null);
      const ids = additive
        ? Array.from(new Set([...selection.unitIds, bestUnit.id]))
        : [bestUnit.id];
      selection.setSelection(ids, null);
      return;
    }

    let bestBuilding: Building | null = null;
    for (const building of game.buildings) {
      if (building.cancelled) continue;
      if (pointInBuilding(world, building)) {
        bestBuilding = building;
        break;
      }
    }
    if (bestBuilding) {
      if (isEnemy(game, 0, bestBuilding.owner)) {
        selection.setSelection([], null);
        selection.setInspectTarget({ kind: "building", id: bestBuilding.id });
        return;
      }
      selection.setInspectTarget(null);
      selection.setSelection([], bestBuilding.id);
      return;
    }

    // Resource nodes are inspect-only: they have no owner and no orders.
    let bestNodeId: number | null = null;
    let bestNodeDist = Number.POSITIVE_INFINITY;
    for (const node of game.map.nodes) {
      if (node.depleted) continue;
      const d = Math.hypot(node.x - world.x, node.y - world.y);
      if (d < 1.1 && d < bestNodeDist) {
        bestNodeDist = d;
        bestNodeId = node.id;
      }
    }
    if (bestNodeId !== null) {
      selection.setSelection([], null);
      selection.setInspectTarget({ kind: "node", id: bestNodeId });
      return;
    }

    selection.setInspectTarget(null);
    if (!additive) selection.clearSelection();
  }, []);

  const boxSelect = useCallback(
    (start: Vec2, end: Vec2, additive: boolean): void => {
      const game = useMatchStore.getState().game;
      if (!game) return;
      const minX = Math.min(start.x, end.x);
      const maxX = Math.max(start.x, end.x);
      const minY = Math.min(start.y, end.y);
      const maxY = Math.max(start.y, end.y);
      const ids: number[] = [];
      for (const unit of game.units) {
        if (unit.owner !== 0) continue;
        if (
          unit.x >= minX &&
          unit.x <= maxX &&
          unit.y >= minY &&
          unit.y <= maxY
        ) {
          ids.push(unit.id);
        }
      }
      const selection = useSelectionStore.getState();
      const next = additive
        ? Array.from(new Set([...selection.unitIds, ...ids]))
        : ids;
      selection.setSelection(next, null);
    },
    [],
  );

  const issueContextOrder = useCallback(
    (world: Vec2, queued: boolean): void => {
      const game = useMatchStore.getState().game;
      if (!game) return;
      const selection = useSelectionStore.getState();
      const unitIds = selection.unitIds;
      if (unitIds.length === 0) return;

      // Enemy unit or building under the cursor → attack. Allied units and
      // structures are never attack targets.
      let enemyUnit: Unit | null = null;
      let enemyDist = Number.POSITIVE_INFINITY;
      for (const unit of game.units) {
        if (!isEnemy(game, 0, unit.owner)) continue;
        const d = Math.hypot(unit.x - world.x, unit.y - world.y);
        if (d < unitHitRadius(unit) && d < enemyDist) {
          enemyDist = d;
          enemyUnit = unit;
        }
      }
      if (enemyUnit) {
        useMatchStore.getState().attack(unitIds, enemyUnit.id, queued);
        return;
      }
      for (const building of game.buildings) {
        if (building.cancelled) continue;
        if (!isEnemy(game, 0, building.owner)) continue;
        if (pointInBuilding(world, building)) {
          useMatchStore.getState().attack(unitIds, building.id, queued);
          return;
        }
      }

      // Resource node under the cursor → gather.
      let nodeId: number | null = null;
      let nodeDist = Number.POSITIVE_INFINITY;
      for (const node of game.map.nodes) {
        if (node.depleted) continue;
        const d = Math.hypot(node.x - world.x, node.y - world.y);
        if (d < 1.1 && d < nodeDist) {
          nodeDist = d;
          nodeId = node.id;
        }
      }
      if (nodeId !== null) {
        useMatchStore.getState().gather(unitIds, nodeId, queued);
        return;
      }

      // Own damaged building → repair; own unfinished building → build.
      for (const building of game.buildings) {
        if (building.owner !== 0 || building.cancelled) continue;
        if (!pointInBuilding(world, building)) continue;
        if (building.progress < 1) {
          useMatchStore.getState().build(unitIds, building.id, queued);
          return;
        }
        if (building.health < building.maxHealth) {
          useMatchStore.getState().repair(unitIds, building.id, queued);
          return;
        }
      }

      useMatchStore.getState().move(unitIds, world, queued);
    },
    [],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): void => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.setPointerCapture(event.pointerId);
      const rect = canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const world = toWorld(sx, sy);

      if (event.button === 0) {
        dragging.current = true;
        dragMoved.current = false;
        setBox({
          active: true,
          startX: sx,
          startY: sy,
          currentX: sx,
          currentY: sy,
        });
      } else if (event.button === 1) {
        // Middle-mouse drag pans the camera without disturbing selection.
        event.preventDefault();
        panning.current = true;
        panLast.current = { x: sx, y: sy };
      } else if (event.button === 2) {
        issueContextOrder(world, event.shiftKey);
      }
    },
    [issueContextOrder, toWorld],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): void => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      pointerRef.current = { x: sx, y: sy };
      if (!hoveringRef.current) {
        hoveringRef.current = true;
        setHovering(true);
      }
      setCursor({ x: sx, y: sy });
      if (panning.current) {
        const camera = useCameraStore.getState();
        const dx = (sx - panLast.current.x) / camera.zoom;
        const dy = (sy - panLast.current.y) / camera.zoom;
        camera.pan(-dx, -dy);
        panLast.current = { x: sx, y: sy };
        return;
      }
      if (dragging.current) {
        dragMoved.current = true;
        setBox((prev) => ({ ...prev, currentX: sx, currentY: sy }));
      }
    },
    [],
  );

  const onPointerEnter = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): void => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      pointerRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      hoveringRef.current = true;
      setHovering(true);
    },
    [],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): void => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      if (event.button === 1) {
        panning.current = false;
        return;
      }
      if (event.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const start = toWorld(box.startX, box.startY);
      const end = toWorld(sx, sy);
      const dragDistance = Math.hypot(sx - box.startX, sy - box.startY);

      // A pending placement owns the left click: the wrapper's click handler
      // commits the building, so the selection must survive this pointerup.
      if (!suppressSelectionRef.current) {
        if (dragDistance > 6) {
          boxSelect(start, end, event.shiftKey);
        } else {
          selectAt(end, event.shiftKey);
        }
      }
      dragging.current = false;
      dragMoved.current = false;
      setBox({ active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 });
    },
    [box.startX, box.startY, boxSelect, selectAt, toWorld],
  );

  const onPointerLeave = useCallback((): void => {
    panning.current = false;
    pointerRef.current = null;
    hoveringRef.current = false;
    setHovering(false);
    setCursor(null);
  }, []);

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>): void => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const camera = useCameraStore.getState();
      const before = screenToWorld(sx, sy, camera, viewport());
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      camera.zoomBy(factor);
      const after = useCameraStore.getState();
      const afterWorld = screenToWorld(sx, sy, after, viewport());
      // Keep the world point under the cursor fixed while zooming.
      after.setPosition(
        after.x + (before.x - afterWorld.x),
        after.y + (before.y - afterWorld.y),
      );
    },
    [viewport],
  );

  const onContextMenu = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>): void => {
      event.preventDefault();
    },
    [],
  );

  // --- keyboard: control groups, stances, camera, orders -------------------
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      )
        return;
      keysDown.current.add(event.key.toLowerCase());

      const selection = useSelectionStore.getState();
      const match = useMatchStore.getState();

      // Control groups: Ctrl+1-9 assigns, 1-9 recalls, double-tap centres.
      if (/^[1-9]$/.test(event.key)) {
        const group = Number(event.key);
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          match.assignGroup(group, selection.unitIds);
          selection.assignGroup(group, selection.unitIds);
          return;
        }
        const ids = match.recallGroup(group);
        if (ids.length > 0) {
          event.preventDefault();
          selection.setSelection(ids, null);
          const isDouble = selection.noteGroupTap(group);
          if (isDouble) {
            const game = match.game;
            if (game) {
              const units = game.units.filter((u) => ids.includes(u.id));
              if (units.length > 0) {
                const cx =
                  units.reduce((sum, u) => sum + u.x, 0) / units.length;
                const cy =
                  units.reduce((sum, u) => sum + u.y, 0) / units.length;
                useCameraStore.getState().setPosition(cx, cy);
              }
            }
          }
        }
        return;
      }

      // Stance hotkeys.
      const stanceKeys: Record<string, Stance> = {
        a: "aggressive",
        d: "defensive",
        s: "standGround",
        n: "noAttack",
      };
      if (
        event.key.toLowerCase() in stanceKeys &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        const stance = stanceKeys[event.key.toLowerCase()];
        if (selection.unitIds.length > 0) {
          event.preventDefault();
          match.applyStance(selection.unitIds, stance);
          selection.setStance(stance);
        }
        return;
      }

      if (event.key === "Escape") {
        selection.clearSelection();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (selection.buildingId !== null) {
          event.preventDefault();
          match.cancelPlacement(selection.buildingId);
          selection.clearSelection();
        }
        return;
      }
      if (event.key.toLowerCase() === "h") {
        // Stop / hold.
        if (selection.unitIds.length > 0) {
          event.preventDefault();
          match.stop(selection.unitIds);
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      keysDown.current.delete(event.key.toLowerCase());
    };

    // Losing focus never delivers the matching keyup, so held movement keys
    // would otherwise pan the camera forever.
    const handleBlur = (): void => {
      keysDown.current.clear();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  // --- edge scroll ----------------------------------------------------------
  // One persistent loop for the lifetime of the hook. It reads the pointer
  // position from a ref, so pointer movement never tears down the loop and the
  // pan keeps running continuously while the cursor rests in an edge zone.
  useEffect(() => {
    let frame = 0;
    const EDGE = 18;
    const SPEED = 14;

    const loop = (): void => {
      const canvas = canvasRef.current;
      const camera = useCameraStore.getState();
      const pointer = pointerRef.current;
      if (canvas && hoveringRef.current && pointer) {
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        let dx = 0;
        let dy = 0;
        if (pointer.x < EDGE) dx = -1;
        else if (pointer.x > width - EDGE) dx = 1;
        if (pointer.y < EDGE) dy = -1;
        else if (pointer.y > height - EDGE) dy = 1;
        if (dx !== 0 || dy !== 0) {
          const step = SPEED / camera.zoom;
          camera.pan(dx * step, dy * step);
        }
      }
      // Keyboard camera panning with arrow keys.
      const keys = keysDown.current;
      let kx = 0;
      let ky = 0;
      if (keys.has("arrowleft")) kx -= 1;
      if (keys.has("arrowright")) kx += 1;
      if (keys.has("arrowup")) ky -= 1;
      if (keys.has("arrowdown")) ky += 1;
      if (kx !== 0 || ky !== 0) {
        const step = SPEED / camera.zoom;
        camera.pan(kx * step, ky * step);
      }
      edgeScroll.current = { x: kx, y: ky };
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  return {
    canvasRef,
    box,
    cursor,
    hovering,
    suppressSelection,
    onPointerDown,
    onPointerMove,
    onPointerEnter,
    onPointerUp,
    onPointerLeave,
    onWheel,
    onContextMenu,
  };
}

export { TILE, buildingCenter, distanceToBuilding, BUILDING_STATS };
