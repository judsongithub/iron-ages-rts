import { AiDifficulty, Faction, MapSize } from "@/backend";
import { BUILDING_STATS } from "@/game/constants";
import { createGame } from "@/game/engine";
import type { GameState } from "@/game/engine";
import { renderGame } from "@/game/renderer";
import type { RenderOptions } from "@/game/renderer";
import type { Building, BuildingKind } from "@/types/game";
import { describe, expect, it } from "vitest";

/**
 * Cover for the terrain-ground coverage overlays.
 *
 * The accepted behavior: a placement preview for an Energy Distribution Center
 * draws its blue coverage circle on the terrain, a selected completed
 * distributor draws a subtle translucent blue fill plus a thin boundary ring,
 * coverage is hidden under unexplored fog, and the overlays are drawn on the
 * ground layer beneath units and buildings.
 *
 * The renderer is a pure function of state and a 2D context, so a recording
 * context captures exactly which primitives it emits and in what order.
 */

const CONFIG = {
  faction: Faction.romans,
  mapSize: MapSize.small,
  difficulty: AiDifficulty.normal,
  playerTeam: 1 as const,
  aiTeam: 2 as const,
  populationLimit: 200,
  aiPopulationLimit: 200,
};

const VIEWPORT = { width: 800, height: 600 };
const CAMERA = { x: 30, y: 30, zoom: 16 };

interface RecordedCall {
  method: string;
  args: unknown[];
  /** The fill/stroke style in effect when the call was made. */
  fillStyle: string;
  strokeStyle: string;
}

interface RecordingContext {
  calls: RecordedCall[];
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  save: () => void;
  restore: () => void;
  beginPath: () => void;
  arc: (...args: unknown[]) => void;
  fill: () => void;
  stroke: () => void;
  clip: () => void;
  fillRect: (...args: unknown[]) => void;
  strokeRect: (...args: unknown[]) => void;
  setTransform: () => void;
  moveTo: () => void;
  lineTo: () => void;
}

/** The renderer's coverage fill and ring colours. */
const COVERAGE_FILL = "rgba(86, 150, 214, 0.13)";
const COVERAGE_RING = "rgba(120, 178, 232, 0.55)";

function recordingContext(): RecordingContext {
  const calls: RecordedCall[] = [];
  const ctx: RecordingContext = {
    calls,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    save: () => {
      calls.push({
        method: "save",
        args: [],
        fillStyle: ctx.fillStyle,
        strokeStyle: ctx.strokeStyle,
      });
    },
    restore: () => {
      calls.push({
        method: "restore",
        args: [],
        fillStyle: ctx.fillStyle,
        strokeStyle: ctx.strokeStyle,
      });
    },
    beginPath: () => {
      calls.push({
        method: "beginPath",
        args: [],
        fillStyle: ctx.fillStyle,
        strokeStyle: ctx.strokeStyle,
      });
    },
    arc: (...args: unknown[]) => {
      calls.push({
        method: "arc",
        args,
        fillStyle: ctx.fillStyle,
        strokeStyle: ctx.strokeStyle,
      });
    },
    fill: () => {
      calls.push({
        method: "fill",
        args: [],
        fillStyle: ctx.fillStyle,
        strokeStyle: ctx.strokeStyle,
      });
    },
    stroke: () => {
      calls.push({
        method: "stroke",
        args: [],
        fillStyle: ctx.fillStyle,
        strokeStyle: ctx.strokeStyle,
      });
    },
    clip: () => {
      calls.push({
        method: "clip",
        args: [],
        fillStyle: ctx.fillStyle,
        strokeStyle: ctx.strokeStyle,
      });
    },
    fillRect: (...args: unknown[]) => {
      calls.push({
        method: "fillRect",
        args,
        fillStyle: ctx.fillStyle,
        strokeStyle: ctx.strokeStyle,
      });
    },
    strokeRect: (...args: unknown[]) => {
      calls.push({
        method: "strokeRect",
        args,
        fillStyle: ctx.fillStyle,
        strokeStyle: ctx.strokeStyle,
      });
    },
    setTransform: () => {
      calls.push({
        method: "setTransform",
        args: [],
        fillStyle: ctx.fillStyle,
        strokeStyle: ctx.strokeStyle,
      });
    },
    moveTo: () => {
      calls.push({
        method: "moveTo",
        args: [],
        fillStyle: ctx.fillStyle,
        strokeStyle: ctx.strokeStyle,
      });
    },
    lineTo: () => {
      calls.push({
        method: "lineTo",
        args: [],
        fillStyle: ctx.fillStyle,
        strokeStyle: ctx.strokeStyle,
      });
    },
  };
  return ctx;
}

