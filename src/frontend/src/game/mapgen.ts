import { MAP_DIMENSIONS } from "@/game/constants";
import type {
  GameMap,
  NodeKind,
  ResourceNode,
  TerrainTile,
  Vec2,
} from "@/types/game";

/** Deterministic 32-bit PRNG (mulberry32). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Value-noise sampler built from a seeded lattice. */
function makeNoise(
  rng: () => number,
  size: number,
): (x: number, y: number) => number {
  const lattice = new Float32Array(size * size);
  for (let i = 0; i < lattice.length; i += 1) lattice[i] = rng();
  const at = (x: number, y: number): number => {
    const xi = ((x % size) + size) % size;
    const yi = ((y % size) + size) % size;
    return lattice[yi * size + xi];
  };
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  return (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const n00 = at(x0, y0);
    const n10 = at(x0 + 1, y0);
    const n01 = at(x0, y0 + 1);
    const n11 = at(x0 + 1, y0 + 1);
    const nx0 = n00 + (n10 - n00) * fx;
    const nx1 = n01 + (n11 - n01) * fx;
    return nx0 + (nx1 - nx0) * fy;
  };
}

function fbm(
  noise: (x: number, y: number) => number,
  x: number,
  y: number,
  octaves: number,
): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  for (let o = 0; o < octaves; o += 1) {
    value += noise(x * frequency, y * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / total;
}

function tileIndex(map: GameMap, tx: number, ty: number): number {
  return ty * map.width + tx;
}

export function tileAt(
  map: GameMap,
  tx: number,
  ty: number,
): TerrainTile | null {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return null;
  return map.tiles[tileIndex(map, tx, ty)];
}

export function isBuildable(
  map: GameMap,
  tx: number,
  ty: number,
  size: number,
): boolean {
  for (let y = ty; y < ty + size; y += 1) {
    for (let x = tx; x < tx + size; x += 1) {
      const tile = tileAt(map, x, y);
      if (!tile || !tile.buildable) return false;
    }
  }
  return true;
}

export function isWalkable(map: GameMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false;
  return map.walkable[ty * map.width + tx] === 1;
}

/** Writes a tile's fields and keeps the flat walkability grid in sync. */
function setTile(
  map: GameMap,
  tx: number,
  ty: number,
  height: number,
  kind: TerrainTile["kind"],
  walkable: boolean,
  buildable: boolean,
): void {
  const index = tileIndex(map, tx, ty);
  const tile = map.tiles[index];
  tile.height = height;
  tile.kind = kind;
  tile.walkable = walkable;
  tile.buildable = buildable;
  map.walkable[index] = walkable ? 1 : 0;
}

/**
 * Generates a fresh procedural map for the given size and seed.
 *
 * The generator is written for the largest footprint (456x456, ~208k tiles):
 * terrain lives in flat typed arrays, the corridor is rasterised by walking its
 * centreline instead of testing every tile against every sample point, and
 * forest is grown by seeded cluster expansion rather than rejection sampling.
 */
export function generateMap(
  size: "small" | "medium" | "large",
  seed: number,
  playerCount = 2,
): GameMap {
  const dims = MAP_DIMENSIONS[size] ?? MAP_DIMENSIONS.medium;
  const { width, height } = dims;
  const rng = createRng(seed);
  const noise = makeNoise(rng, 64);
  const count = Math.max(2, Math.floor(playerCount));

  const tiles: TerrainTile[] = new Array(width * height);
  for (let i = 0; i < tiles.length; i += 1) {
    tiles[i] = { height: 0, kind: "grass", buildable: false, walkable: false };
  }
  const map: GameMap = {
    width,
    height,
    tiles,
    nodes: [],
    starts: [],
    walkable: new Uint8Array(width * height),
  };

  // --- terrain height field -------------------------------------------------
  // Noise frequency scales with the map so a large map reads as a larger
  // landscape rather than a stretched small one.
  const featureScale = Math.max(18, Math.round(Math.min(width, height) / 8));
  for (let ty = 0; ty < height; ty += 1) {
    for (let tx = 0; tx < width; tx += 1) {
      const nx = tx / featureScale;
      const ny = ty / featureScale;
      const base = fbm(noise, nx, ny, 4);
      const ridge = fbm(noise, nx * 2.3 + 40, ny * 2.3 + 40, 3);
      let h = base * 0.75 + ridge * 0.25;

      // Gentle bowl so map edges are less buildable than the interior.
      const edgeX = Math.min(tx, width - 1 - tx) / (width * 0.5);
      const edgeY = Math.min(ty, height - 1 - ty) / (height * 0.5);
      const edge = Math.min(1, Math.min(edgeX, edgeY) * 2.2);
      h = h * 0.82 + edge * 0.18;

      let kind: TerrainTile["kind"] = "grass";
      if (h < 0.3) kind = "water";
      else if (h < 0.36) kind = "sand";
      else if (h < 0.52) kind = "grass";
      else if (h < 0.66) kind = "dirt";
      else kind = "rock";

      const walkable = kind !== "water" && h < 0.78;
      const buildable = walkable && kind !== "rock" && h < 0.7;
      setTile(map, tx, ty, h, kind, walkable, buildable);
    }
  }

  // --- start positions ------------------------------------------------------
  // Two players keep the classic opposite-corner layout. More players are
  // spread evenly around a ring inset from the map edge, with the first two
  // still landing near opposite corners.
  const margin = Math.floor(Math.min(width, height) * 0.14);
  const starts: Vec2[] = [];
  if (count === 2) {
    starts.push({ x: margin, y: margin });
    starts.push({ x: width - margin, y: height - margin });
  } else {
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) / 2 - margin;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 4;
      starts.push({
        x: Math.round(cx + Math.cos(angle) * radius),
        y: Math.round(cy + Math.sin(angle) * radius),
      });
    }
  }
  map.starts = starts;

  // Carve a clear, buildable clearing around each start.
  const clearing = Math.floor(Math.min(width, height) * 0.11);
  for (const start of starts) {
    for (let ty = start.y - clearing; ty <= start.y + clearing; ty += 1) {
      for (let tx = start.x - clearing; tx <= start.x + clearing; tx += 1) {
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
        const dist = Math.hypot(tx - start.x, ty - start.y);
        if (dist > clearing) continue;
        setTile(
          map,
          tx,
          ty,
          0.45,
          dist < clearing * 0.55 ? "dirt" : "grass",
          true,
          true,
        );
      }
    }
  }

  // --- guaranteed corridor between the two starts ---------------------------
  // A wide, winding lane of open ground connects the two bases so neither
  // player can be walled in by the dense forest that fills the rest of the map.
  // The lane is rasterised by stamping a disc along its centreline, which is
  // O(path length) instead of O(tiles x samples).
  const corridorHalfWidth = Math.max(
    2,
    Math.round(Math.min(width, height) * 0.035),
  );
  const corridorSteps = Math.max(
    24,
    Math.round(
      Math.hypot(starts[1].x - starts[0].x, starts[1].y - starts[0].y) / 2,
    ),
  );
  const corridor: Vec2[] = [];
  for (let i = 0; i <= corridorSteps; i += 1) {
    const t = i / corridorSteps;
    // Smooth lateral wobble keeps the lane organic without ever closing it.
    const wobble =
      Math.sin(t * Math.PI * 3) * Math.min(width, height) * 0.05 +
      Math.sin(t * Math.PI * 7 + 1.7) * Math.min(width, height) * 0.02;
    const nx = -(starts[1].y - starts[0].y);
    const ny = starts[1].x - starts[0].x;
    const len = Math.hypot(nx, ny) || 1;
    corridor.push({
      x: starts[0].x + (starts[1].x - starts[0].x) * t + (nx / len) * wobble,
      y: starts[0].y + (starts[1].y - starts[0].y) * t + (ny / len) * wobble,
    });
  }

  const stampDisc = (
    cx: number,
    cy: number,
    radius: number,
    apply: (tx: number, ty: number) => void,
  ): void => {
    const r = Math.ceil(radius);
    const r2 = radius * radius;
    const minX = Math.max(0, Math.floor(cx) - r);
    const maxX = Math.min(width - 1, Math.ceil(cx) + r);
    const minY = Math.max(0, Math.floor(cy) - r);
    const maxY = Math.min(height - 1, Math.ceil(cy) + r);
    for (let ty = minY; ty <= maxY; ty += 1) {
      const dy = ty - cy;
      for (let tx = minX; tx <= maxX; tx += 1) {
        const dx = tx - cx;
        if (dx * dx + dy * dy > r2) continue;
        apply(tx, ty);
      }
    }
  };

  for (const point of corridor) {
    stampDisc(point.x, point.y, corridorHalfWidth, (tx, ty) => {
      setTile(map, tx, ty, 0.45, "grass", true, true);
    });
  }

  // --- resource nodes -------------------------------------------------------
  let nodeId = 1;
  const nodes: ResourceNode[] = [];
  const addNode = (
    kind: NodeKind,
    x: number,
    y: number,
    amount: number,
  ): void => {
    nodes.push({
      id: nodeId,
      kind,
      x,
      y,
      amount,
      maxAmount: amount,
      depleted: false,
    });
    nodeId += 1;
  };

  const nodeAmount = (kind: NodeKind): number =>
    kind === "tree"
      ? 90 + Math.floor(rng() * 60)
      : kind === "gold"
        ? 320 + Math.floor(rng() * 180)
        : kind === "stone"
          ? 280 + Math.floor(rng() * 160)
          : kind === "forage"
            ? 140 + Math.floor(rng() * 80)
            : 80 + Math.floor(rng() * 40);

  // A tile may hold at most one node, so forests stay readable and the
  // occupancy test is a single typed-array lookup.
  const occupied = new Uint8Array(width * height);
  const corridorMask = new Uint8Array(width * height);
  for (const point of corridor) {
    stampDisc(point.x, point.y, corridorHalfWidth + 1, (tx, ty) => {
      corridorMask[ty * width + tx] = 1;
    });
  }

  const canPlaceNode = (tx: number, ty: number): boolean => {
    if (tx < 3 || ty < 3 || tx >= width - 3 || ty >= height - 3) return false;
    const index = ty * width + tx;
    if (occupied[index] === 1) return false;
    if (corridorMask[index] === 1) return false;
    const tile = map.tiles[index];
    if (!tile.walkable || tile.kind === "rock") return false;
    // Keep the immediate start clearings free of clutter.
    for (const s of starts) {
      if (Math.hypot(tx - s.x, ty - s.y) < clearing * 0.9) return false;
    }
    return true;
  };

  const placeNode = (kind: NodeKind, tx: number, ty: number): boolean => {
    if (!canPlaceNode(tx, ty)) return false;
    occupied[ty * width + tx] = 1;
    addNode(kind, tx + 0.5, ty + 0.5, nodeAmount(kind));
    return true;
  };

  // --- dense sprawling forests ---------------------------------------------
  // Forest is grown from a handful of seeds by cluster expansion, so wood
  // covers large contiguous sections of the map instead of scattering evenly.
  const forestSeeds = Math.max(6, Math.floor((width * height) / 9000));
  const forestTarget = Math.floor((width * height) / 26);
  let forestPlaced = 0;
  for (let s = 0; s < forestSeeds && forestPlaced < forestTarget; s += 1) {
    let sx = 0;
    let sy = 0;
    let found = false;
    for (let attempt = 0; attempt < 24 && !found; attempt += 1) {
      sx = 3 + Math.floor(rng() * (width - 6));
      sy = 3 + Math.floor(rng() * (height - 6));
      found = canPlaceNode(sx, sy);
    }
    if (!found) continue;

    // Grow the cluster outward from the seed with a random walk.
    const clusterSize = 120 + Math.floor(rng() * 260);
    let cx = sx;
    let cy = sy;
    for (let i = 0; i < clusterSize && forestPlaced < forestTarget; i += 1) {
      if (placeNode("tree", cx, cy)) forestPlaced += 1;
      // Bias the walk to stay local so the cluster stays contiguous.
      const drift = rng();
      if (drift < 0.35) cx += rng() < 0.5 ? 1 : -1;
      else if (drift < 0.7) cy += rng() < 0.5 ? 1 : -1;
      else {
        cx += rng() < 0.5 ? 1 : -1;
        cy += rng() < 0.5 ? 1 : -1;
      }
      cx = Math.max(3, Math.min(width - 4, cx));
      cy = Math.max(3, Math.min(height - 4, cy));
    }
  }

  // --- scattered non-wood resources ----------------------------------------
  const scatterCount = Math.floor((width * height) / 420);
  const scatterKinds: NodeKind[] = ["gold", "stone", "forage", "animal"];
  for (let i = 0; i < scatterCount; i += 1) {
    const tx = 3 + Math.floor(rng() * (width - 6));
    const ty = 3 + Math.floor(rng() * (height - 6));
    const kind = scatterKinds[Math.floor(rng() * scatterKinds.length)];
    placeNode(kind, tx, ty);
  }

  // Guarantee a fair starting cluster near each player.
  for (const start of starts) {
    const offsets: Array<[NodeKind, number, number, number]> = [
      ["tree", 5, -3, 120],
      ["tree", 6, 2, 120],
      ["tree", 3, 5, 120],
      ["gold", -4, 4, 400],
      ["stone", 4, -5, 350],
      ["forage", -3, -4, 180],
      ["animal", 2, 6, 100],
    ];
    for (const [kind, dx, dy, amount] of offsets) {
      const tx = start.x + dx;
      const ty = start.y + dy;
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
      const index = ty * width + tx;
      if (occupied[index] === 1) continue;
      occupied[index] = 1;
      const tile = map.tiles[index];
      tile.walkable = true;
      tile.buildable = false;
      map.walkable[index] = 1;
      addNode(kind, tx + 0.5, ty + 0.5, amount);
    }
  }

  map.nodes = nodes;
  return map;
}
