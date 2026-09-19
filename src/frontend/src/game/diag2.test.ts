import { MapSize } from "@/backend";
import { generateMap } from "@/game/mapgen";
import {
  distance,
  findPath,
  pixelsToWorld,
  spreadDestination,
  tileCenter,
  tileKey,
} from "@/game/pathfinding";
import { describe, expect, it } from "vitest";

describe("findPath", () => {
  it("returns a route between two walkable points", () => {
    const map = generateMap(MapSize.small, 21);
    const start = map.starts[0];
    const goal = { x: start.x + 6, y: start.y + 6 };
    const path = findPath(map, start, goal, new Set());
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).toEqual(goal);
  });

  it("returns a single waypoint when start and goal share a tile", () => {
    const map = generateMap(MapSize.small, 21);
    const start = map.starts[0];
    const path = findPath(map, start, { x: start.x, y: start.y }, new Set());
    expect(path).toEqual([{ x: start.x, y: start.y }]);
  });

  it("routes around blocked tiles", () => {
    const map = generateMap(MapSize.small, 21);
    const start = map.starts[0];
    const goal = { x: start.x + 4, y: start.y };
    const blocked = new Set<string>();
    for (let dy = -3; dy <= 3; dy += 1) {
      blocked.add(tileKey(start.x + 2, start.y + dy));
    }
    const path = findPath(map, start, goal, blocked);
    expect(path.length).toBeGreaterThan(0);
    for (const point of path) {
      expect(blocked.has(tileKey(point.x, point.y))).toBe(false);
    }
  });
});

describe("spreadDestination", () => {
  it("returns the centre for a single unit", () => {
    const map = generateMap(MapSize.small, 4);
    const center = { x: 20, y: 20 };
    expect(spreadDestination(center, 0, 1, map, new Set())).toEqual(center);
  });

  it("fans a group out to distinct destinations", () => {
    const map = generateMap(MapSize.small, 4);
    const center = { x: 20, y: 20 };
    const destinations = [0, 1, 2, 3].map((i) =>
      spreadDestination(center, i, 4, map, new Set()),
    );
    const unique = new Set(destinations.map((d) => `${d.x},${d.y}`));
    expect(unique.size).toBeGreaterThan(1);
  });
});

describe("coordinate helpers", () => {
  it("converts tiles to centres and pixels to world units", () => {
    expect(tileCenter(3, 4)).toEqual({ x: 3.5, y: 4.5 });
    expect(pixelsToWorld(64)).toBe(2);
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});