function newGame(seed = 4242): GameState {
  return createGame(CONFIG, seed);
}

function makeBuilding(
  state: GameState,
  kind: BuildingKind,
  tx: number,
  ty: number,
  size: number,
  owner: 0 | 1 = 0,
  progress = 1,
): Building {
  const stats = BUILDING_STATS[kind];
  const building: Building = {
    id: state.nextId++,
    owner,
    kind,
    tx,
    ty,
    size,
    health: stats.maxHealth,
    maxHealth: stats.maxHealth,
    progress,
    cancelled: false,
    queue: [],
    queueTimer: 0,
    rally: null,
    farmNodeId: null,
    farmRegrowTimer: 0,
    farmHarvestTimer: 0,
    fuelTimer: 0,
    hitFlash: 0,
    attackCooldown: 0,
  };
  state.buildings.push(building);
  return building;
}

function baseOptions(overrides: Partial<RenderOptions> = {}): RenderOptions {
  return {
    camera: CAMERA,
    selectedUnitIds: [],
    selectedBuildingId: null,
    showFog: false,
    ghost: null,
    playerId: 0,
    ...overrides,
  };
}

/** The arcs the renderer emitted, in order. */
function arcs(
  ctx: RecordingContext,
): Array<{ x: number; y: number; r: number }> {
  return ctx.calls
    .filter((c) => c.method === "arc")
    .map((c) => ({
      x: c.args[0] as number,
      y: c.args[1] as number,
      r: c.args[2] as number,
    }));
}

/**
 * The coverage-ring arcs only. The selected-building distribution ring uses a
 * different stroke colour, so filtering on the coverage ring colour separates
 * the coverage circle from the plain distribution range indicator.
 */
function coverageArcs(
  ctx: RecordingContext,
): Array<{ x: number; y: number; r: number }> {
  return ctx.calls
    .filter((c) => c.method === "arc" && c.strokeStyle === COVERAGE_RING)
    .map((c) => ({
      x: c.args[0] as number,
      y: c.args[1] as number,
      r: c.args[2] as number,
    }));
}

describe("renderer cover: placement coverage preview", () => {
  it("draws a blue coverage circle for an Energy Distribution Center ghost", () => {
    const state = newGame();
    const ctx = recordingContext();
    const radius = BUILDING_STATS.energyDistribution.distributionRadius;

    renderGame(
      ctx as unknown as CanvasRenderingContext2D,
      state,
      baseOptions({
        ghost: {
          tx: 28,
          ty: 28,
          size: 3,
          valid: true,
          distributionRadius: radius,
        },
      }),
      VIEWPORT,
    );

    // The ghost coverage circle is centred on the footprint and scaled by zoom.
    const expectedX = (28 + 1.5 - CAMERA.x) * CAMERA.zoom + VIEWPORT.width / 2;
    const expectedY = (28 + 1.5 - CAMERA.y) * CAMERA.zoom + VIEWPORT.height / 2;
    const coverageArc = arcs(ctx).find(
      (a) => Math.abs(a.r - radius * CAMERA.zoom) < 0.001,
    );
    expect(coverageArc).toBeDefined();
    expect(coverageArc?.x).toBeCloseTo(expectedX, 5);
    expect(coverageArc?.y).toBeCloseTo(expectedY, 5);
  });

  it("draws no coverage circle for a ghost with no distribution radius", () => {
    const state = newGame();
    const ctx = recordingContext();

    renderGame(
      ctx as unknown as CanvasRenderingContext2D,
      state,
      baseOptions({
        ghost: { tx: 28, ty: 28, size: 2, valid: true, distributionRadius: 0 },
      }),
      VIEWPORT,
    );

    expect(coverageArcs(ctx)).toHaveLength(0);
  });
});

