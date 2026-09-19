import { TILE } from "@/game/constants";
import { isWalkable } from "@/game/mapgen";
import type { GameMap, Vec2 } from "@/types/game";

interface Node {
  tx: number;
  ty: number;
  g: number;
  f: number;
  parent: Node | null;
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

/**
 * A* over the tile grid. Returns world-space waypoints from start to goal,
 * or an empty array when no route exists.
 *
 * `blocked` is a set of tile keys ("tx,ty") occupied by buildings.
 */
export function findPath(
  map: GameMap,
  start: Vec2,
  goal: Vec2,
  blocked: ReadonlySet<string>,
): Vec2[] {
  const sx = Math.floor(start.x);
  const sy = Math.floor(start.y);
  const gx = Math.floor(goal.x);
  const gy = Math.floor(goal.y);

  if (sx === gx && sy === gy) return [{ x: goal.x, y: goal.y }];

  const key = (x: number, y: number): string => `${x},${y}`;
  const passable = (x: number, y: number): boolean => {
    if (!isWalkable(map, x, y)) return false;
    if (blocked.has(key(x, y))) return false;
    return true;
  };

  // If the goal itself is blocked, walk to the nearest passable neighbour.
  let targetX = gx;
  let targetY = gy;
  if (!passable(targetX, targetY)) {
    let best: { x: number; y: number; d: number } | null = null;
    for (let r = 1; r <= 4 && !best; r += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const nx = gx + dx;
          const ny = gy + dy;
          if (!passable(nx, ny)) continue;
          const d = Math.hypot(nx - sx, ny - sy);
          if (!best || d < best.d) best = { x: nx, y: ny, d };
        }
      }
    }
    if (!best) return [];
    targetX = best.x;
    targetY = best.y;
  }

  const open: Node[] = [];
  const openMap = new Map<string, Node>();
  const closed = new Set<string>();

  const startNode: Node = {
    tx: sx,
    ty: sy,
    g: 0,
    f: heuristic(sx, sy, targetX, targetY),
    parent: null,
  };
  open.push(startNode);
  openMap.set(key(sx, sy), startNode);

  let iterations = 0;
  const maxIterations = map.width * map.height * 2;

  while (open.length > 0 && iterations < maxIterations) {
    iterations += 1;
    let bestIndex = 0;
    for (let i = 1; i < open.length; i += 1) {
      if (open[i].f < open[bestIndex].f) bestIndex = i;
    }
    const current = open.splice(bestIndex, 1)[0];
    openMap.delete(key(current.tx, current.ty));

    if (current.tx === targetX && current.ty === targetY) {
      const path: Vec2[] = [];
      let node: Node | null = current;
      while (node) {
        path.push({ x: node.tx + 0.5, y: node.ty + 0.5 });
        node = node.parent;
      }
      path.reverse();
      path.shift();
      path.push({ x: goal.x, y: goal.y });
      return path;
    }

    closed.add(key(current.tx, current.ty));

    for (const [dx, dy] of DIRS) {
      const nx = current.tx + dx;
      const ny = current.ty + dy;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      if (!passable(nx, ny)) continue;
      // Prevent cutting diagonal corners through blocked tiles.
      if (dx !== 0 && dy !== 0) {
        if (!passable(current.tx + dx, current.ty)) continue;
        if (!passable(current.tx, current.ty + dy)) continue;
      }
      const step = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
      const g = current.g + step;
      const existing = openMap.get(nk);
      if (existing && g >= existing.g) continue;
      const node: Node = {
        tx: nx,
        ty: ny,
        g,
        f: g + heuristic(nx, ny, targetX, targetY),
        parent: current,
      };
      if (existing) {
        existing.g = node.g;
        existing.f = node.f;
        existing.parent = node.parent;
      } else {
        open.push(node);
        openMap.set(nk, node);
      }
    }
  }

  return [];
}

/**
 * Computes a spread destination for a unit in a group so that large
 * selections fan out instead of stacking on one tile.
 */
export function spreadDestination(
  center: Vec2,
  index: number,
  total: number,
  map: GameMap,
  blocked: ReadonlySet<string>,
): Vec2 {
  if (total <= 1) return center;
  const ring = Math.ceil(Math.sqrt(total));
  const spacing = 1.1;
  const col = index % ring;
  const row = Math.floor(index / ring);
  const offsetX = (col - (ring - 1) / 2) * spacing;
  const offsetY = (row - (ring - 1) / 2) * spacing;
  const candidate = { x: center.x + offsetX, y: center.y + offsetY };
  const tx = Math.floor(candidate.x);
  const ty = Math.floor(candidate.y);
  if (isWalkable(map, tx, ty) && !blocked.has(`${tx},${ty}`)) return candidate;
  return center;
}

/** Converts a world position to a tile key. */
export function tileKey(x: number, y: number): string {
  return `${Math.floor(x)},${Math.floor(y)}`;
}

/** Converts a tile coordinate to the world-space centre of that tile. */
export function tileCenter(tx: number, ty: number): Vec2 {
  return { x: tx + 0.5, y: ty + 0.5 };
}

/** World-space distance helper. */
export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Converts a pixel offset to world units. */
export function pixelsToWorld(px: number): number {
  return px / TILE;
}

/**
 * Builds the set of tile keys a unit may not enter.
 *
 * Allied buildings are passable: same-team units walk through friendly
 * structures and through allied gates in walls. Enemy and neutral structures
 * stay solid. `isAlly` decides the relationship, so the caller owns the
 * diplomacy rules.
 */
export function blockedTilesFor(
  buildings: ReadonlyArray<{
    owner: number;
    tx: number;
    ty: number;
    size: number;
    cancelled: boolean;
  }>,
  owner: number,
  isAlly: (a: number, b: number) => boolean,
): Set<string> {
  const blocked = new Set<string>();
  for (const b of buildings) {
    if (b.cancelled) continue;
    // A unit may pass through its own and its allies' structures.
    if (b.owner === owner || isAlly(owner, b.owner)) continue;
    for (let y = b.ty; y < b.ty + b.size; y += 1) {
      for (let x = b.tx; x < b.tx + b.size; x += 1) {
        blocked.add(`${x},${y}`);
      }
    }
  }
  return blocked;
}

/**
 * Whether a tile is passable for a unit, treating allied structures as open
 * ground. Used by the flow-field solver, which needs the same rule as A*.
 */
export function isPassableFor(
  map: GameMap,
  tx: number,
  ty: number,
  blocked: ReadonlySet<string>,
): boolean {
  if (!isWalkable(map, tx, ty)) return false;
  return !blocked.has(`${tx},${ty}`);
}
