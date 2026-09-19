import { MapSize } from "@/backend";
import { MAP_DIMENSIONS } from "@/game/constants";
import {
  createRng,
  generateMap,
  isBuildable,
  isWalkable,
  tileAt,
} from "@/game/mapgen";
import { describe, expect, it } from "vitest";

/**
 * Characterization baseline for procedural map generation.
 *
 * The request intentionally changes forest/resource density, so this file does
 * NOT assert node counts, density ratios, or the exact node mix. It protects
 * the structural invariants that must survive: dimensions, determinism, start
 * clearings, the guaranteed starting cluster, and tile access semantics.
 */
describe("mapgen characterization", () => {
  it("uses the configured dimensions for every map size", () => {
    for (const size of [
      MapSize.small,
      MapSize.medium,
      MapSize.large,
    ] as const) {
      const map = generateMap(size, 5);
      expect(map.width).toBe(MAP_DIMENSIONS[size].width);
      expect(map.height).toBe(MAP_DIMENSIONS[size].height);
      expect(map.tiles).toHaveLength(map.width * map.height);
    }
  });

  it("is deterministic for a given seed and differs across seeds", () => {
    const a = generateMap(MapSize.small, 99);
    const b = generateMap(MapSize.small, 99);
    const c = generateMap(MapSize.small, 100);
    const signature = (map: ReturnType<typeof generateMap>): string =>
      map.nodes.map((n) => `${n.kind}:${n.x}:${n.y}`).join("|");
    expect(signature(a)).toEqual(signature(b));
    expect(signature(a)).not.toEqual(signature(c));
  });

  it("places the two players at separate corner starts", () => {
    const map = generateMap(MapSize.small, 7);
    const [a, b] = map.starts;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(20);
  });

  it("carves buildable ground around each start", () => {
    const map = generateMap(MapSize.small, 11);
    for (const start of map.starts) {
      expect(
        isBuildable(map, Math.floor(start.x), Math.floor(start.y), 4),
      ).toBe(true);
    }
  });

  it("guarantees a starting resource cluster near each player", () => {
    const map = generateMap(MapSize.small, 11);
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
  });

  it("returns null for out-of-bounds tiles and treats them as unwalkable", () => {
    const map = generateMap(MapSize.small, 3);
    expect(tileAt(map, -1, 0)).toBeNull();
    expect(tileAt(map, map.width, 0)).toBeNull();
    expect(tileAt(map, 0, map.height)).toBeNull();
    expect(isWalkable(map, -1, -1)).toBe(false);
  });

  it("keeps every resource node on a walkable tile", () => {
    const map = generateMap(MapSize.small, 13);
    for (const node of map.nodes) {
      expect(isWalkable(map, Math.floor(node.x), Math.floor(node.y))).toBe(
        true,
      );
    }
  });

  it("produces a deterministic RNG stream in [0, 1)", () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const seqA = [a(), a(), a()];
    expect(seqA).toEqual([b(), b(), b()]);
    expect(seqA).not.toEqual([c(), c(), c()]);
    for (const value of seqA) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
