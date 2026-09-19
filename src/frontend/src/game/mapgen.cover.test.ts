import { MapSize } from "@/backend";
import { generateMap, isWalkable } from "@/game/mapgen";
import { findPath } from "@/game/pathfinding";
import { describe, expect, it } from "vitest";

/**
 * Cover for the denser-forest map generation change.
 *
 * The request makes forests significantly denser while keeping clear walkable
 * corridors between the two starting Town Centers and preserving each player's
 * guaranteed starting resource cluster. These tests assert those accepted
 * outcomes directly, across several seeds so a single lucky map cannot pass.
 */
const SEEDS = [1, 7, 11, 42, 99, 4242];

describe("mapgen cover: dense forest", () => {
  it("makes trees dominate the resource node mix", () => {
    for (const seed of SEEDS) {
      const map = generateMap(MapSize.small, seed);
      const trees = map.nodes.filter((n) => n.kind === "tree").length;
      const total = map.nodes.length;
      expect(total).toBeGreaterThan(0);
      // Dense forest: wood is the clear majority of all nodes.
      expect(trees / total).toBeGreaterThan(0.5);
    }
  });

  it("spawns trees in tight clusters rather than isolated singles", () => {
    for (const seed of SEEDS) {
      const map = generateMap(MapSize.small, seed);
      const trees = map.nodes.filter((n) => n.kind === "tree");
      // A tree with at least one other tree within 2 tiles is clustered.
      const clustered = trees.filter((tree) =>
        trees.some(
          (other) =>
            other.id !== tree.id &&
            Math.hypot(other.x - tree.x, other.y - tree.y) <= 2,
        ),
      );
      expect(clustered.length / trees.length).toBeGreaterThan(0.5);
    }
  });

  it("outnumbers every other resource kind combined", () => {
    for (const seed of SEEDS) {
      const map = generateMap(MapSize.small, seed);
      const trees = map.nodes.filter((n) => n.kind === "tree").length;
      const others = map.nodes.length - trees;
      expect(trees).toBeGreaterThan(others);
    }
  });
});

describe("mapgen cover: walkable corridor between starts", () => {
  it("finds a walkable path from one starting Town Center to the other", () => {
    for (const seed of SEEDS) {
      const map = generateMap(MapSize.small, seed);
      const [a, b] = map.starts;
      const path = findPath(map, a, b, new Set());
      expect(path.length).toBeGreaterThan(0);
      // Every waypoint must sit on walkable ground.
      for (const point of path) {
        expect(isWalkable(map, Math.floor(point.x), Math.floor(point.y))).toBe(
          true,
        );
      }
    }
  });

  it("keeps the route direct rather than a long detour around forest", () => {
    for (const seed of SEEDS) {
      const map = generateMap(MapSize.small, seed);
      const [a, b] = map.starts;
      const path = findPath(map, a, b, new Set());
      expect(path.length).toBeGreaterThan(0);
      // A genuine corridor keeps the route close to the straight-line distance
      // between the two bases; a walled-in map would force a huge detour.
      const straight = Math.hypot(b.x - a.x, b.y - a.y);
      expect(path.length).toBeLessThan(straight * 2);
    }
  });
});

describe("mapgen cover: guaranteed starting clusters survive", () => {
  it("still spawns tree, gold, stone, and forage near each start", () => {
    for (const seed of SEEDS) {
      const map = generateMap(MapSize.small, seed);
      for (const start of map.starts) {
        const nearby = map.nodes.filter(
          (n) => Math.hypot(n.x - start.x, n.y - start.y) < 12,
        );
        const kinds = new Set(nearby.map((n) => n.kind));
        expect(kinds.has("tree")).toBe(true);
        expect(kinds.has("gold")).toBe(true);
        expect(kinds.has("stone")).toBe(true);
        expect(kinds.has("forage")).toBe(true);
      }
    }
  });
});
