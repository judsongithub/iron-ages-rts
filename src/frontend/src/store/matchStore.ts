import { MatchResult } from "@/backend";
import { TICK_SECONDS } from "@/game/constants";
import {
  type GameState,
  acceptInvestment,
  advanceAge,
  areAllies,
  availableUpgrades,
  blockedTilesForOwner,
  buildingCost,
  buyResource,
  cancelBuilding,
  cancelInvestment,
  cancelQueueItem,
  contractsFor,
  createGame,
  declineInvestment,
  energyDeficit,
  energyProductionRate,
  energyUpkeepRate,
  enqueueUnit,
  farmFoodRate,
  getControlGroup,
  globalPopulationCap,
  hasUpgrade,
  isAlly,
  isEnemy,
  issueAttack,
  issueAttackMove,
  issueBuild,
  issueGather,
  issueMove,
  issueRepair,
  issueStop,
  lowerGlobalPopulationCap,
  lowerRenderDetail,
  placeBuilding,
  population,
  powerStateFor,
  productionMultiplier,
  proposalsFor,
  proposeInvestment,
  requestResources,
  researchUpgrade,
  sellResource,
  sendResources,
  setControlGroup,
  setRallyPoint,
  setRenderDetail,
  setStance,
  sharesVision,
  step,
  unitCost,
} from "@/game/engine";
import type {
  Age,
  Building,
  BuildingKind,
  GameEvent,
  InvestmentContract,
  InvestmentProposal,
  Marker,
  MatchConfig,
  MatchOutcome,
  PlayerId,
  PlayerState,
  PowerState,
  RenderDetail,
  ResourceKind,
  ResourcePool,
  Stance,
  Unit,
  UnitKind,
  UpgradeDefinition,
  UpgradeKind,
  Vec2,
} from "@/types/game";
import { create } from "zustand";

export interface HudSnapshot {
  resources: ResourcePool;
  gatherRates: ResourcePool;
  age: Age;
  ageProgress: number;
  advancing: boolean;
  populationUsed: number;
  populationCap: number;
  /** Lobby-configured population ceiling for the player. */
  populationLimit: number;
  /** Effective global ceiling after any auto-scaling reduction. */
  globalPopulationCap: number;
  elapsed: number;
  energyDeficit: boolean;
  /** Global grid state for the player: standard, lowPower, or blackout. */
  powerState: Exclude<PowerState, "unpowered">;
  /** Energy generated per second by the player's completed structures. */
  energyProduction: number;
  /** Energy drawn per second by the player's units and structures. */
  energyUpkeep: number;
  /** Food per second added by the player's automated farms. */
  farmFoodRate: number;
  /** The player's team, 1-6. */
  team: number;
  /** The first opponent's team, 1-6. Kept for single-rival consumers. */
  enemyTeam: number;
  /** Whether the player and the first opponent are on the same team. */
  allied: boolean;
  /** Whether the player shares line of sight with allies. */
  sharesVision: boolean;
  /** Current render detail tier chosen by the performance monitor. */
  renderDetail: RenderDetail;
  /** The first opponent's age. Kept for single-rival consumers. */
  enemyAge: Age;
  /** The first opponent's used population. Kept for single-rival consumers. */
  enemyPopulation: number;
  /** Every non-human player, in lobby slot order. */
  opponents: OpponentSummary[];
}

/** A read-only summary of one non-human player for the HUD. */
export interface OpponentSummary {
  /** Lobby slot index, used as the diplomacy target id. */
  id: number;
  /** Lobby-assigned team, 1-6. */
  team: number;
  age: Age;
  /** Population currently used by the opponent. */
  population: number;
  /** Lobby-assigned commander color. */
  color: string;
  /** Whether the opponent is on the player's team. */
  allied: boolean;
  /** Whether the opponent is an enemy of the player. */
  enemy: boolean;
}