describe("renderer cover: selected distributor coverage", () => {
  it("draws a coverage circle for a selected completed owned distributor", () => {
    const state = newGame();
    state.units = [];
    state.buildings = [];
    const distributor = makeBuilding(state, "energyDistribution", 28, 28, 3, 0);
    const ctx = recordingContext();
    const radius = BUILDING_STATS.energyDistribution.distributionRadius;

    renderGame(
      ctx as unknown as CanvasRenderingContext2D,
      state,
      baseOptions({ selectedBuildingId: distributor.id }),
      VIEWPORT,
    );

    const coverageArc = coverageArcs(ctx).find(
      (a) => Math.abs(a.r - radius * CAMERA.zoom) < 0.001,
    );
    expect(coverageArc).toBeDefined();
  });

  it("does not draw coverage for an unfinished distributor", () => {
    const state = newGame();
    state.units = [];
    state.buildings = [];
    const distributor = makeBuilding(
      state,
      "energyDistribution",
      28,
      28,
      3,
      0,
      0.5,
    );
    const ctx = recordingContext();
    const radius = BUILDING_STATS.energyDistribution.distributionRadius;

    renderGame(
      ctx as unknown as CanvasRenderingContext2D,
      state,
      baseOptions({ selectedBuildingId: distributor.id }),
      VIEWPORT,
    );

    expect(
      coverageArcs(ctx).some(
        (a) => Math.abs(a.r - radius * CAMERA.zoom) < 0.001,
      ),
    ).toBe(false);
  });

  it("does not draw coverage for an enemy distributor", () => {
    const state = newGame();
    state.units = [];
    state.buildings = [];
    const distributor = makeBuilding(state, "energyDistribution", 28, 28, 3, 1);
    const ctx = recordingContext();
    const radius = BUILDING_STATS.energyDistribution.distributionRadius;

    renderGame(
      ctx as unknown as CanvasRenderingContext2D,
      state,
      baseOptions({ selectedBuildingId: distributor.id }),
      VIEWPORT,
    );

    expect(
      coverageArcs(ctx).some(
        (a) => Math.abs(a.r - radius * CAMERA.zoom) < 0.001,
      ),
    ).toBe(false);
  });
});

describe("renderer cover: fog hides coverage", () => {
  it("skips coverage tiles under unexplored fog", () => {
    const state = newGame();
    state.units = [];
    state.buildings = [];
    const distributor = makeBuilding(state, "energyDistribution", 28, 28, 3, 0);
    // Mark every tile hidden so no coverage tile is drawn.
    state.fog.fill(0);
    const ctx = recordingContext();

    renderGame(
      ctx as unknown as CanvasRenderingContext2D,
      state,
      baseOptions({ selectedBuildingId: distributor.id, showFog: true }),
      VIEWPORT,
    );

    // With all tiles hidden, the coverage fill/ring loops emit no rects for the
    // circle. The terrain itself still fills the viewport, so assert that no
    // coverage-coloured fill or ring was emitted.
    const coverageFills = ctx.calls.filter(
      (c) => c.method === "fillRect" && c.fillStyle === COVERAGE_FILL,
    );
    const coverageRings = ctx.calls.filter(
      (c) => c.method === "strokeRect" && c.strokeStyle === COVERAGE_RING,
    );
    expect(coverageFills).toHaveLength(0);
    expect(coverageRings).toHaveLength(0);
    // No coverage ring arc is drawn for the fogged coverage either.
    expect(coverageArcs(ctx)).toHaveLength(0);
  });

  it("draws coverage tiles that are explored", () => {
    const state = newGame();
    state.units = [];
    state.buildings = [];
    const distributor = makeBuilding(state, "energyDistribution", 28, 28, 3, 0);
    // Mark every tile explored so the coverage loops emit per-tile rects.
    state.fog.fill(1);
    const ctx = recordingContext();

    renderGame(
      ctx as unknown as CanvasRenderingContext2D,
      state,
      baseOptions({ selectedBuildingId: distributor.id, showFog: true }),
      VIEWPORT,
    );

    const coverageFills = ctx.calls.filter(
      (c) => c.method === "fillRect" && c.fillStyle === COVERAGE_FILL,
    );
    const coverageRings = ctx.calls.filter(
      (c) => c.method === "strokeRect" && c.strokeStyle === COVERAGE_RING,
    );
    expect(coverageFills.length).toBeGreaterThan(0);
    expect(coverageRings.length).toBeGreaterThan(0);
  });
});

describe("renderer cover: ground-layer ordering", () => {
  it("draws coverage before units and buildings", () => {
    const state = newGame();
    state.units = [];
    state.buildings = [];
    const distributor = makeBuilding(state, "energyDistribution", 28, 28, 3, 0);
    const ctx = recordingContext();
    const radius = BUILDING_STATS.energyDistribution.distributionRadius;

    renderGame(
      ctx as unknown as CanvasRenderingContext2D,
      state,
      baseOptions({ selectedBuildingId: distributor.id }),
      VIEWPORT,
    );

    const coverageIndex = ctx.calls.findIndex(
      (c) =>
        c.method === "arc" &&
        c.strokeStyle === COVERAGE_RING &&
        Math.abs((c.args[2] as number) - radius * CAMERA.zoom) < 0.001,
    );
    // The building's selection ring is drawn later, in drawBuildings.
    const selectionRingIndex = ctx.calls.findIndex(
      (c) => c.method === "strokeRect" && c.strokeStyle === "rgb(232, 196, 96)",
    );
    expect(coverageIndex).toBeGreaterThanOrEqual(0);
    expect(selectionRingIndex).toBeGreaterThan(coverageIndex);
  });
});
