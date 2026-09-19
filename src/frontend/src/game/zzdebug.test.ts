import { buildFlowField } from "@/game/flowfield";
import { isWalkable } from "@/game/mapgen";
import type { GameMap, TerrainTile } from "@/types/game";
import { describe, expect, it } from "vitest";

function tile(walkable: boolean): TerrainTile {
  return {
    height: 0.45,
    kind: walkable ? "grass" : "water",
    buildable: walkable,
    walkable,
  };
}

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

describe("debug2", () => {
  it("checks walkability and field", () => {
    const map = openMap();
    console.log("walkable 8,8", isWalkable(map, 8, 8));
    console.log("walkable 8,4", isWalkable(map, 8, 4));
    console.log("walkable 9,8", isWalkable(map, 9, 8));
    const field = buildFlowField(map, 8, 8, new Set(), "0");
    console.log("field w/h", field.width, field.height);
    console.log("dist 9,8", field.distance[8 * field.width + 9]);
    console.log("dist 8,9", field.distance[9 * field.width + 8]);
    expect(true).toBe(true);
  });
});