interface MatchStoreState {
  game: GameState | null;
  hud: HudSnapshot | null;
  events: GameEvent[];
  markers: Marker[];
  /** Bumped every tick so canvas consumers can re-render. */
  revision: number;
  outcome: MatchOutcome | null;
  start: (config: MatchConfig, seed: number) => void;
  reset: () => void;
  tick: (dt: number) => void;
  /** Command wrappers that operate on the live simulation. */
  move: (unitIds: number[], target: Vec2, queued: boolean) => void;
  attackMove: (unitIds: number[], target: Vec2, queued: boolean) => void;
  attack: (unitIds: number[], targetId: number, queued: boolean) => void;
  gather: (unitIds: number[], nodeId: number, queued: boolean) => void;
  build: (unitIds: number[], buildingId: number, queued: boolean) => void;
  repair: (unitIds: number[], buildingId: number, queued: boolean) => void;
  stop: (unitIds: number[]) => void;
  applyStance: (unitIds: number[], stance: Stance) => void;
  assignGroup: (group: number, unitIds: number[]) => void;
  recallGroup: (group: number) => number[];
  train: (buildingId: number, kind: UnitKind) => boolean;
  cancelTrain: (buildingId: number) => void;
  place: (
    kind: BuildingKind,
    tx: number,
    ty: number,
    builderIds: number[],
  ) => Building | null;
  cancelPlacement: (buildingId: number) => void;
  rally: (buildingId: number, target: Vec2) => void;
  advance: () => boolean;
  /** Sells a resource at the Market for Money; returns Money gained. */
  sell: (resource: ResourceKind, amount: number) => number;
  /** Buys a resource at the Market with Money; returns the amount bought. */
  buy: (resource: ResourceKind, amount: number) => number;
  /** Sends a financial-aid gift of resources to another player. */
  send: (to: PlayerId, resource: ResourceKind, amount: number) => boolean;
  /** Records a resource request to another player. */
  request: (to: PlayerId, resource: ResourceKind, amount: number) => boolean;
  /** Issues an investment proposal to another player. */
  propose: (
    to: PlayerId,
    principal: number,
    rate: number,
    intervalSeconds: number,
    payments: number,
  ) => InvestmentProposal | null;
  /** Accepts a pending investment proposal. */
  acceptProposal: (proposalId: number) => boolean;
  /** Declines a pending investment proposal. */
  declineProposal: (proposalId: number) => boolean;
  /** Cancels an active investment contract. */
  cancelContract: (contractId: number) => boolean;
  /** Pending proposals addressed to the player. */
  proposals: () => InvestmentProposal[];
  /** Active contracts the player is party to. */
  contracts: () => InvestmentContract[];
  /** Researches an upgrade at a Blacksmith, Fortress, or Market. */
  research: (buildingId: number, upgrade: UpgradeKind) => boolean;
  /** Upgrades a building can offer, with researched/affordability flags. */
  upgradesFor: (buildingId: number) => Array<{
    definition: UpgradeDefinition;
    researched: boolean;
    affordable: boolean;
    ageOk: boolean;
  }>;
  /** Whether the player has researched an upgrade. */
  hasUpgrade: (upgrade: UpgradeKind) => boolean;
  /** Whether two players are allies. */
  areAllies: (a: PlayerId, b: PlayerId) => boolean;
  /** Whether `other` is an enemy of the player. */
  isEnemy: (other: PlayerId) => boolean;
  /** Whether the player shares line of sight with `other`. */
  sharesVision: (other: PlayerId) => boolean;
  /** Tile keys blocked for the player, honouring allied pass-through. */
  blockedTiles: () => Set<string>;
  /** Production multiplier for a building under the current energy balance. */
  productionMultiplier: (buildingId: number) => number;
  /** Lowers the render detail tier; returns the new tier or null. */
  lowerRenderDetail: () => RenderDetail | null;
  /** Sets the render detail tier explicitly. */
  setRenderDetail: (detail: RenderDetail) => void;
  /** Lowers the global population cap for every player. */
  lowerGlobalPopulationCap: () => GameEvent | null;
  canAfford: (cost: Partial<ResourcePool>) => boolean;
  costOfUnit: (kind: UnitKind) => Partial<ResourcePool>;
  costOfBuilding: (kind: BuildingKind) => Partial<ResourcePool>;
}

