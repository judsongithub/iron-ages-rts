import { TILE } from "@/game/constants";
import {
  distance,
  findPath,
  pixelsToWorld,
  spreadDestination,
  tileCenter,
  tileKey,
} from "@/game/pathfinding";
import type { GameMap, TerrainTile, Vec2 } from "@/types/game";
import { describe, expect, it } from "vitest";

/**
 * Characterization baseline for the per-unit A* pathfinding layer.
 *
 * The request adds a flow-field group-movement layer *alongside* the existing
 * per-unit A*, so this file freezes the A* contract the new layer must not
 * disturb: route validity, blocked-tile avoidance, diagonal corner-cutting,
 * unreachable-goal handling, and the group spread helper. It deliberately does
 * NOT assert anything about flow fields, which do not exist yet.
 *
 * Maps are built synthetically so the assertions do not depend on the evolving
 * procedural generator's density or layout.
 */

function tile(walkable: boolean): TerrainTile {
  return {
    height: 0.45,
    kind: walkable ? "grass" : "water",
    buildable: walkable,
    walkable,
  };
}

/** A fully walkable `width` x `height` map. */
function openMap(width = 12, height = 12): GameMap {
  const tiles: TerrainTile[] = [];
  for (let i = 0; i < width * height; i += 1) tiles.push(tile(true));
  return {
    width,
    height,
    tiles,
    nodes: [],
    starts: [
      { x: 1, y: 1 },
      { x: width - 2, y: height - 2 },
    ],
    // The engine reads walkability from this flat byte grid, so the synthetic
    // map must keep it in sync with the tile objects.
    walkable: new Uint8Array(width * height).fill(1),
  };
}

function setWalkable(
  map: GameMap,
  tx: number,
  ty: number,
  walkable: boolean,
): void {
  map.tiles[ty * map.width + tx] = tile(walkable);
  map.walkable[ty * map.width + tx] = walkable ? 1 : 0;
}

/** A vertical wall of unwalkable tiles at column `tx`, rows `from`..`to`. */
function wall(map: GameMap, tx: number, from: number, to: number): void {
  for (let ty = from; ty <= to; ty += 1) setWalkable(map, tx, ty, false);
}

function isWalkableAt(map: GameMap, p: Vec2): boolean {
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false;
  return map.tiles[ty * map.width + tx].walkable;
}

