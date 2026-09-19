import {
  BUILDING_STATS,
  HOSPITAL_HEAL_RADIUS,
  TILE,
  UNIT_STATS,
} from "@/game/constants";
import { buildingCenter } from "@/game/engine";
import type { GameState } from "@/game/engine";
import type {
  Building,
  BuildingKind,
  GameMap,
  Marker,
  ResourceNode,
  TerrainTile,
  Unit,
} from "@/types/game";
import { playerColor } from "@/types/game";

export interface RenderCamera {
  x: number;
  y: number;
  zoom: number;
}

export interface RenderOptions {
  camera: RenderCamera;
  /** Selected unit ids. */
  selectedUnitIds: readonly number[];
  /** Selected building id. */
  selectedBuildingId: number | null;
  /** Whether to draw the fog-of-war overlay. */
  showFog: boolean;
  /** Placement ghost, if a building is being placed. */
  ghost: {
    tx: number;
    ty: number;
    size: number;
    valid: boolean;
    /** Distribution radius to preview, for Energy Distribution Centers. */
    distributionRadius: number;
  } | null;
  /** Whether the player is player 0 (fog applies only to them). */
  playerId: 0 | 1;
  /**
   * Terrain sampling stride. 1 draws every tile; higher values skip tiles and
   * let the background show through, which the performance monitor uses to
   * shed load on large maps.
   */
  terrainStride?: number;
}

/** Subtle blue used for coverage and distribution overlays. */
const COVERAGE_FILL = "rgba(86, 150, 214, 0.13)";
const COVERAGE_RING = "rgba(120, 178, 232, 0.55)";
const DISTRIBUTION_RING = "rgba(96, 158, 226, 0.85)";
const ATTACK_RING = "rgba(206, 74, 58, 0.85)";
const LOS_FILL = "rgba(236, 224, 190, 0.10)";
const HEAL_RING = "rgba(110, 196, 132, 0.85)";

const TERRAIN_COLORS: Record<TerrainTile["kind"], [number, number, number]> = {
  grass: [86, 104, 62],
  dirt: [104, 88, 62],
  rock: [92, 92, 98],
  water: [52, 74, 104],
  sand: [156, 138, 96],
};

function shade(color: [number, number, number], factor: number): string {
  const r = Math.max(0, Math.min(255, Math.round(color[0] * factor)));
  const g = Math.max(0, Math.min(255, Math.round(color[1] * factor)));
  const b = Math.max(0, Math.min(255, Math.round(color[2] * factor)));
  return `rgb(${r}, ${g}, ${b})`;
}

function factionColor(state: GameState, owner: number): string {
  return playerColor(
    state.players.map((p) => p.color),
    owner,
  );
}

function healthColor(ratio: number): string {
  if (ratio > 0.6) return "rgb(96, 176, 96)";
  if (ratio > 0.3) return "rgb(214, 176, 74)";
  return "rgb(196, 74, 52)";
}

function nodeColor(node: ResourceNode): string {
  switch (node.kind) {
    case "tree":
      return "rgb(58, 92, 52)";
    case "gold":
      return "rgb(214, 178, 74)";
    case "stone":
      return "rgb(150, 152, 160)";
    case "forage":
      return "rgb(150, 176, 82)";
    case "animal":
      return "rgb(176, 142, 104)";
    case "farm":
      return "rgb(196, 168, 92)";
  }
}

function drawTerrain(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  camera: RenderCamera,
  viewport: { width: number; height: number },
  fog: Uint8Array | null,
  stride: number,
): void {
  const halfW = viewport.width / 2 / camera.zoom;
  const halfH = viewport.height / 2 / camera.zoom;
  const minX = Math.max(0, Math.floor(camera.x - halfW) - 1);
  const maxX = Math.min(map.width - 1, Math.ceil(camera.x + halfW) + 1);
  const minY = Math.max(0, Math.floor(camera.y - halfH) - 1);
  const maxY = Math.min(map.height - 1, Math.ceil(camera.y + halfH) + 1);
  const step = Math.max(1, Math.floor(stride));
  const cell = Math.ceil(camera.zoom) * step + 1;

  for (let ty = minY; ty <= maxY; ty += step) {
    for (let tx = minX; tx <= maxX; tx += step) {
      const tile = map.tiles[ty * map.width + tx];
      const base = TERRAIN_COLORS[tile.kind];
      // Height shading gives the terrain visible relief.
      const factor = 0.72 + tile.height * 0.55;
      const sx = (tx - camera.x) * camera.zoom + viewport.width / 2;
      const sy = (ty - camera.y) * camera.zoom + viewport.height / 2;
      ctx.fillStyle = shade(base, factor);
      ctx.fillRect(Math.floor(sx), Math.floor(sy), cell, cell);

      if (fog) {
        const visibility = fog[ty * map.width + tx];
        if (visibility === 0) {
          ctx.fillStyle = "rgba(8, 8, 10, 0.96)";
          ctx.fillRect(Math.floor(sx), Math.floor(sy), cell, cell);
        } else if (visibility === 1) {
          ctx.fillStyle = "rgba(8, 8, 12, 0.5)";
          ctx.fillRect(Math.floor(sx), Math.floor(sy), cell, cell);
        }
      }
    }
  }
}

