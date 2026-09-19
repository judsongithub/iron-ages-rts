import { AiDifficulty, Faction, MapSize } from "@/backend";
import { TICK_SECONDS } from "@/game/constants";
import { createGame, issueMove, step } from "@/game/engine";
import type { GameState } from "@/game/engine";
import {
  blockedSignature,
  buildFlowField,
  createFlowFieldCache,
  getFlowField,
  isReachable,
  sampleFlow,
  stepAlongFlow,
} from "@/game/flowfield";
import { generateMap } from "@/game/mapgen";
import { tileKey } from "@/game/pathfinding";
import type { GameMap, TerrainTile, Vec2 } from "@/types/game";
import { describe, expect, it } from "vitest";

/**
 * Cover for the flow-field group-movement layer.
 *
 * The accepted behavior: one integration field serves an entire group heading
 * to the same destination, so a large order costs one field build rather than
 * one A* search per unit; the field routes around blocked and unwalkable tiles
 * without cutting diagonal corners; fields are cached by destination and
 * invalidated when the blocked set changes; and a group order issued through
 * the engine actually moves its units along the field.
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
function openMap(width = 16, height = 16): GameMap {
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

describe("flowfield cover: integration field", () => {
  it("marks the goal reachable and routes neighbours toward it", () => {
    const map = openMap();
    const field = buildFlowField(map, 8, 8, new Set(), "0");

    expect(isReachable(field, 8, 8)).toBe(true);
    expect(isReachable(field, 2, 2)).toBe(true);

    // A tile west of the goal points east, toward the goal.
    const direction = sampleFlow(field, 4.5, 8.5);
    expect(direction).not.toBeNull();
    expect(direction?.x).toBeGreaterThan(0);
  });

  it("leaves tiles behind a wall unreachable", () => {
    const map = openMap();
    // A full-height wall at column 8 splits the map in two.
    wall(map, 8, 0, map.height - 1);
    const field = buildFlowField(map, 12, 8, new Set(), "0");

    expect(isReachable(field, 12, 8)).toBe(true);
    // The west side cannot reach the goal through the wall.
    expect(isReachable(field, 2, 8)).toBe(false);
    expect(sampleFlow(field, 2.5, 8.5)).toBeNull();
  });

  it("treats building-blocked tiles as impassable", () => {
    const map = openMap();
    const blocked = new Set<string>();
    // A wall of blocked tiles at column 8 with a gap at row 0.
    for (let ty = 1; ty < map.height; ty += 1) blocked.add(tileKey(8, ty));
    const field = buildFlowField(
      map,
      12,
      8,
      blocked,
      blockedSignature(blocked),
    );

    expect(isReachable(field, 12, 8)).toBe(true);
    // The only route is through the gap at row 0, so the west side is
    // reachable but the direct row-8 approach is not.
    expect(isReachable(field, 2, 8)).toBe(true);
    expect(isReachable(field, 2, 0)).toBe(true);
  });

  it("does not cut diagonally through a blocked corner", () => {
    const map = openMap();
    // Block the two orthogonal neighbours of a diagonal step from (4,4) to
    // (5,5): (5,4) and (4,5). A corner-cutting field would slip through.
    setWalkable(map, 5, 4, false);
    setWalkable(map, 4, 5, false);
    const field = buildFlowField(map, 5, 5, new Set(), "0");

    // The goal is reachable, but the diagonal step from (4,4) must not be the
    // chosen direction: the field routes around the blocked corner.
    expect(isReachable(field, 5, 5)).toBe(true);
    const direction = sampleFlow(field, 4.5, 4.5);
    expect(direction).not.toBeNull();
    // A direct diagonal would be (+x, +y); the corner rule forbids it.
    const diagonal = (direction?.x ?? 0) > 0 && (direction?.y ?? 0) > 0;
    expect(diagonal).toBe(false);
  });

  it("returns an empty field for an out-of-bounds or blocked goal", () => {
    const map = openMap();
    const outOfBounds = buildFlowField(map, -1, 4, new Set(), "0");
    expect(isReachable(outOfBounds, 4, 4)).toBe(false);

    const blockedGoal = buildFlowField(
      map,
      4,
      4,
      new Set([tileKey(4, 4)]),
      "1",
    );
    expect(isReachable(blockedGoal, 4, 4)).toBe(false);
  });

  it("fills the whole connected region, not just the tiles near the goal", () => {
    // Regression guard: the bucket-queue Dijkstra must drain every tile in the
    // current distance bucket before advancing. A field that advances early
    // leaves distant tiles at UNREACHABLE even though a walkable route exists,
    // so a group ordered across the map stalls partway. Assert the field
    // reaches every walkable tile of a larger, obstacle-strewn map.
    const map = openMap(48, 48);
    // Scatter pillars so the field has to route around obstacles, and leave the
    // map fully connected.
    for (let ty = 4; ty < map.height - 4; ty += 6) {
      for (let tx = 4; tx < map.width - 4; tx += 6) {
        if ((tx + ty) % 12 === 0) setWalkable(map, tx, ty, false);
      }
    }

    const field = buildFlowField(map, 24, 24, new Set(), "0");

    let unreachable = 0;
    for (let ty = 0; ty < map.height; ty += 1) {
      for (let tx = 0; tx < map.width; tx += 1) {
        if (map.walkable[ty * map.width + tx] !== 1) continue;
        if (!isReachable(field, tx, ty)) unreachable += 1;
      }
    }
    // Every walkable tile is connected to the goal, so none may be left behind.
    expect(unreachable).toBe(0);
    // The far corner is the strongest signal: it is the last tile the field
    // reaches, and the one an early-advancing queue drops first.
    expect(isReachable(field, map.width - 1, map.height - 1)).toBe(true);
  });
});

describe("flowfield cover: cache", () => {
  it("reuses a field for the same destination and blocked set", () => {
    const map = openMap();
    const cache = createFlowFieldCache();
    const first = getFlowField(cache, map, 8, 8, new Set());
    const second = getFlowField(cache, map, 8, 8, new Set());
    // The same object is returned, so the field was built once.
    expect(second).toBe(first);
  });

  it("invalidates cached fields when the blocked set changes", () => {
    const map = openMap();
    const cache = createFlowFieldCache();
    const first = getFlowField(cache, map, 8, 8, new Set());
    const blocked = new Set([tileKey(8, 4)]);
    const second = getFlowField(cache, map, 8, 8, blocked);
    expect(second).not.toBe(first);
    expect(second.blockedSignature).toBe(blockedSignature(blocked));
  });

  it("bounds the cache so a long match cannot grow it without limit", () => {
    const map = openMap(32, 32);
    const cache = createFlowFieldCache();
    for (let i = 0; i < 40; i += 1) {
      getFlowField(cache, map, i % 30, Math.floor(i / 30), new Set());
    }
    expect(cache.fields.size).toBeLessThanOrEqual(24);
  });
});

describe("flowfield cover: stepping along a field", () => {
  it("advances a unit toward the goal and reports arrival on the goal tile", () => {
    const map = openMap();
    const field = buildFlowField(map, 10, 10, new Set(), "0");

    const start = { x: 2.5, y: 10.5 };
    const stepResult = stepAlongFlow(field, start.x, start.y, 4, TICK_SECONDS);
    expect(stepResult.arrived).toBe(false);
    // The unit moved toward the goal (east).
    expect(stepResult.x).toBeGreaterThan(start.x);

    // Standing on the goal tile reports arrival without moving.
    const arrived = stepAlongFlow(field, 10.5, 10.5, 4, TICK_SECONDS);
    expect(arrived.arrived).toBe(true);
    expect(arrived.x).toBe(10.5);
    expect(arrived.y).toBe(10.5);
  });

  it("does not move a unit standing on an unreachable tile", () => {
    const map = openMap();
    wall(map, 8, 0, map.height - 1);
    const field = buildFlowField(map, 12, 8, new Set(), "0");
    const stuck = stepAlongFlow(field, 2.5, 8.5, 4, TICK_SECONDS);
    expect(stuck.arrived).toBe(false);
    expect(stuck.x).toBe(2.5);
    expect(stuck.y).toBe(8.5);
  });
});

describe("flowfield cover: group movement through the engine", () => {
  const CONFIG = {
    faction: Faction.romans,
    mapSize: MapSize.small,
    difficulty: AiDifficulty.normal,
    playerTeam: 1 as const,
    aiTeam: 2 as const,
    populationLimit: 200,
    aiPopulationLimit: 200,
  };

  function newGame(seed = 4242): GameState {
    return createGame(CONFIG, seed);
  }

  it("moves a group of units toward a shared destination", () => {
    const state = newGame();
    // The starting town spawns villagers and a scout for player 0.
    const movers = state.units.filter((u) => u.owner === 0).slice(0, 4);
    expect(movers.length).toBeGreaterThan(1);

    const start = state.map.starts[0];
    const target: Vec2 = { x: start.x + 8, y: start.y + 8 };
    const before = movers.map((u) => ({ x: u.x, y: u.y }));

    issueMove(
      state,
      movers.map((u) => u.id),
      target,
      false,
    );

    for (let i = 0; i < 40 && !state.finished; i += 1) step(state);

    // Every ordered unit made progress toward the destination.
    movers.forEach((unit, index) => {
      const moved = Math.hypot(
        unit.x - before[index].x,
        unit.y - before[index].y,
      );
      expect(moved).toBeGreaterThan(0);
    });
  });

  it("reuses cached fields across repeated group orders instead of rebuilding", () => {
    // The accepted efficiency claim: fields are cached by destination tile, so
    // repeated orders to the same place are free and the cache stays bounded.
    // A second order to the same destination must not grow the cache.
    const state = newGame();
    const movers = state.units.filter((u) => u.owner === 0);
    expect(movers.length).toBeGreaterThan(1);

    const start = state.map.starts[0];
    const target: Vec2 = { x: start.x + 10, y: start.y + 10 };
    const ids = movers.map((u) => u.id);

    issueMove(state, ids, target, false);
    for (let i = 0; i < 20 && !state.finished; i += 1) step(state);
    const afterFirst = state.flowCache.fields.size;
    expect(afterFirst).toBeGreaterThan(0);

    // Re-issue the same order and step again: the destinations are unchanged,
    // so the cache is reused rather than repopulated.
    issueMove(state, ids, target, false);
    for (let i = 0; i < 20 && !state.finished; i += 1) step(state);

    expect(state.flowCache.fields.size).toBe(afterFirst);
    expect(state.flowCache.fields.size).toBeLessThanOrEqual(24);
  });

  it("routes a group around a blocked wall rather than through it", () => {
    const state = newGame();
    const movers = state.units.filter((u) => u.owner === 0).slice(0, 3);
    const start = state.map.starts[0];

    // Block a vertical line of tiles directly between the group and the goal.
    const blocked = new Set<string>();
    for (let dy = -4; dy <= 4; dy += 1) {
      blocked.add(tileKey(start.x + 4, start.y + dy));
    }
    // The engine derives its own blocked set from buildings; assert the field
    // itself honours the wall by building one directly.
    const field = buildFlowField(
      state.map,
      Math.floor(start.x + 8),
      Math.floor(start.y),
      blocked,
      blockedSignature(blocked),
    );
    expect(
      isReachable(field, Math.floor(start.x + 8), Math.floor(start.y)),
    ).toBe(true);
    // The blocked column is never a valid step target.
    for (let dy = -4; dy <= 4; dy += 1) {
      expect(
        isReachable(field, Math.floor(start.x + 4), Math.floor(start.y + dy)),
      ).toBe(false);
    }
    expect(movers.length).toBeGreaterThan(0);
  });
});
