import { AiDifficulty, Faction, MapSize } from "@/backend";
import { MAP_DIMENSIONS } from "@/game/constants";
import {
  createRng,
  generateMap,
  isBuildable,
  isWalkable,
  tileAt,
} from "@/game/mapgen";
import { describe, expect, it } from "vitest";

describe("createRng", () => {
  it("is deterministic for a given seed and differs across seeds", () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    const seqC = [c(), c(), c()];
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });

  it("produces values in [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 200; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("generateMap", () => {
  it("uses the configured dimensions for each map size", () => {
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

  it("returns null for out-of-bounds tiles", () => {
    const map = generateMap(MapSize.small, 3);
    expect(tileAt(map, -1, 0)).toBeNull();
    expect(tileAt(map, map.width, 0)).toBeNull();
    expect(tileAt(map, 0, map.height)).toBeNull();
    expect(isWalkable(map, -1, -1)).toBe(false);
  });
});

describe("map config", () => {
  it("accepts the three faction and difficulty options", () => {
    expect(Object.values(Faction)).toEqual(
      expect.arrayContaining([
        Faction.romans,
        Faction.mongols,
        Faction.vikings,
      ]),
    );
    expect(Object.values(AiDifficulty)).toEqual(
      expect.arrayContaining([
        AiDifficulty.easy,
        AiDifficulty.normal,
        AiDifficulty.hard,
      ]),
    );
  });
});