function snapshot(game: GameState): HudSnapshot {
  const player: PlayerState = game.players[0];
  const pop = population(game, 0);
  const opponents: OpponentSummary[] = game.players
    .filter((p) => p.id !== 0)
    .map((p) => ({
      id: p.id,
      team: p.team,
      age: p.age,
      population: population(game, p.id).used,
      color: p.color,
      allied: areAllies(game, 0, p.id),
      enemy: isEnemy(game, 0, p.id),
    }));
  const first = opponents[0] ?? null;
  return {
    resources: { ...player.resources },
    gatherRates: { ...player.gatherRates },
    age: player.age,
    ageProgress: player.ageProgress,
    advancing: player.advancing,
    populationUsed: pop.used,
    populationCap: pop.cap,
    populationLimit: player.populationLimit,
    globalPopulationCap: globalPopulationCap(game),
    elapsed: game.elapsed,
    energyDeficit: energyDeficit(game, 0),
    powerState: powerStateFor(game, 0),
    energyProduction: energyProductionRate(game, 0),
    energyUpkeep: energyUpkeepRate(game, 0),
    farmFoodRate: farmFoodRate(game, 0),
    team: player.team,
    enemyTeam: first?.team ?? player.team,
    allied: first?.allied ?? false,
    sharesVision: player.sharesVision,
    renderDetail: game.renderDetail,
    enemyAge: first?.age ?? player.age,
    enemyPopulation: first?.population ?? 0,
    opponents,
  };
}

