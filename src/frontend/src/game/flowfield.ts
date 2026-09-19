import { isWalkable } from "@/game/mapgen";
import type { GameMap, Vec2 } from "@/types/game";

/**
 * Flow-field pathfinding for group movement.
 *
 * A flow field is an integration field (Dijkstra distance-to-goal over the tile
 * grid) plus a direction vector per tile. One field serves an entire group
 * heading to the same destination, so a 200-unit order costs one field build
 * instead of 200 A* searches. Per-unit A* remains the fallback for single
 * units and for goals the field cannot reach.
 *
 * Fields are cached by destination tile and invalidated whenever the blocked
 * tile set changes, so repeated orders to the same place are free.
 */

/** Sentinel distance for tiles the field cannot reach. */
const UNREACHABLE = 0xffff;

/** Cost of a cardinal step, in tile units. */
const CARDINAL = 10;

/** Cost of a diagonal step, in tile units (10 * sqrt(2), rounded). */
const DIAGONAL = 14;

export interface FlowField {
  /** Destination tile the field was built for. */
  goalTx: number;
  goalTy: number;
  /** Integration distance per tile, in tenths of a tile. */
  distance: Uint16Array;
  /** Direction vector per tile, pointing toward the goal. */
  dirX: Float32Array;
  dirY: Float32Array;
  /** Map dimensions the field was built against. */
  width: number;
  height: number;
  /** Signature of the blocked set the field was built against. */
  blockedSignature: string;
}

/** A cache of flow fields keyed by destination tile. */
export interface FlowFieldCache {
  fields: Map<string, FlowField>;
  /** Signature of the blocked set the cached fields were built against. */
  blockedSignature: string;
}

export function createFlowFieldCache(): FlowFieldCache {
  return { fields: new Map(), blockedSignature: "" };
}

/**
 * Builds a stable signature for a blocked tile set. The signature only has to
 * change when the set changes, so it is derived from the sorted keys.
 */
export function blockedSignature(blocked: ReadonlySet<string>): string {
  if (blocked.size === 0) return "0";
  const keys = Array.from(blocked).sort();
  return `${keys.length}:${keys.join(";")}`;
}

/**
 * Builds an integration field by running a multi-source Dijkstra outward from
 * the goal tile. Blocked and unwalkable tiles are never expanded, so the field
 * naturally routes around buildings and water.
 */
export function buildFlowField(
  map: GameMap,
  goalTx: number,
  goalTy: number,
  blocked: ReadonlySet<string>,
  signature: string,
): FlowField {
  const { width, height } = map;
  const size = width * height;
  const distance = new Uint16Array(size);
  distance.fill(UNREACHABLE);

  const field: FlowField = {
    goalTx,
    goalTy,
    distance,
    dirX: new Float32Array(size),
    dirY: new Float32Array(size),
    width,
    height,
    blockedSignature: signature,
  };

  if (goalTx < 0 || goalTy < 0 || goalTx >= width || goalTy >= height) {
    return field;
  }
  if (!isWalkable(map, goalTx, goalTy) || blocked.has(`${goalTx},${goalTy}`)) {
    return field;
  }

  // Bucket queue: distances are small integers, so a bucket per distance level
  // beats a binary heap and keeps the build allocation-free after setup.
  const maxDistance = size;
  const buckets: number[][] = new Array(maxDistance + 1);
  const goalIndex = goalTy * width + goalTx;
  distance[goalIndex] = 0;
  buckets[0] = [goalIndex];

  let current = 0;
  while (current <= maxDistance) {
    const bucket = buckets[current];
    if (!bucket || bucket.length === 0) {
      current += 1;
      continue;
    }
    // Drain the whole bucket before advancing: every tile at this distance
    // must be expanded, otherwise tiles queued into the same bucket are
    // skipped and the field is left partially filled.
    while (bucket.length > 0) {
      const index = bucket.pop() as number;
      // A tile may have been relaxed into a cheaper bucket after it was queued.
      if (distance[index] < current) continue;

      const tx = index % width;
      const ty = (index - tx) / width;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = tx + dx;
          const ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (!isWalkable(map, nx, ny)) continue;
          if (blocked.has(`${nx},${ny}`)) continue;
          // Prevent cutting diagonal corners through blocked tiles.
          if (dx !== 0 && dy !== 0) {
            if (!isWalkable(map, tx + dx, ty)) continue;
            if (!isWalkable(map, tx, ty + dy)) continue;
            if (blocked.has(`${tx + dx},${ty}`)) continue;
            if (blocked.has(`${tx},${ty + dy}`)) continue;
          }
          const step = dx !== 0 && dy !== 0 ? DIAGONAL : CARDINAL;
          const next = current + step;
          const nIndex = ny * width + nx;
          if (next >= distance[nIndex]) continue;
          distance[nIndex] = next;
          if (!buckets[next]) buckets[next] = [];
          buckets[next].push(nIndex);
        }
      }
    }
    current += 1;
  }

  // Derive a direction vector per tile by descending the integration field.
  for (let ty = 0; ty < height; ty += 1) {
    for (let tx = 0; tx < width; tx += 1) {
      const index = ty * width + tx;
      const here = distance[index];
      if (here === UNREACHABLE || here === 0) continue;
      let bestDistance = here;
      let bestDx = 0;
      let bestDy = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = tx + dx;
          const ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nIndex = ny * width + nx;
          const candidate = distance[nIndex];
          if (candidate === UNREACHABLE || candidate >= bestDistance) continue;
          if (dx !== 0 && dy !== 0) {
            if (!isWalkable(map, tx + dx, ty)) continue;
            if (!isWalkable(map, tx, ty + dy)) continue;
          }
          bestDistance = candidate;
          bestDx = dx;
          bestDy = dy;
        }
      }
      if (bestDx === 0 && bestDy === 0) continue;
      const len = Math.hypot(bestDx, bestDy) || 1;
      field.dirX[index] = bestDx / len;
      field.dirY[index] = bestDy / len;
    }
  }

  return field;
}