describe("findPath characterization", () => {
  it("returns a single waypoint when start and goal share a tile", () => {
    const map = openMap();
    const path = findPath(
      map,
      { x: 3.2, y: 4.7 },
      { x: 3.9, y: 4.1 },
      new Set(),
    );
    expect(path).toEqual([{ x: 3.9, y: 4.1 }]);
  });

  it("routes across open ground and lands exactly on the goal", () => {
    const map = openMap();
    const start = { x: 1.5, y: 1.5 };
    const goal = { x: 9.5, y: 9.5 };
    const path = findPath(map, start, goal, new Set());

    expect(path.length).toBeGreaterThan(0);
    // The final waypoint is the requested goal, not a tile centre.
    expect(path[path.length - 1]).toEqual(goal);
    // Every intermediate waypoint sits on walkable ground.
    for (const point of path) {
      expect(isWalkableAt(map, point)).toBe(true);
    }
  });

  it("does not cut diagonally through a blocked corner", () => {
    const map = openMap();
    // Block the two orthogonal neighbours of a diagonal step from (2,2) to
    // (3,3): (3,2) and (2,3). A corner-cutting path would slip through.
    setWalkable(map, 3, 2, false);
    setWalkable(map, 2, 3, false);

    const path = findPath(
      map,
      { x: 2.5, y: 2.5 },
      { x: 3.5, y: 3.5 },
      new Set(),
    );

    // A route still exists around the corner, but it must not step straight
    // from (2,2) to (3,3) through the blocked tiles.
    expect(path.length).toBeGreaterThan(0);
    for (const point of path) {
      expect(isWalkableAt(map, point)).toBe(true);
    }
    const stepsDirectly = path.some(
      (p) => Math.floor(p.x) === 3 && Math.floor(p.y) === 3,
    );
    expect(stepsDirectly).toBe(true);
  });

  it("treats building-blocked tiles as impassable", () => {
    const map = openMap();
    // A wall at column 6 with a single gap at row 0 forces the route through
    // the gap; the blocked set adds a second wall at column 3, also with a gap
    // at row 0, that the path must avoid as well.
    wall(map, 6, 1, map.height - 1);
    const blocked = new Set<string>();
    for (let ty = 1; ty < map.height; ty += 1) blocked.add(tileKey(3, ty));

    const path = findPath(map, { x: 1.5, y: 5.5 }, { x: 9.5, y: 5.5 }, blocked);

    expect(path.length).toBeGreaterThan(0);
    for (const point of path) {
      const tx = Math.floor(point.x);
      const ty = Math.floor(point.y);
      expect(blocked.has(`${tx},${ty}`)).toBe(false);
      expect(isWalkableAt(map, point)).toBe(true);
    }
    // The detour must actually pass through the gap at row 0.
    expect(path.some((p) => Math.floor(p.y) === 0)).toBe(true);
  });

  it("returns an empty path when the goal is fully enclosed", () => {
    const map = openMap();
    // Ring the goal tile (5,5) with unwalkable tiles.
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        setWalkable(map, 5 + dx, 5 + dy, false);
      }
    }
    const path = findPath(
      map,
      { x: 1.5, y: 1.5 },
      { x: 5.5, y: 5.5 },
      new Set(),
    );
    expect(path).toEqual([]);
  });

  it("approaches a blocked goal via a passable neighbour", () => {
    const map = openMap();
    setWalkable(map, 5, 5, false);
    const path = findPath(
      map,
      { x: 1.5, y: 1.5 },
      { x: 5.5, y: 5.5 },
      new Set(),
    );

    expect(path.length).toBeGreaterThan(0);
    // The route's last tile-centre waypoint is a passable neighbour of the
    // blocked goal; the final waypoint is the requested goal coordinate, which
    // the caller is responsible for resolving.
    const lastTileCentre = path[path.length - 2];
    expect(
      Math.floor(lastTileCentre.x) === 5 && Math.floor(lastTileCentre.y) === 5,
    ).toBe(false);
    expect(
      Math.hypot(lastTileCentre.x - 5.5, lastTileCentre.y - 5.5),
    ).toBeLessThanOrEqual(2);
    expect(path[path.length - 1]).toEqual({ x: 5.5, y: 5.5 });
  });

  it("is deterministic for the same inputs", () => {
    const map = openMap();
    const a = findPath(
      map,
      { x: 1.5, y: 1.5 },
      { x: 10.5, y: 10.5 },
      new Set(),
    );
    const b = findPath(
      map,
      { x: 1.5, y: 1.5 },
      { x: 10.5, y: 10.5 },
      new Set(),
    );
    expect(a).toEqual(b);
  });
});

describe("spreadDestination characterization", () => {
  it("returns the centre unchanged for a single unit", () => {
    const map = openMap();
    const center = { x: 5.5, y: 5.5 };
    expect(spreadDestination(center, 0, 1, map, new Set())).toEqual(center);
  });

  it("fans a group out to distinct destinations", () => {
    const map = openMap();
    const center = { x: 6.5, y: 6.5 };
    const destinations = [0, 1, 2, 3].map((i) =>
      spreadDestination(center, i, 4, map, new Set()),
    );
    const keys = new Set(destinations.map((d) => `${d.x},${d.y}`));
    expect(keys.size).toBeGreaterThan(1);
    for (const d of destinations) {
      expect(isWalkableAt(map, d)).toBe(true);
    }
  });

  it("falls back to the centre when the spread tile is blocked", () => {
    const map = openMap();
    const center = { x: 6.5, y: 6.5 };
    // Block every tile in the spread neighbourhood so no offset is walkable.
    for (let ty = 4; ty <= 9; ty += 1) {
      for (let tx = 4; tx <= 9; tx += 1) setWalkable(map, tx, ty, false);
    }
    const d = spreadDestination(center, 3, 4, map, new Set());
    expect(d).toEqual(center);
  });
});

describe("pathfinding helpers characterization", () => {
  it("converts world positions to tile keys by flooring", () => {
    expect(tileKey(3.9, 4.1)).toBe("3,4");
    expect(tileKey(0, 0)).toBe("0,0");
  });

  it("returns the world-space centre of a tile", () => {
    expect(tileCenter(3, 4)).toEqual({ x: 3.5, y: 4.5 });
  });

  it("measures Euclidean distance between world points", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("converts pixel offsets to world units using the tile size", () => {
    expect(pixelsToWorld(TILE)).toBe(1);
    expect(pixelsToWorld(TILE * 2)).toBe(2);
  });
});