export const useMatchStore = create<MatchStoreState>((set, get) => ({
  game: null,
  hud: null,
  events: [],
  markers: [],
  revision: 0,
  outcome: null,

  start: (config, seed) => {
    const game = createGame(config, seed);
    set({
      game,
      hud: snapshot(game),
      events: [...game.events],
      markers: [...game.markers],
      revision: 0,
      outcome: null,
    });
  },

  reset: () =>
    set({
      game: null,
      hud: null,
      events: [],
      markers: [],
      revision: 0,
      outcome: null,
    }),

  tick: (dt) => {
    const game = get().game;
    if (!game) return;
    // Run a fixed number of simulation steps for the elapsed frame time.
    let remaining = Math.min(dt, 0.25);
    while (remaining > 0 && !game.finished) {
      step(game);
      remaining -= TICK_SECONDS;
    }
    set((state) => ({
      hud: snapshot(game),
      events: [...game.events],
      markers: [...game.markers],
      revision: state.revision + 1,
      outcome: game.outcome,
    }));
  },

  move: (unitIds, target, queued) => {
    const game = get().game;
    if (game) issueMove(game, unitIds, target, queued);
  },
  attackMove: (unitIds, target, queued) => {
    const game = get().game;
    if (game) issueAttackMove(game, unitIds, target, queued);
  },
  attack: (unitIds, targetId, queued) => {
    const game = get().game;
    if (game) issueAttack(game, unitIds, targetId, queued);
  },
  gather: (unitIds, nodeId, queued) => {
    const game = get().game;
    if (game) issueGather(game, unitIds, nodeId, queued);
  },
  build: (unitIds, buildingId, queued) => {
    const game = get().game;
    if (game) issueBuild(game, unitIds, buildingId, queued);
  },
  repair: (unitIds, buildingId, queued) => {
    const game = get().game;
    if (game) issueRepair(game, unitIds, buildingId, queued);
  },
  stop: (unitIds) => {
    const game = get().game;
    if (game) issueStop(game, unitIds);
  },
  applyStance: (unitIds, stance) => {
    const game = get().game;
    if (game) setStance(game, unitIds, stance);
  },
  assignGroup: (group, unitIds) => {
    const game = get().game;
    if (game) setControlGroup(game, group, unitIds);
  },
  recallGroup: (group) => {
    const game = get().game;
    return game ? getControlGroup(game, group) : [];
  },
  train: (buildingId, kind) => {
    const game = get().game;
    return game ? enqueueUnit(game, buildingId, kind) : false;
  },
  cancelTrain: (buildingId) => {
    const game = get().game;
    if (game) cancelQueueItem(game, buildingId);
  },
  place: (kind, tx, ty, builderIds) => {
    const game = get().game;
    return game ? placeBuilding(game, 0, kind, tx, ty, builderIds) : null;
  },
  cancelPlacement: (buildingId) => {
    const game = get().game;
    if (game) cancelBuilding(game, buildingId);
  },
  rally: (buildingId, target) => {
    const game = get().game;
    if (game) setRallyPoint(game, buildingId, target);
  },
  advance: () => {
    const game = get().game;
    return game ? advanceAge(game, 0) : false;
  },
  sell: (resource, amount) => {
    const game = get().game;
    return game ? sellResource(game, 0, resource, amount) : 0;
  },
  buy: (resource, amount) => {
    const game = get().game;
    return game ? buyResource(game, 0, resource, amount) : 0;
  },
  send: (to, resource, amount) => {
    const game = get().game;
    return game ? sendResources(game, 0, to, resource, amount) : false;
  },
  request: (to, resource, amount) => {
    const game = get().game;
    return game ? requestResources(game, 0, to, resource, amount) : false;
  },
  propose: (to, principal, rate, intervalSeconds, payments) => {
    const game = get().game;
    if (!game) return null;
    return proposeInvestment(
      game,
      0,
      to,
      principal,
      rate,
      intervalSeconds,
      payments,
    );
  },
  acceptProposal: (proposalId) => {
    const game = get().game;
    return game ? acceptInvestment(game, proposalId) : false;
  },
  declineProposal: (proposalId) => {
    const game = get().game;
    return game ? declineInvestment(game, proposalId) : false;
  },
  cancelContract: (contractId) => {
    const game = get().game;
    return game ? cancelInvestment(game, contractId) : false;
  },
  proposals: () => {
    const game = get().game;
    return game ? proposalsFor(game, 0) : [];
  },
  contracts: () => {
    const game = get().game;
    return game ? contractsFor(game, 0) : [];
  },
  research: (buildingId, upgrade) => {
    const game = get().game;
    return game ? researchUpgrade(game, 0, buildingId, upgrade) : false;
  },
  upgradesFor: (buildingId) => {
    const game = get().game;
    if (!game) return [];
    const building = game.buildings.find((b) => b.id === buildingId);
    if (!building) return [];
    return availableUpgrades(game, 0, building);
  },
  hasUpgrade: (upgrade) => {
    const game = get().game;
    return game ? hasUpgrade(game, 0, upgrade) : false;
  },
  areAllies: (a, b) => {
    const game = get().game;
    return game ? areAllies(game, a, b) : a === b;
  },
  isEnemy: (other) => {
    const game = get().game;
    return game ? isEnemy(game, 0, other) : other !== 0;
  },
  sharesVision: (other) => {
    const game = get().game;
    return game ? sharesVision(game, 0, other) : other === 0;
  },
  blockedTiles: () => {
    const game = get().game;
    return game ? blockedTilesForOwner(game, 0) : new Set<string>();
  },
  productionMultiplier: (buildingId) => {
    const game = get().game;
    if (!game) return 1;
    const building = game.buildings.find((b) => b.id === buildingId);
    return building ? productionMultiplier(game, building) : 1;
  },
  lowerRenderDetail: () => {
    const game = get().game;
    return game ? lowerRenderDetail(game) : null;
  },
  setRenderDetail: (detail) => {
    const game = get().game;
    if (game) setRenderDetail(game, detail);
  },
  lowerGlobalPopulationCap: () => {
    const game = get().game;
    return game ? lowerGlobalPopulationCap(game) : null;
  },
  canAfford: (cost) => {
    const game = get().game;
    if (!game) return false;
    const pool = game.players[0].resources;
    return (Object.keys(cost) as Array<keyof ResourcePool>).every(
      (key) => pool[key] >= (cost[key] ?? 0),
    );
  },
  costOfUnit: (kind) => {
    const game = get().game;
    return game ? unitCost(kind, game.players[0].faction) : {};
  },
  costOfBuilding: (kind) => {
    const game = get().game;
    return game ? buildingCost(kind, game.players[0].faction) : {};
  },
}));

export { MatchResult };