/** Returns a cached field for a destination, building it on a cache miss. */
export function getFlowField(
  cache: FlowFieldCache,
  map: GameMap,
  goalTx: number,
  goalTy: number,
  blocked: ReadonlySet<string>,
): FlowField {
  const signature = blockedSignature(blocked);
  if (cache.blockedSignature !== signature) {
    cache.fields.clear();
    cache.blockedSignature = signature;
  }
  const key = `${goalTx},${goalTy}`;
  const cached = cache.fields.get(key);
  if (cached) return cached;
  const field = buildFlowField(map, goalTx, goalTy, blocked, signature);
  // Bound the cache so a long match cannot grow it without limit.
  if (cache.fields.size >= 24) {
    const oldest = cache.fields.keys().next().value;
    if (oldest !== undefined) cache.fields.delete(oldest);
  }
  cache.fields.set(key, field);
  return field;
}

/**
 * Samples the flow direction at a world position. Returns null when the tile
 * is unreachable or already at the goal, so the caller can fall back to A*.
 */
export function sampleFlow(
  field: FlowField,
  x: number,
  y: number,
): Vec2 | null {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= field.width || ty >= field.height) return null;
  const index = ty * field.width + tx;
  if (field.distance[index] === UNREACHABLE) return null;
  const dx = field.dirX[index];
  const dy = field.dirY[index];
  if (dx === 0 && dy === 0) return null;
  return { x: dx, y: dy };
}

/** Whether a tile is reachable in the given field. */
export function isReachable(field: FlowField, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= field.width || ty >= field.height) return false;
  return field.distance[ty * field.width + tx] !== UNREACHABLE;
}

/**
 * Walks a unit along a flow field for one step, returning the new position.
 * The unit advances toward the centre of the next tile so it does not hug
 * walls, and stops when it reaches the goal tile.
 */
export function stepAlongFlow(
  field: FlowField,
  x: number,
  y: number,
  speed: number,
  dt: number,
): { x: number; y: number; arrived: boolean } {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx === field.goalTx && ty === field.goalTy) {
    return { x, y, arrived: true };
  }
  const direction = sampleFlow(field, x, y);
  if (!direction) return { x, y, arrived: false };

  // Aim at the centre of the neighbouring tile the field points to.
  const targetX = tx + 0.5 + direction.x;
  const targetY = ty + 0.5 + direction.y;
  const dx = targetX - x;
  const dy = targetY - y;
  const dist = Math.hypot(dx, dy) || 1;
  const move = Math.min(speed * dt, dist);
  return {
    x: x + (dx / dist) * move,
    y: y + (dy / dist) * move,
    arrived: false,
  };
}