/**
 * Draws the ground-layer range overlays for the current selection: the
 * brightened line-of-sight area, the red attack range, and the blue
 * distribution range. Coverage circles for a selected Energy Distribution
 * Center are drawn here too, hidden under unexplored fog.
 */
function drawSelectionOverlays(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  options: RenderOptions,
  viewport: { width: number; height: number },
  fog: Uint8Array | null,
): void {
  const { camera } = options;
  const toScreen = (x: number, y: number): { x: number; y: number } => ({
    x: (x - camera.x) * camera.zoom + viewport.width / 2,
    y: (y - camera.y) * camera.zoom + viewport.height / 2,
  });

  const selectedUnits = state.units.filter((u) =>
    options.selectedUnitIds.includes(u.id),
  );
  const selectedBuilding =
    options.selectedBuildingId === null
      ? null
      : (state.buildings.find((b) => b.id === options.selectedBuildingId) ??
        null);

  // --- line of sight: brighten tiles inside the selected vision radius ---
  const losSources: Array<{ x: number; y: number; radius: number }> = [];
  for (const unit of selectedUnits) {
    losSources.push({ x: unit.x, y: unit.y, radius: 7 });
  }
  if (selectedBuilding) {
    const c = buildingCenter(selectedBuilding);
    losSources.push({ x: c.x, y: c.y, radius: 8 + selectedBuilding.size });
  }
  if (losSources.length > 0) {
    const { width, height } = state.map;
    for (const source of losSources) {
      const r = Math.ceil(source.radius);
      const cx = Math.floor(source.x);
      const cy = Math.floor(source.y);
      for (let ty = cy - r; ty <= cy + r; ty += 1) {
        for (let tx = cx - r; tx <= cx + r; tx += 1) {
          if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
          if (Math.hypot(tx - cx, ty - cy) > source.radius) continue;
          if (fog && fog[ty * width + tx] === 0) continue;
          const p = toScreen(tx, ty);
          ctx.fillStyle = LOS_FILL;
          ctx.fillRect(
            Math.floor(p.x),
            Math.floor(p.y),
            Math.ceil(camera.zoom) + 1,
            Math.ceil(camera.zoom) + 1,
          );
        }
      }
    }
  }

  // --- attack range (red) for selected entities that can attack ----------
  const attackRings: Array<{ x: number; y: number; radius: number }> = [];
  for (const unit of selectedUnits) {
    const stats = UNIT_STATS[unit.kind];
    if (stats.attack > 0 && stats.range > 0) {
      attackRings.push({ x: unit.x, y: unit.y, radius: stats.range });
    }
  }
  if (selectedBuilding) {
    const stats = BUILDING_STATS[selectedBuilding.kind];
    if (stats.attack > 0 && stats.range > 0) {
      const c = buildingCenter(selectedBuilding);
      attackRings.push({ x: c.x, y: c.y, radius: stats.range });
    }
  }
  ctx.strokeStyle = ATTACK_RING;
  ctx.lineWidth = 1.5;
  for (const ring of attackRings) {
    const p = toScreen(ring.x, ring.y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, ring.radius * camera.zoom, 0, Math.PI * 2);
    ctx.stroke();
  }

  // --- distribution range (blue) for selected distributors ---------------
  const distributionRings: Array<{ x: number; y: number; radius: number }> = [];
  if (selectedBuilding) {
    const radius = BUILDING_STATS[selectedBuilding.kind].distributionRadius;
    if (radius > 0) {
      const c = buildingCenter(selectedBuilding);
      distributionRings.push({ x: c.x, y: c.y, radius });
    }
  }
  ctx.strokeStyle = DISTRIBUTION_RING;
  ctx.lineWidth = 1.5;
  for (const ring of distributionRings) {
    const p = toScreen(ring.x, ring.y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, ring.radius * camera.zoom, 0, Math.PI * 2);
    ctx.stroke();
  }

  // --- heal radius (green) for a selected Hospital ------------------------
  if (selectedBuilding && selectedBuilding.kind === "hospital") {
    const c = buildingCenter(selectedBuilding);
    const p = toScreen(c.x, c.y);
    ctx.strokeStyle = HEAL_RING;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, HOSPITAL_HEAL_RADIUS * camera.zoom, 0, Math.PI * 2);
    ctx.stroke();
  }

  // --- coverage circle for a selected Energy Distribution Center ---------
  // Only a completed, owned distributor shows its active coverage circle, and
  // only over explored ground.
  if (
    selectedBuilding &&
    selectedBuilding.owner === options.playerId &&
    selectedBuilding.progress >= 1 &&
    BUILDING_STATS[selectedBuilding.kind].distributionRadius > 0
  ) {
    drawCoverageCircle(ctx, state, selectedBuilding, camera, viewport, fog);
  }
}

/** Draws the subtle blue coverage disc of one Energy Distribution Center. */
function drawCoverageCircle(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  building: Building,
  camera: RenderCamera,
  viewport: { width: number; height: number },
  fog: Uint8Array | null,
): void {
  const radius = BUILDING_STATS[building.kind].distributionRadius;
  if (radius <= 0) return;
  const c = buildingCenter(building);
  const sx = (c.x - camera.x) * camera.zoom + viewport.width / 2;
  const sy = (c.y - camera.y) * camera.zoom + viewport.height / 2;
  const screenRadius = radius * camera.zoom;

  // Translucent fill, clipped to explored tiles so fog hides the coverage.
  ctx.save();
  ctx.beginPath();
  ctx.arc(sx, sy, screenRadius, 0, Math.PI * 2);
  ctx.clip();
  if (fog) {
    const { width, height } = state.map;
    const minX = Math.max(0, Math.floor(c.x - radius) - 1);
    const maxX = Math.min(width - 1, Math.ceil(c.x + radius) + 1);
    const minY = Math.max(0, Math.floor(c.y - radius) - 1);
    const maxY = Math.min(height - 1, Math.ceil(c.y + radius) + 1);
    for (let ty = minY; ty <= maxY; ty += 1) {
      for (let tx = minX; tx <= maxX; tx += 1) {
        if (fog[ty * width + tx] === 0) continue;
        const px = (tx - camera.x) * camera.zoom + viewport.width / 2;
        const py = (ty - camera.y) * camera.zoom + viewport.height / 2;
        ctx.fillStyle = COVERAGE_FILL;
        ctx.fillRect(
          Math.floor(px),
          Math.floor(py),
          Math.ceil(camera.zoom) + 1,
          Math.ceil(camera.zoom) + 1,
        );
      }
    }
  } else {
    ctx.fillStyle = COVERAGE_FILL;
    ctx.fillRect(
      sx - screenRadius,
      sy - screenRadius,
      screenRadius * 2,
      screenRadius * 2,
    );
  }
  ctx.restore();

  // Thin boundary ring, clipped to explored tiles so fog hides it too.
  ctx.save();
  ctx.beginPath();
  ctx.arc(sx, sy, screenRadius, 0, Math.PI * 2);
  ctx.clip();
  if (fog) {
    const { width, height } = state.map;
    const minX = Math.max(0, Math.floor(c.x - radius) - 1);
    const maxX = Math.min(width - 1, Math.ceil(c.x + radius) + 1);
    const minY = Math.max(0, Math.floor(c.y - radius) - 1);
    const maxY = Math.min(height - 1, Math.ceil(c.y + radius) + 1);
    for (let ty = minY; ty <= maxY; ty += 1) {
      for (let tx = minX; tx <= maxX; tx += 1) {
        if (fog[ty * width + tx] === 0) continue;
        const px = (tx - camera.x) * camera.zoom + viewport.width / 2;
        const py = (ty - camera.y) * camera.zoom + viewport.height / 2;
        ctx.strokeStyle = COVERAGE_RING;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(
          Math.floor(px),
          Math.floor(py),
          Math.ceil(camera.zoom) + 1,
          Math.ceil(camera.zoom) + 1,
        );
      }
    }
  } else {
    ctx.strokeStyle = COVERAGE_RING;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, screenRadius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawNodes(
  ctx: CanvasRenderingContext2D,
  nodes: readonly ResourceNode[],
  camera: RenderCamera,
  viewport: { width: number; height: number },
  fog: Uint8Array | null,
  map: GameMap,
): void {
  for (const node of nodes) {
    if (node.depleted) continue;
    if (fog) {
      const tx = Math.floor(node.x);
      const ty = Math.floor(node.y);
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
      if (fog[ty * map.width + tx] === 0) continue;
    }
    const sx = (node.x - camera.x) * camera.zoom + viewport.width / 2;
    const sy = (node.y - camera.y) * camera.zoom + viewport.height / 2;
    const size = camera.zoom * (node.kind === "tree" ? 0.85 : 0.6);
    ctx.fillStyle = nodeColor(node);
    if (node.kind === "tree") {
      ctx.beginPath();
      ctx.arc(sx, sy, size * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(sx - size * 0.08, sy + size * 0.3, size * 0.16, size * 0.4);
    } else {
      ctx.beginPath();
      ctx.arc(sx, sy, size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Accent colour drawn on a building's roof stripe, by kind. */
function buildingAccent(kind: BuildingKind): string | null {
  switch (kind) {
    case "windmill":
      return "rgb(214, 208, 186)";
    case "watermill":
      return "rgb(120, 168, 196)";
    case "thermalPlant":
      return "rgb(196, 128, 72)";
    case "solarArray":
      return "rgb(96, 148, 196)";
    case "nuclearReactor":
      return "rgb(140, 208, 168)";
    case "hospital":
      return "rgb(214, 96, 96)";
    case "farm":
      return "rgb(176, 168, 92)";
    case "market":
      return "rgb(214, 178, 74)";
    default:
      return null;
  }
}

function drawBuildings(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  buildings: readonly Building[],
  camera: RenderCamera,
  viewport: { width: number; height: number },
  selectedBuildingId: number | null,
  fog: Uint8Array | null,
  map: GameMap,
): void {
  for (const building of buildings) {
    if (building.cancelled) continue;
    if (fog) {
      const cx = Math.floor(building.tx + building.size / 2);
      const cy = Math.floor(building.ty + building.size / 2);
      if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) continue;
      if (fog[cy * map.width + cx] === 0) continue;
    }
    const sx = (building.tx - camera.x) * camera.zoom + viewport.width / 2;
    const sy = (building.ty - camera.y) * camera.zoom + viewport.height / 2;
    const w = building.size * camera.zoom;
    const h = building.size * camera.zoom;

    // Foundation shadow.
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(sx + 2, sy + 3, w, h);

    // Body.
    const base = building.owner === 0 ? [150, 96, 72] : [96, 108, 150];
    const factor = building.progress < 1 ? 0.6 : 1;
    ctx.fillStyle = shade(base as [number, number, number], factor);
    ctx.fillRect(sx, sy, w, h);

    // Roof / banner stripe in the owner colour.
    ctx.fillStyle = factionColor(state, building.owner);
    ctx.fillRect(sx, sy, w, Math.max(2, camera.zoom * 0.22));

    // Kind accent stripe below the banner, so power and support structures
    // read apart from ordinary buildings at a glance.
    const accent = buildingAccent(building.kind);
    if (accent && camera.zoom >= 6) {
      ctx.fillStyle = accent;
      ctx.fillRect(
        sx,
        sy + Math.max(2, camera.zoom * 0.22),
        w,
        Math.max(1, camera.zoom * 0.14),
      );
    }

    // Outline.
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 0.5, sy + 0.5, w - 1, h - 1);

    // Construction progress.
    if (building.progress < 1) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(sx, sy + h - 4, w, 4);
      ctx.fillStyle = "rgb(214, 178, 74)";
      ctx.fillRect(sx, sy + h - 4, w * building.progress, 4);
    }

    // Selection ring.
    if (building.id === selectedBuildingId) {
      ctx.strokeStyle = "rgb(232, 196, 96)";
      ctx.lineWidth = 2;
      ctx.strokeRect(sx - 2, sy - 2, w + 4, h + 4);
    }

    // Health bar when damaged.
    if (building.health < building.maxHealth) {
      const ratio = building.health / building.maxHealth;
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(sx, sy - 6, w, 4);
      ctx.fillStyle = healthColor(ratio);
      ctx.fillRect(sx, sy - 6, w * ratio, 4);
    }

    // Hit flash.
    if (building.hitFlash > 0) {
      ctx.fillStyle = `rgba(255, 240, 220, ${building.hitFlash * 1.6})`;
      ctx.fillRect(sx, sy, w, h);
    }
  }
}

function drawUnits(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  units: readonly Unit[],
  camera: RenderCamera,
  viewport: { width: number; height: number },
  selectedUnitIds: readonly number[],
  fog: Uint8Array | null,
  map: GameMap,
): void {
  const selected = new Set(selectedUnitIds);
  for (const unit of units) {
    if (fog) {
      const tx = Math.floor(unit.x);
      const ty = Math.floor(unit.y);
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
      if (fog[ty * map.width + tx] === 0) continue;
    }
    const sx = (unit.x - camera.x) * camera.zoom + viewport.width / 2;
    const sy = (unit.y - camera.y) * camera.zoom + viewport.height / 2;
    const radius = Math.max(3, UNIT_STATS[unit.kind].radius * camera.zoom);

    // Selection ring.
    if (selected.has(unit.id)) {
      ctx.strokeStyle = "rgb(232, 196, 96)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, radius + 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Body.
    ctx.fillStyle = factionColor(state, unit.owner);
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fill();

    // Facing indicator.
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(
      sx + Math.cos(unit.facing) * radius * 1.4,
      sy + Math.sin(unit.facing) * radius * 1.4,
    );
    ctx.stroke();

    // Rank chevron.
    if (unit.rank > 0) {
      ctx.fillStyle = "rgb(240, 220, 150)";
      ctx.fillRect(sx - radius * 0.5, sy - radius - 5, radius, 2);
    }

    // Health bar when damaged or selected.
    if (unit.health < unit.maxHealth || selected.has(unit.id)) {
      const ratio = unit.health / unit.maxHealth;
      const barW = Math.max(14, radius * 2.4);
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(sx - barW / 2, sy - radius - 8, barW, 3);
      ctx.fillStyle = healthColor(ratio);
      ctx.fillRect(sx - barW / 2, sy - radius - 8, barW * ratio, 3);
    }

    // Carry indicator.
    if (unit.carrying > 0) {
      ctx.fillStyle = "rgb(220, 200, 140)";
      ctx.fillRect(sx + radius * 0.6, sy + radius * 0.6, 3, 3);
    }

    // Hit flash.
    if (unit.hitFlash > 0) {
      ctx.fillStyle = `rgba(255, 240, 220, ${unit.hitFlash * 1.8})`;
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawMarkers(
  ctx: CanvasRenderingContext2D,
  markers: readonly Marker[],
  camera: RenderCamera,
  viewport: { width: number; height: number },
): void {
  for (const marker of markers) {
    const sx = (marker.x - camera.x) * camera.zoom + viewport.width / 2;
    const sy = (marker.y - camera.y) * camera.zoom + viewport.height / 2;
    const progress = 1 - marker.ttl / 0.9;
    const radius = 6 + progress * 14;
    const color =
      marker.kind === "attack"
        ? "196, 74, 52"
        : marker.kind === "gather"
          ? "150, 176, 82"
          : marker.kind === "build"
            ? "214, 178, 74"
            : "116, 176, 214";
    ctx.strokeStyle = `rgba(${color}, ${1 - progress})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawGhost(
  ctx: CanvasRenderingContext2D,
  ghost: NonNullable<RenderOptions["ghost"]>,
  camera: RenderCamera,
  viewport: { width: number; height: number },
): void {
  const sx = (ghost.tx - camera.x) * camera.zoom + viewport.width / 2;
  const sy = (ghost.ty - camera.y) * camera.zoom + viewport.height / 2;
  const w = ghost.size * camera.zoom;

  ctx.fillStyle = ghost.valid
    ? "rgba(120, 200, 120, 0.35)"
    : "rgba(200, 80, 60, 0.35)";
  ctx.fillRect(sx, sy, w, w);
  ctx.strokeStyle = ghost.valid ? "rgb(120, 200, 120)" : "rgb(200, 80, 60)";
  ctx.lineWidth = 2;
  ctx.strokeRect(sx, sy, w, w);
}

/**
 * Draws the placement coverage preview for a distributor ghost on the terrain
 * ground layer, beneath units and buildings.
 */
function drawGhostCoverage(
  ctx: CanvasRenderingContext2D,
  ghost: NonNullable<RenderOptions["ghost"]>,
  camera: RenderCamera,
  viewport: { width: number; height: number },
): void {
  if (ghost.distributionRadius <= 0) return;
  const sx = (ghost.tx - camera.x) * camera.zoom + viewport.width / 2;
  const sy = (ghost.ty - camera.y) * camera.zoom + viewport.height / 2;
  const w = ghost.size * camera.zoom;
  const cx = sx + w / 2;
  const cy = sy + w / 2;
  const r = ghost.distributionRadius * camera.zoom;
  ctx.fillStyle = COVERAGE_FILL;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COVERAGE_RING;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

/** Renders one frame of the game world. */
export function renderGame(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  options: RenderOptions,
  viewport: { width: number; height: number },
): void {
  const { camera } = options;
  ctx.save();
  ctx.fillStyle = "rgb(18, 16, 14)";
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  const fog = options.showFog && options.playerId === 0 ? state.fog : null;

  drawTerrain(
    ctx,
    state.map,
    camera,
    viewport,
    fog,
    options.terrainStride ?? 1,
  );
  drawSelectionOverlays(ctx, state, options, viewport, fog);
  if (options.ghost) drawGhostCoverage(ctx, options.ghost, camera, viewport);
  drawNodes(ctx, state.map.nodes, camera, viewport, fog, state.map);
  drawBuildings(
    ctx,
    state,
    state.buildings,
    camera,
    viewport,
    options.selectedBuildingId,
    fog,
    state.map,
  );
  drawUnits(
    ctx,
    state,
    state.units,
    camera,
    viewport,
    options.selectedUnitIds,
    fog,
    state.map,
  );
  drawMarkers(ctx, state.markers, camera, viewport);
  if (options.ghost) drawGhost(ctx, options.ghost, camera, viewport);

  ctx.restore();
}

/** Renders the minimap. */
export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  camera: RenderCamera,
  viewport: { width: number; height: number },
  showFog: boolean,
): void {
  const { map } = state;
  const scaleX = viewport.width / map.width;
  const scaleY = viewport.height / map.height;

  ctx.fillStyle = "rgb(14, 12, 10)";
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  for (let ty = 0; ty < map.height; ty += 1) {
    for (let tx = 0; tx < map.width; tx += 1) {
      const tile = map.tiles[ty * map.width + tx];
      const base = TERRAIN_COLORS[tile.kind];
      const factor = 0.7 + tile.height * 0.5;
      ctx.fillStyle = shade(base, factor);
      ctx.fillRect(
        tx * scaleX,
        ty * scaleY,
        Math.ceil(scaleX),
        Math.ceil(scaleY),
      );
      if (showFog) {
        const visibility = state.fog[ty * map.width + tx];
        if (visibility === 0) {
          ctx.fillStyle = "rgba(6, 6, 8, 0.94)";
          ctx.fillRect(
            tx * scaleX,
            ty * scaleY,
            Math.ceil(scaleX),
            Math.ceil(scaleY),
          );
        } else if (visibility === 1) {
          ctx.fillStyle = "rgba(6, 6, 10, 0.45)";
          ctx.fillRect(
            tx * scaleX,
            ty * scaleY,
            Math.ceil(scaleX),
            Math.ceil(scaleY),
          );
        }
      }
    }
  }

  for (const node of map.nodes) {
    if (node.depleted) continue;
    ctx.fillStyle = nodeColor(node);
    ctx.fillRect(node.x * scaleX - 1, node.y * scaleY - 1, 2, 2);
  }

  for (const building of state.buildings) {
    if (building.cancelled) continue;
    ctx.fillStyle = factionColor(state, building.owner);
    ctx.fillRect(
      building.tx * scaleX,
      building.ty * scaleY,
      Math.max(2, building.size * scaleX),
      Math.max(2, building.size * scaleY),
    );
  }

  for (const unit of state.units) {
    ctx.fillStyle = factionColor(state, unit.owner);
    ctx.fillRect(unit.x * scaleX - 1, unit.y * scaleY - 1, 2, 2);
  }

  // Camera viewport rectangle.
  const halfW = viewport.width / 2 / camera.zoom;
  const halfH = viewport.height / 2 / camera.zoom;
  ctx.strokeStyle = "rgba(240, 220, 150, 0.9)";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    (camera.x - halfW) * scaleX,
    (camera.y - halfH) * scaleY,
    halfW * 2 * scaleX,
    halfH * 2 * scaleY,
  );
}

export { TILE, buildingCenter, BUILDING_STATS };
