import {
  RESOURCE_GLYPH,
  RESOURCE_ORDER,
  RESOURCE_TEXT_CLASS,
} from "@/components/game/hudTokens";
import { Button } from "@/components/ui/button";
import {
  AGE_COSTS,
  BUILDING_STATS,
  BUILD_MENU,
  BUYABLE_RESOURCES,
  ENERGY_BUILDING_KINDS,
  ENERGY_GENERATION_RATE,
  INVESTMENT_DEFAULT_INTERVAL_SECONDS,
  INVESTMENT_DEFAULT_PAYMENTS,
  INVESTMENT_DEFAULT_PRINCIPAL,
  INVESTMENT_DEFAULT_RATE,
  INVESTMENT_MAX_INTERVAL_SECONDS,
  INVESTMENT_MAX_PAYMENTS,
  INVESTMENT_MAX_PRINCIPAL,
  INVESTMENT_MAX_RATE,
  INVESTMENT_MIN_INTERVAL_SECONDS,
  INVESTMENT_MIN_PRINCIPAL,
  INVESTMENT_MIN_RATE,
  MARKET_BUY_RATE,
  MARKET_SELL_RATE,
  SELLABLE_RESOURCES,
  UNIT_STATS,
} from "@/game/constants";
import {
  buildingLabel,
  buyValue,
  energyDrawOfBuilding,
  energyDrawOfUnit,
  factionEliteKind,
  isEnergyWeaponUnit,
  isFactionElite,
  powerStateForBuilding,
  powerStateForUnit,
  sellValue,
  unitLabel,
} from "@/game/engine";
import { useMatchStore } from "@/store/matchStore";
import { useSelectionStore } from "@/store/selectionStore";
import {
  type Age,
  type Building,
  type BuildingKind,
  POWER_STATE_LABELS,
  type PowerState,
  RESOURCE_LABELS,
  type ResourceKind,
  type ResourceNode,
  type ResourcePool,
  STANCE_LABELS,
  type Stance,
  type Unit,
  type UnitKind,
} from "@/types/game";
import { useState } from "react";

interface CommandPanelProps {
  units: readonly Unit[];
  building: Building | null;
  /** Enemy unit selected for inspection only, if any. */
  inspectedUnit: Unit | null;
  /** Enemy building selected for inspection only, if any. */
  inspectedBuilding: Building | null;
  /** Resource node selected for inspection only, if any. */
  inspectedNode: ResourceNode | null;
  /** Called when the player picks a building to place. */
  onPickBuild: (kind: BuildingKind | null) => void;
  /** Currently pending placement kind. */
  pendingBuild: BuildingKind | null;
}

const STANCES: readonly Stance[] = [
  "aggressive",
  "defensive",
  "standGround",
  "noAttack",
];

/** Human-readable label for a resource node kind. */
const NODE_LABELS: Record<ResourceNode["kind"], string> = {
  tree: "Forest",
  gold: "Gold Vein",
  stone: "Stone Outcrop",
  forage: "Forage Patch",
  animal: "Wild Game",
  farm: "Farm Plot",
};

/** Formats a signed energy draw rate, e.g. "-15 E/sec" or "+2 E/sec". */
function formatEnergyDraw(draw: number): string {
  const rounded = Math.round(draw * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${rounded > 0 ? "+" : ""}${text} E/sec`;
}

/** Formats a Money amount with thousands separators. */
function formatMoney(value: number): string {
  return Math.floor(value).toLocaleString("en-US");
}

/** Formats a rate fraction as a percentage, e.g. 0.15 -> "15%". */
function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** Formats a payout interval in seconds as whole minutes. */
function formatInterval(seconds: number): string {
  const minutes = seconds / 60;
  return Number.isInteger(minutes)
    ? `${minutes} min`
    : `${minutes.toFixed(1)} min`;
}

/** Energy per second a generating building kind contributes to the grid. */
function energyOutputOf(kind: BuildingKind): number {
  if (!ENERGY_BUILDING_KINDS.includes(kind)) return 0;
  return ENERGY_GENERATION_RATE[kind] ?? 0;
}

function CostChips({ cost }: { cost: Partial<ResourcePool> }) {
  const entries = RESOURCE_ORDER.filter((key) => (cost[key] ?? 0) > 0);
  if (entries.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {entries.map((key) => (
        <span
          key={key}
          className={`font-mono text-[10px] tabular-nums ${RESOURCE_TEXT_CLASS[key]}`}
        >
          {RESOURCE_GLYPH[key]}
          {cost[key]}
        </span>
      ))}
    </span>
  );
}

function HealthBar({ current, max }: { current: number; max: number }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  const color =
    ratio > 0.6
      ? "bg-health-full"
      : ratio > 0.3
        ? "bg-health-mid"
        : "bg-health-low";
  return (
    <span className="flex items-center gap-2">
      <span className="bar-track h-2 w-24 overflow-hidden rounded-[1px]">
        <span
          className={`block h-full ${color} transition-[width] duration-200`}
          style={{ width: `${ratio * 100}%` }}
        />
      </span>
      <span className="font-mono text-[10px] tabular-nums text-hud-muted">
        {Math.ceil(current)}/{max}
      </span>
    </span>
  );
}

/** Colour class for a resolved power state badge. */
function powerStateClass(state: PowerState): string {
  if (state === "standard") return "text-hud-accent";
  return "text-destructive";
}

/** A compact numeric field used by the investment composer. */
function NumberField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  ocid,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  ocid: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="label-stencil text-[9px] text-hud-muted">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          data-ocid={ocid}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
          className="h-6 w-20 rounded-sm border border-hud-border bg-black/40 px-1.5 font-mono text-[11px] tabular-nums text-hud-foreground outline-none focus-visible:border-hud-accent"
        />
        <span className="font-mono text-[10px] text-hud-muted">{suffix}</span>
      </span>
    </label>
  );
}

/**
 * Bottom command panel: selection portrait, health, stance controls,
 * training buttons, the villager build menu, and the Market / Diplomacy
 * surfaces.
 */
export function CommandPanel({
  units,
  building,
  inspectedUnit,
  inspectedBuilding,
  inspectedNode,
  onPickBuild,
  pendingBuild,
}: CommandPanelProps) {
  const [tab, setTab] = useState<"orders" | "build" | "market" | "diplomacy">(
    "orders",
  );
  const [sellAmount, setSellAmount] = useState(100);
  const [buyAmount, setBuyAmount] = useState(100);
  const [aidResource, setAidResource] = useState<ResourceKind>("food");
  const [aidAmount, setAidAmount] = useState(100);
  const [principal, setPrincipal] = useState(INVESTMENT_DEFAULT_PRINCIPAL);
  const [ratePercent, setRatePercent] = useState(
    Math.round(INVESTMENT_DEFAULT_RATE * 100),
  );
  const [intervalMinutes, setIntervalMinutes] = useState(
    Math.round(INVESTMENT_DEFAULT_INTERVAL_SECONDS / 60),
  );
  const [payments, setPayments] = useState(INVESTMENT_DEFAULT_PAYMENTS);
  /** Lobby slot of the opponent currently targeted by aid and investments. */
  const [targetId, setTargetId] = useState<number | null>(null);

  const train = useMatchStore((s) => s.train);
  const cancelTrain = useMatchStore((s) => s.cancelTrain);
  const advance = useMatchStore((s) => s.advance);
  const applyStance = useMatchStore((s) => s.applyStance);
  const canAfford = useMatchStore((s) => s.canAfford);
  const costOfUnit = useMatchStore((s) => s.costOfUnit);
  const costOfBuilding = useMatchStore((s) => s.costOfBuilding);
  const sell = useMatchStore((s) => s.sell);
  const buy = useMatchStore((s) => s.buy);
  const send = useMatchStore((s) => s.send);
  const request = useMatchStore((s) => s.request);
  const propose = useMatchStore((s) => s.propose);
  const acceptProposal = useMatchStore((s) => s.acceptProposal);
  const declineProposal = useMatchStore((s) => s.declineProposal);
  const cancelContract = useMatchStore((s) => s.cancelContract);
  const proposals = useMatchStore((s) => s.proposals);
  const contracts = useMatchStore((s) => s.contracts);
  const research = useMatchStore((s) => s.research);
  const upgradesFor = useMatchStore((s) => s.upgradesFor);
  const hasUpgrade = useMatchStore((s) => s.hasUpgrade);
  const areAllies = useMatchStore((s) => s.areAllies);
  const sharesVision = useMatchStore((s) => s.sharesVision);
  const hud = useMatchStore((s) => s.hud);
  const game = useMatchStore((s) => s.game);
  const faction = useMatchStore((s) => s.game?.players[0].faction ?? null);
  const selection = useSelectionStore();

  const hasVillager = units.some((u) => UNIT_STATS[u.kind].builder);
  const primary = units[0] ?? null;

  const isOwnBuilding = building !== null && building.owner === 0;
  const isMarket = isOwnBuilding && building.kind === "market";
  const isResearchBuilding =
    isOwnBuilding &&
    (building.kind === "blacksmith" || building.kind === "fortress");

  // Any inspect-only target (enemy unit/building or resource node) replaces the
  // normal order controls with a read-only stat sheet.
  const inspecting =
    inspectedUnit !== null ||
    inspectedBuilding !== null ||
    inspectedNode !== null;

  // --- inspection stat sheet ------------------------------------------------
  const inspectName = inspectedUnit
    ? unitLabel(inspectedUnit.kind)
    : inspectedBuilding
      ? buildingLabel(inspectedBuilding.kind)
      : inspectedNode
        ? NODE_LABELS[inspectedNode.kind]
        : "";
  const inspectType = inspectedUnit
    ? "Unit"
    : inspectedBuilding
      ? "Building"
      : inspectedNode
        ? "Resource Node"
        : "";
  const inspectHealth = inspectedUnit
    ? { current: inspectedUnit.health, max: inspectedUnit.maxHealth }
    : inspectedBuilding
      ? { current: inspectedBuilding.health, max: inspectedBuilding.maxHealth }
      : null;
  const inspectAttack = inspectedUnit
    ? UNIT_STATS[inspectedUnit.kind].attack
    : inspectedBuilding
      ? BUILDING_STATS[inspectedBuilding.kind].attack
      : 0;
  const inspectArmor = inspectedUnit
    ? UNIT_STATS[inspectedUnit.kind].armor
    : inspectedBuilding
      ? 0
      : 0;
  const inspectEnergyDraw = inspectedUnit
    ? energyDrawOfUnit(inspectedUnit)
    : inspectedBuilding
      ? energyDrawOfBuilding(inspectedBuilding)
      : 0;
  const inspectEnergyDependent = inspectedUnit
    ? isEnergyWeaponUnit(inspectedUnit.kind)
    : inspectedBuilding
      ? BUILDING_STATS[inspectedBuilding.kind].energyConsumer
      : false;
  const inspectPowerState: PowerState | null =
    !game || !inspectEnergyDependent
      ? null
      : inspectedUnit
        ? powerStateForUnit(game, inspectedUnit)
        : inspectedBuilding
          ? powerStateForBuilding(game, inspectedBuilding)
          : null;
  const inspectUnpowered = inspectPowerState === "unpowered";

  // The Fortress lists every faction elite; only the player's own may appear.
  const trainOptions: readonly UnitKind[] = building
    ? BUILDING_STATS[building.kind].trains.filter(
        (kind) =>
          !isFactionElite(kind) ||
          (faction !== null && kind === factionEliteKind(faction)),
      )
    : [];

  const upgrades =
    isResearchBuilding && building ? upgradesFor(building.id) : [];

  // Cost of the next age, used to gate the Advance Age button.
  const ageCost: Partial<ResourcePool> =
    hud && hud.age < 4 ? AGE_COSTS[(hud.age + 1) as Exclude<Age, 1>] : {};

  // --- market / diplomacy derived state -------------------------------------
  const money = hud ? Math.floor(hud.resources.money) : 0;
  const marketOpen = isMarket;
  const pendingProposals = proposals();
  const activeContracts = contracts();
  const incomingProposals = pendingProposals.filter((p) => p.to === 0);
  const outgoingProposals = pendingProposals.filter((p) => p.from === 0);
  // Every non-human player, in lobby slot order. The first is the default
  // target so a two-player match behaves exactly as before.
  const opponents = hud?.opponents ?? [];
  const target =
    opponents.find((o) => o.id === targetId) ?? opponents[0] ?? null;
  const targetPlayerId = target?.id ?? 1;
  const rivalTeam = target?.team ?? hud?.enemyTeam ?? 1;
  const allied = target?.allied ?? hud?.allied ?? false;
  const visionResearched = hasUpgrade("economicPartners");
  const rivalAlly = areAllies(0, targetPlayerId);

  const clampedPrincipal = Math.max(
    INVESTMENT_MIN_PRINCIPAL,
    Math.min(INVESTMENT_MAX_PRINCIPAL, Math.round(principal)),
  );
  const clampedRate = Math.max(
    INVESTMENT_MIN_RATE,
    Math.min(INVESTMENT_MAX_RATE, ratePercent / 100),
  );
  const clampedInterval = Math.max(
    INVESTMENT_MIN_INTERVAL_SECONDS,
    Math.min(INVESTMENT_MAX_INTERVAL_SECONDS, Math.round(intervalMinutes * 60)),
  );
  const clampedPayments = Math.max(
    1,
    Math.min(INVESTMENT_MAX_PAYMENTS, Math.round(payments)),
  );
  const payoutPerInterval = Math.floor(clampedPrincipal * clampedRate);
  const canPropose = marketOpen && money >= clampedPrincipal;

  const aidHeld = hud ? Math.floor(hud.resources[aidResource]) : 0;

  return (
    <div
      className="panel-iron texture-hud flex min-h-[132px] items-stretch gap-3 p-2"
      data-ocid="hud.command_panel"
    >
      {/* --- portrait / summary ------------------------------------------- */}
      <div className="flex w-56 shrink-0 flex-col gap-1 border-r border-hud-border pr-3">
        {inspecting ? (
          <div
            className="flex h-full flex-col gap-1"
            data-ocid="hud.inspect_panel"
          >
            <span className="label-stencil text-[10px] text-destructive">
              {inspectedNode ? "Resource Node" : `Enemy ${inspectType}`}
            </span>
            <span className="font-display text-base font-semibold text-hud-foreground">
              {inspectName}
            </span>
            <span className="font-mono text-[10px] text-hud-muted">
              {inspectType} · {inspectName}
            </span>
            {inspectHealth ? (
              <HealthBar
                current={inspectHealth.current}
                max={inspectHealth.max}
              />
            ) : (
              inspectedNode && (
                <span className="font-mono text-[10px] tabular-nums text-hud-muted">
                  {Math.floor(inspectedNode.amount)} / {inspectedNode.maxAmount}{" "}
                  remaining
                </span>
              )
            )}
            <span className="font-mono text-[10px] text-hud-muted">
              ATK {Math.round(inspectAttack)} · ARM {Math.round(inspectArmor)}
            </span>
            <span
              className="font-mono text-[10px] tabular-nums text-hud-muted"
              data-ocid="hud.inspect_energy_draw"
            >
              {formatEnergyDraw(inspectEnergyDraw)}
            </span>
            {inspectPowerState && (
              <span
                className={`font-mono text-[10px] ${powerStateClass(inspectPowerState)}`}
                data-ocid="hud.inspect_power_state"
              >
                {inspectUnpowered
                  ? "Unpowered — outside distribution grid"
                  : POWER_STATE_LABELS[inspectPowerState]}
              </span>
            )}
            <span className="mt-auto font-mono text-[10px] text-hud-muted">
              {inspectedNode
                ? "Inspect only — gather it with a villager"
                : "Inspect only — no orders available"}
            </span>
          </div>
        ) : units.length === 0 && !building ? (
          <div
            className="flex h-full flex-col justify-center"
            data-ocid="hud.command_panel.empty_state"
          >
            <span className="label-stencil text-[10px] text-hud-muted">
              No selection
            </span>
            <p className="mt-1 text-xs text-hud-muted">
              Left-click a unit or drag a box to select. Right-click to issue
              orders.
            </p>
          </div>
        ) : building ? (
          <>
            <span className="label-stencil text-[10px] text-hud-muted">
              {building.owner === 0 ? "Your structure" : "Enemy structure"}
            </span>
            <span className="font-display text-base font-semibold text-hud-foreground">
              {buildingLabel(building.kind)}
            </span>
            <span className="font-mono text-[10px] text-hud-muted">
              Building · {buildingLabel(building.kind)}
            </span>
            <HealthBar current={building.health} max={building.maxHealth} />
            {building.progress < 1 && (
              <span className="font-mono text-[10px] text-hud-accent">
                Construction {Math.round(building.progress * 100)}%
              </span>
            )}
            <span className="font-mono text-[10px] text-hud-muted">
              ATK {Math.round(BUILDING_STATS[building.kind].attack)} · ARM 0
            </span>
            <span className="font-mono text-[10px] tabular-nums text-hud-muted">
              {formatEnergyDraw(energyDrawOfBuilding(building))}
            </span>
            {BUILDING_STATS[building.kind].energyConsumer && game && (
              <span
                className={`font-mono text-[10px] ${powerStateClass(
                  powerStateForBuilding(game, building),
                )}`}
                data-ocid="hud.building_power_state"
              >
                {powerStateForBuilding(game, building) === "unpowered"
                  ? "Unpowered — outside distribution grid"
                  : POWER_STATE_LABELS[powerStateForBuilding(game, building)]}
              </span>
            )}
          </>
        ) : units.length === 1 && primary ? (
          <>
            <span className="label-stencil text-[10px] text-hud-muted">
              {primary.rank > 0 ? `Rank ${primary.rank}` : "Unit"}
            </span>
            <span className="font-display text-base font-semibold text-hud-foreground">
              {unitLabel(primary.kind)}
            </span>
            <HealthBar current={primary.health} max={primary.maxHealth} />
            <span className="font-mono text-[10px] text-hud-muted">
              ATK {Math.round(UNIT_STATS[primary.kind].attack)} · ARM{" "}
              {Math.round(UNIT_STATS[primary.kind].armor)} · SPD{" "}
              {UNIT_STATS[primary.kind].speed.toFixed(1)}
            </span>
            <span className="font-mono text-[10px] tabular-nums text-hud-muted">
              {formatEnergyDraw(energyDrawOfUnit(primary))}
            </span>
            {UNIT_STATS[primary.kind].energyUpkeep > 0 && game && (
              <span
                className={`font-mono text-[10px] ${powerStateClass(
                  powerStateForUnit(game, primary),
                )}`}
                data-ocid="hud.unit_power_state"
              >
                {POWER_STATE_LABELS[powerStateForUnit(game, primary)]}
              </span>
            )}
          </>
        ) : (
          <>
            <span className="label-stencil text-[10px] text-hud-muted">
              {units.length} units selected
            </span>
            <span className="font-display text-base font-semibold text-hud-foreground">
              Grouped host
            </span>
            <span className="font-mono text-[10px] text-hud-muted">
              {units.filter((u) => u.kind === "villager").length} villagers ·{" "}
              {units.filter((u) => u.kind !== "villager").length} soldiers
            </span>
          </>
        )}
      </div>

      {/* --- stance controls ---------------------------------------------- */}
      <div className="flex w-40 shrink-0 flex-col gap-1 border-r border-hud-border pr-3">
        <span className="label-stencil text-[10px] text-hud-muted">Stance</span>
        {inspecting ? (
          <p className="text-xs text-hud-muted">
            {inspectedNode
              ? "Resource nodes take no orders."
              : "Enemy units ignore your stance commands."}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-1">
              {STANCES.map((stance) => (
                <Button
                  key={stance}
                  type="button"
                  size="sm"
                  variant={
                    selection.stance === stance ? "default" : "secondary"
                  }
                  className="h-7 rounded-sm px-1 text-[10px]"
                  data-ocid={`hud.stance.${stance}`}
                  disabled={units.length === 0}
                  onClick={() => {
                    applyStance(selection.unitIds, stance);
                    selection.setStance(stance);
                  }}
                >
                  {STANCE_LABELS[stance]}
                </Button>
              ))}
            </div>
            <span className="mt-auto font-mono text-[10px] text-hud-muted">
              Hotkeys A / D / S / N
            </span>
          </>
        )}
      </div>

      {/* --- actions ------------------------------------------------------ */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="label-stencil text-[10px] text-hud-muted">
            {inspecting ? "Inspect" : building ? "Train" : "Orders"}
          </span>
          {!inspecting && (
            <div className="flex gap-1">
              {hasVillager && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant={tab === "orders" ? "default" : "secondary"}
                    className="h-6 rounded-sm px-2 text-[10px]"
                    data-ocid="hud.tab.orders"
                    onClick={() => setTab("orders")}
                  >
                    Orders
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={tab === "build" ? "default" : "secondary"}
                    className="h-6 rounded-sm px-2 text-[10px]"
                    data-ocid="hud.tab.build"
                    onClick={() => setTab("build")}
                  >
                    Build
                  </Button>
                </>
              )}
              <Button
                type="button"
                size="sm"
                variant={tab === "market" ? "default" : "secondary"}
                className="h-6 rounded-sm px-2 text-[10px]"
                data-ocid="hud.tab.market"
                onClick={() => setTab("market")}
              >
                Market
              </Button>
              <Button
                type="button"
                size="sm"
                variant={tab === "diplomacy" ? "default" : "secondary"}
                className="h-6 rounded-sm px-2 text-[10px]"
                data-ocid="hud.tab.diplomacy"
                onClick={() => setTab("diplomacy")}
              >
                Diplomacy
              </Button>
            </div>
          )}
          {!inspecting && (
            <span
              className="ml-auto font-mono text-[10px] tabular-nums text-resource-money"
              data-ocid="hud.market_money_balance"
            >
              {RESOURCE_GLYPH.money} {formatMoney(money)} Money
            </span>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-wrap content-start gap-1 overflow-y-auto">
          {inspecting && (
            <p
              className="px-1 py-2 text-xs text-hud-muted"
              data-ocid="hud.inspect_notice"
            >
              {inspectedNode
                ? "Resource node selected for inspection. No train, build, stance, research, market, or order actions are available."
                : `Enemy ${inspectType.toLowerCase()} selected for inspection. No train, build, stance, research, market, or order actions are available.`}
            </p>
          )}

          {!inspecting && building && trainOptions.length > 0 && (
            <>
              {trainOptions.map((kind) => {
                const cost = costOfUnit(kind);
                const affordable = canAfford(cost);
                const ageOk = hud ? UNIT_STATS[kind].minAge <= hud.age : false;
                return (
                  <Button
                    key={kind}
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-12 w-24 flex-col items-start gap-0.5 rounded-sm px-2 py-1"
                    data-ocid={`hud.train.${kind}`}
                    disabled={!affordable || !ageOk}
                    title={
                      !ageOk
                        ? "Requires a later age"
                        : affordable
                          ? `Train ${unitLabel(kind)}`
                          : "Insufficient resources"
                    }
                    onClick={() => train(building.id, kind)}
                  >
                    <span className="text-[11px] font-semibold text-hud-foreground">
                      {unitLabel(kind)}
                    </span>
                    <CostChips cost={cost} />
                  </Button>
                );
              })}
              {building.queue.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-12 w-24 flex-col items-start gap-0.5 rounded-sm px-2 py-1"
                  data-ocid="hud.cancel_train_button"
                  onClick={() => cancelTrain(building.id)}
                >
                  <span className="text-[11px] font-semibold text-hud-foreground">
                    Cancel
                  </span>
                  <span className="font-mono text-[10px] text-hud-muted">
                    {building.queue.length} queued
                  </span>
                </Button>
              )}
              {BUILDING_STATS[building.kind].advancesAge && (
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  className="h-12 w-28 flex-col items-start gap-0.5 rounded-sm px-2 py-1"
                  data-ocid="hud.advance_age_button"
                  disabled={
                    hud
                      ? hud.age >= 4 || hud.advancing || !canAfford(ageCost)
                      : true
                  }
                  title={
                    hud && hud.age >= 4
                      ? "Already at the final age"
                      : hud?.advancing
                        ? "Age advancement in progress"
                        : canAfford(ageCost)
                          ? "Advance to the next age"
                          : "Insufficient resources"
                  }
                  onClick={() => advance()}
                >
                  <span className="text-[11px] font-semibold">
                    {hud && hud.age >= 4 ? "Final Age" : "Advance Age"}
                  </span>
                  <span className="font-mono text-[10px] opacity-80">
                    {hud?.advancing ? "In progress…" : "Town Center"}
                  </span>
                </Button>
              )}
            </>
          )}

          {/* --- research ------------------------------------------------- */}
          {isResearchBuilding && building && upgrades.length > 0 && (
            <div
              className="flex w-full flex-col gap-1.5"
              data-ocid="hud.research_panel"
            >
              <span className="label-stencil text-[10px] text-hud-muted">
                Research
              </span>
              <div className="flex flex-wrap gap-1">
                {upgrades.map(
                  ({ definition, researched, affordable, ageOk }) => {
                    const disabled = researched || !affordable || !ageOk;
                    return (
                      <Button
                        key={definition.id}
                        type="button"
                        size="sm"
                        variant={researched ? "default" : "secondary"}
                        className="h-14 w-32 flex-col items-start gap-0.5 rounded-sm px-2 py-1"
                        data-ocid={`hud.research.${definition.id}`}
                        disabled={disabled}
                        title={
                          researched
                            ? `${definition.name} already researched`
                            : !ageOk
                              ? `Requires ${definition.minAge > 1 ? `Age ${definition.minAge}` : "an earlier age"}`
                              : affordable
                                ? definition.description
                                : "Insufficient resources"
                        }
                        onClick={() => research(building.id, definition.id)}
                      >
                        <span className="text-[11px] font-semibold text-hud-foreground">
                          {definition.name}
                        </span>
                        {researched ? (
                          <span className="font-mono text-[10px] text-hud-accent">
                            Researched
                          </span>
                        ) : (
                          <>
                            <CostChips cost={definition.cost} />
                            <span className="font-mono text-[10px] text-hud-muted">
                              {ageOk
                                ? definition.description
                                : `Age ${definition.minAge} required`}
                            </span>
                          </>
                        )}
                      </Button>
                    );
                  },
                )}
              </div>
            </div>
          )}

          {/* --- build menu, grouped by age --------------------------------- */}
          {!inspecting &&
            !building &&
            hasVillager &&
            tab === "build" &&
            BUILD_MENU.map((group) => {
              const visible = group.kinds.filter(
                (kind) => BUILDING_STATS[kind].minAge <= (hud?.age ?? 1),
              );
              if (visible.length === 0) return null;
              return (
                <div
                  key={group.section}
                  className="flex w-full flex-col gap-1"
                  data-ocid={`hud.build_section.${group.section.toLowerCase()}`}
                >
                  <span className="label-stencil text-[10px] text-hud-muted">
                    {group.section}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {visible.map((kind) => {
                      const cost = costOfBuilding(kind);
                      const affordable = canAfford(cost);
                      const ageOk = hud
                        ? BUILDING_STATS[kind].minAge <= hud.age
                        : false;
                      const radius = BUILDING_STATS[kind].distributionRadius;
                      const output = energyOutputOf(kind);
                      const upkeep = BUILDING_STATS[kind].energyUpkeep;
                      const baseTitle = !ageOk
                        ? "Requires a later age"
                        : affordable
                          ? `Place ${buildingLabel(kind)}`
                          : "Insufficient resources";
                      return (
                        <Button
                          key={kind}
                          type="button"
                          size="sm"
                          variant={
                            pendingBuild === kind ? "default" : "secondary"
                          }
                          className="h-14 w-28 flex-col items-start gap-0.5 rounded-sm px-2 py-1"
                          data-ocid={`hud.build.${kind}`}
                          disabled={!affordable || !ageOk}
                          title={
                            radius > 0
                              ? `${baseTitle} · Distribution radius ${radius} units`
                              : baseTitle
                          }
                          onClick={() =>
                            onPickBuild(pendingBuild === kind ? null : kind)
                          }
                        >
                          <span className="text-[11px] font-semibold text-hud-foreground">
                            {buildingLabel(kind)}
                          </span>
                          <CostChips cost={cost} />
                          {output > 0 && (
                            <span
                              className="font-mono text-[10px] text-resource-energy"
                              data-ocid={`hud.build_energy.${kind}`}
                            >
                              +{output} E/sec
                            </span>
                          )}
                          {output === 0 && upkeep > 0 && (
                            <span
                              className="font-mono text-[10px] text-destructive"
                              data-ocid={`hud.build_energy.${kind}`}
                            >
                              −{upkeep} E/sec
                            </span>
                          )}
                          {radius > 0 && (
                            <span className="font-mono text-[10px] text-hud-muted">
                              Grid {radius}u
                            </span>
                          )}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

          {!inspecting && !building && hasVillager && tab === "orders" && (
            <p className="px-1 py-2 text-xs text-hud-muted">
              Right-click ground to move, a resource to gather, an enemy to
              attack, or a damaged structure to repair. Hold Shift to queue
              orders.
            </p>
          )}

          {!inspecting && !building && !hasVillager && units.length > 0 && (
            <p className="px-1 py-2 text-xs text-hud-muted">
              Right-click to move or attack. Hold Shift to queue orders. Press H
              to hold position.
            </p>
          )}

          {/* --- market tab ------------------------------------------------- */}
          {!inspecting && tab === "market" && (
            <div
              className="flex w-full flex-col gap-2"
              data-ocid="hud.market_panel"
            >
              {!marketOpen && (
                <p
                  className="px-1 text-xs text-hud-muted"
                  data-ocid="hud.market_notice"
                >
                  Select a completed Market to trade. Buying, selling, aid, and
                  investment proposals all require one.
                </p>
              )}

              {/* Buy */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="label-stencil text-[10px] text-hud-muted">
                    Buy with Money
                  </span>
                  <div className="flex gap-1">
                    {[50, 100, 250].map((amount) => (
                      <Button
                        key={amount}
                        type="button"
                        size="sm"
                        variant={buyAmount === amount ? "default" : "secondary"}
                        className="h-6 rounded-sm px-2 font-mono text-[10px]"
                        data-ocid={`hud.buy_amount.${amount}`}
                        onClick={() => setBuyAmount(amount)}
                      >
                        {amount}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {BUYABLE_RESOURCES.map((resource) => {
                    const cost = buyValue(resource, buyAmount);
                    const disabled = !marketOpen || money < cost;
                    return (
                      <Button
                        key={resource}
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-12 w-24 flex-col items-start gap-0.5 rounded-sm px-2 py-1"
                        data-ocid={`hud.buy.${resource}`}
                        disabled={disabled}
                        title={
                          !marketOpen
                            ? "Requires a completed Market"
                            : disabled
                              ? `Need ${cost} Money`
                              : `Buy ${buyAmount} ${RESOURCE_LABELS[resource]} for ${cost} Money`
                        }
                        onClick={() => buy(resource, buyAmount)}
                      >
                        <span
                          className={`text-[11px] font-semibold ${RESOURCE_TEXT_CLASS[resource]}`}
                        >
                          {RESOURCE_GLYPH[resource]} {RESOURCE_LABELS[resource]}
                        </span>
                        <span className="font-mono text-[10px] text-hud-muted">
                          {MARKET_BUY_RATE[resource]} M/unit
                        </span>
                        <span className="font-mono text-[10px] text-resource-money">
                          −{cost} M
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </div>

              {/* Sell */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="label-stencil text-[10px] text-hud-muted">
                    Sell for Money
                  </span>
                  <div className="flex gap-1">
                    {[50, 100, 250].map((amount) => (
                      <Button
                        key={amount}
                        type="button"
                        size="sm"
                        variant={
                          sellAmount === amount ? "default" : "secondary"
                        }
                        className="h-6 rounded-sm px-2 font-mono text-[10px]"
                        data-ocid={`hud.sell_amount.${amount}`}
                        onClick={() => setSellAmount(amount)}
                      >
                        {amount}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {SELLABLE_RESOURCES.map((resource) => {
                    const held = hud ? Math.floor(hud.resources[resource]) : 0;
                    const gain = sellValue(
                      resource,
                      Math.min(sellAmount, held),
                    );
                    const disabled = !marketOpen || held <= 0;
                    return (
                      <Button
                        key={resource}
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-12 w-24 flex-col items-start gap-0.5 rounded-sm px-2 py-1"
                        data-ocid={`hud.sell.${resource}`}
                        disabled={disabled}
                        title={
                          !marketOpen
                            ? "Requires a completed Market"
                            : disabled
                              ? `No ${RESOURCE_LABELS[resource]} to sell`
                              : `Sell ${Math.min(sellAmount, held)} ${RESOURCE_LABELS[resource]} for ${gain} Money`
                        }
                        onClick={() => sell(resource, sellAmount)}
                      >
                        <span
                          className={`text-[11px] font-semibold ${RESOURCE_TEXT_CLASS[resource]}`}
                        >
                          {RESOURCE_GLYPH[resource]} {RESOURCE_LABELS[resource]}
                        </span>
                        <span className="font-mono text-[10px] text-hud-muted">
                          {MARKET_SELL_RATE[resource]} M/unit
                        </span>
                        <span className="font-mono text-[10px] text-hud-muted">
                          {held} held · +{gain} M
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </div>

              {/* Send / Request aid */}
              <div className="flex flex-col gap-1">
                <span className="label-stencil text-[10px] text-hud-muted">
                  Financial Aid — {rivalAlly ? "Ally" : "Neutral"} (Team{" "}
                  {rivalTeam})
                </span>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-0.5">
                    <span className="label-stencil text-[9px] text-hud-muted">
                      Target
                    </span>
                    <select
                      value={targetPlayerId}
                      data-ocid="hud.aid_target_select"
                      onChange={(event) =>
                        setTargetId(Number(event.target.value))
                      }
                      className="h-6 rounded-sm border border-hud-border bg-black/40 px-1.5 font-mono text-[11px] text-hud-foreground outline-none focus-visible:border-hud-accent"
                    >
                      {opponents.map((opponent) => (
                        <option key={opponent.id} value={opponent.id}>
                          {opponent.allied ? "Ally" : "Rival"} {opponent.id} ·
                          Team {opponent.team}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="label-stencil text-[9px] text-hud-muted">
                      Resource
                    </span>
                    <select
                      value={aidResource}
                      data-ocid="hud.aid_resource_select"
                      onChange={(event) =>
                        setAidResource(event.target.value as ResourceKind)
                      }
                      className="h-6 rounded-sm border border-hud-border bg-black/40 px-1.5 font-mono text-[11px] text-hud-foreground outline-none focus-visible:border-hud-accent"
                    >
                      {RESOURCE_ORDER.map((resource) => (
                        <option key={resource} value={resource}>
                          {RESOURCE_LABELS[resource]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <NumberField
                    label="Amount"
                    value={aidAmount}
                    min={1}
                    max={100000}
                    step={50}
                    suffix="units"
                    ocid="hud.aid_amount_input"
                    onChange={setAidAmount}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-6 rounded-sm px-2 text-[10px]"
                    data-ocid="hud.send_aid_button"
                    disabled={!marketOpen || aidHeld < aidAmount}
                    title={
                      !marketOpen
                        ? "Requires a completed Market"
                        : aidHeld < aidAmount
                          ? `Only ${aidHeld} ${RESOURCE_LABELS[aidResource]} held`
                          : `Send ${aidAmount} ${RESOURCE_LABELS[aidResource]} to ${rivalAlly ? "ally" : "rival"} ${targetPlayerId}`
                    }
                    onClick={() => send(targetPlayerId, aidResource, aidAmount)}
                  >
                    Send Aid
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-6 rounded-sm px-2 text-[10px]"
                    data-ocid="hud.request_aid_button"
                    disabled={!marketOpen}
                    title={
                      marketOpen
                        ? `Request ${aidAmount} ${RESOURCE_LABELS[aidResource]} from ${rivalAlly ? "ally" : "rival"} ${targetPlayerId}`
                        : "Requires a completed Market"
                    }
                    onClick={() =>
                      request(targetPlayerId, aidResource, aidAmount)
                    }
                  >
                    Request
                  </Button>
                </div>
                <span className="font-mono text-[10px] text-hud-muted">
                  {aidHeld} {RESOURCE_LABELS[aidResource]} held · aid transfers
                  immediately, requests are recorded asks
                </span>
              </div>

              {/* Investment composer */}
              <div className="flex flex-col gap-1">
                <span className="label-stencil text-[10px] text-hud-muted">
                  Investment Proposal — to {rivalAlly ? "Ally" : "Neutral"}{" "}
                  (Team {rivalTeam})
                </span>
                <div className="flex flex-wrap items-end gap-2">
                  <NumberField
                    label="Principal"
                    value={principal}
                    min={INVESTMENT_MIN_PRINCIPAL}
                    max={INVESTMENT_MAX_PRINCIPAL}
                    step={100}
                    suffix="Money"
                    ocid="hud.invest_principal_input"
                    onChange={setPrincipal}
                  />
                  <NumberField
                    label="Return"
                    value={ratePercent}
                    min={Math.round(INVESTMENT_MIN_RATE * 100)}
                    max={Math.round(INVESTMENT_MAX_RATE * 100)}
                    step={1}
                    suffix="%"
                    ocid="hud.invest_rate_input"
                    onChange={setRatePercent}
                  />
                  <NumberField
                    label="Interval"
                    value={intervalMinutes}
                    min={Math.round(INVESTMENT_MIN_INTERVAL_SECONDS / 60)}
                    max={Math.round(INVESTMENT_MAX_INTERVAL_SECONDS / 60)}
                    step={1}
                    suffix="min"
                    ocid="hud.invest_interval_input"
                    onChange={setIntervalMinutes}
                  />
                  <NumberField
                    label="Payments"
                    value={payments}
                    min={1}
                    max={INVESTMENT_MAX_PAYMENTS}
                    step={1}
                    suffix="payouts"
                    ocid="hud.invest_payments_input"
                    onChange={setPayments}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    className="h-6 rounded-sm px-2 text-[10px]"
                    data-ocid="hud.propose_investment_button"
                    disabled={!canPropose}
                    title={
                      !marketOpen
                        ? "Requires a completed Market"
                        : !canPropose
                          ? `Need ${formatMoney(clampedPrincipal)} Money`
                          : `Propose ${formatMoney(clampedPrincipal)} Money at ${formatPercent(clampedRate)} every ${formatInterval(clampedInterval)}`
                    }
                    onClick={() =>
                      propose(
                        targetPlayerId,
                        clampedPrincipal,
                        clampedRate,
                        clampedInterval,
                        clampedPayments,
                      )
                    }
                  >
                    Propose
                  </Button>
                </div>
                <span className="font-mono text-[10px] text-hud-muted">
                  {formatMoney(clampedPrincipal)} Money ·{" "}
                  {formatPercent(clampedRate)} every{" "}
                  {formatInterval(clampedInterval)} · {clampedPayments} payouts
                  · {formatMoney(payoutPerInterval)} M each
                </span>
              </div>

              {/* Pending proposals */}
              <div className="flex flex-col gap-1">
                <span className="label-stencil text-[10px] text-hud-muted">
                  Pending Proposals
                </span>
                {pendingProposals.length === 0 ? (
                  <span
                    className="font-mono text-[10px] text-hud-muted"
                    data-ocid="hud.proposals_empty_state"
                  >
                    No proposals awaiting an answer.
                  </span>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {incomingProposals.map((proposal, index) => (
                      <li
                        key={proposal.id}
                        className="flex flex-wrap items-center gap-2 rounded-sm border border-hud-border bg-black/30 px-2 py-1"
                        data-ocid={`hud.proposal.incoming.${index + 1}`}
                      >
                        <span className="font-mono text-[10px] text-hud-accent">
                          Incoming
                        </span>
                        <span className="font-mono text-[10px] tabular-nums text-hud-foreground">
                          {formatMoney(proposal.principal)} M ·{" "}
                          {formatPercent(proposal.rate)} every{" "}
                          {formatInterval(proposal.intervalSeconds)} ·{" "}
                          {proposal.payments} payouts
                        </span>
                        <span className="ml-auto flex gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="default"
                            className="h-6 rounded-sm px-2 text-[10px]"
                            data-ocid={`hud.accept_proposal_button.${index + 1}`}
                            onClick={() => acceptProposal(proposal.id)}
                          >
                            Accept
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-6 rounded-sm px-2 text-[10px]"
                            data-ocid={`hud.decline_proposal_button.${index + 1}`}
                            onClick={() => declineProposal(proposal.id)}
                          >
                            Decline
                          </Button>
                        </span>
                      </li>
                    ))}
                    {outgoingProposals.map((proposal, index) => (
                      <li
                        key={proposal.id}
                        className="flex flex-wrap items-center gap-2 rounded-sm border border-hud-border bg-black/30 px-2 py-1"
                        data-ocid={`hud.proposal.outgoing.${index + 1}`}
                      >
                        <span className="font-mono text-[10px] text-hud-muted">
                          Outgoing
                        </span>
                        <span className="font-mono text-[10px] tabular-nums text-hud-foreground">
                          {formatMoney(proposal.principal)} M ·{" "}
                          {formatPercent(proposal.rate)} every{" "}
                          {formatInterval(proposal.intervalSeconds)} ·{" "}
                          {proposal.payments} payouts
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="ml-auto h-6 rounded-sm px-2 text-[10px]"
                          data-ocid={`hud.cancel_proposal_button.${index + 1}`}
                          onClick={() => declineProposal(proposal.id)}
                        >
                          Cancel
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Active contracts */}
              <div className="flex flex-col gap-1">
                <span className="label-stencil text-[10px] text-hud-muted">
                  Active Contracts
                </span>
                {activeContracts.length === 0 ? (
                  <span
                    className="font-mono text-[10px] text-hud-muted"
                    data-ocid="hud.contracts_empty_state"
                  >
                    No active investment contracts.
                  </span>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {activeContracts.map((contract, index) => {
                      const investor = contract.from === 0;
                      return (
                        <li
                          key={contract.id}
                          className="flex flex-wrap items-center gap-2 rounded-sm border border-hud-border bg-black/30 px-2 py-1"
                          data-ocid={`hud.contract.${index + 1}`}
                        >
                          <span
                            className={`font-mono text-[10px] ${investor ? "text-hud-accent" : "text-hud-muted"}`}
                          >
                            {investor ? "You invest" : "You receive"}
                          </span>
                          <span className="font-mono text-[10px] tabular-nums text-hud-foreground">
                            {formatMoney(contract.principal)} M ·{" "}
                            {formatPercent(contract.rate)} every{" "}
                            {formatInterval(contract.intervalSeconds)} ·{" "}
                            {contract.remainingPayments} left
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="ml-auto h-6 rounded-sm px-2 text-[10px]"
                            data-ocid={`hud.cancel_contract_button.${index + 1}`}
                            onClick={() => cancelContract(contract.id)}
                          >
                            Cancel
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* --- diplomacy tab ---------------------------------------------- */}
          {!inspecting && tab === "diplomacy" && (
            <div
              className="flex w-full flex-col gap-2"
              data-ocid="hud.diplomacy_panel"
            >
              <span className="label-stencil text-[10px] text-hud-muted">
                Known Powers
              </span>
              <ul className="flex flex-col gap-1">
                <li
                  className="flex flex-wrap items-center gap-2 rounded-sm border border-hud-border bg-black/30 px-2 py-1"
                  data-ocid="hud.diplomacy.player.1"
                >
                  <span className="font-display text-[11px] font-semibold text-hud-foreground">
                    Your Host
                  </span>
                  <span className="font-mono text-[10px] text-hud-muted">
                    Team {hud?.team ?? 1}
                  </span>
                  <span className="font-mono text-[10px] text-hud-accent">
                    You
                  </span>
                </li>
                {opponents.map((opponent, index) => {
                  const opponentVision = sharesVision(opponent.id);
                  const isTarget = opponent.id === targetPlayerId;
                  return (
                    <li
                      key={opponent.id}
                      className={`flex flex-wrap items-center gap-2 rounded-sm border px-2 py-1 ${
                        isTarget
                          ? "border-hud-accent bg-black/40"
                          : "border-hud-border bg-black/30"
                      }`}
                      data-ocid={`hud.diplomacy.player.${index + 2}`}
                    >
                      <span className="font-display text-[11px] font-semibold text-hud-foreground">
                        {opponent.allied ? "Ally" : "Rival"} Host {opponent.id}
                      </span>
                      <span className="font-mono text-[10px] text-hud-muted">
                        Team {opponent.team}
                      </span>
                      <span
                        className={`font-mono text-[10px] ${opponent.enemy ? "text-destructive" : "text-hud-accent"}`}
                        data-ocid={`hud.diplomacy.status.${index + 2}`}
                      >
                        {opponent.enemy ? "Enemy" : "Ally"}
                      </span>
                      <span
                        className={`font-mono text-[10px] ${opponentVision ? "text-hud-accent" : "text-hud-muted"}`}
                        data-ocid={`hud.diplomacy.vision.${index + 2}`}
                      >
                        {opponentVision
                          ? "Shared vision active"
                          : opponent.allied
                            ? "Vision not shared"
                            : "No vision treaty"}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant={isTarget ? "default" : "secondary"}
                        className="ml-auto h-6 rounded-sm px-2 text-[10px]"
                        data-ocid={`hud.diplomacy.target.${index + 2}`}
                        onClick={() => setTargetId(opponent.id)}
                      >
                        {isTarget ? "Targeted" : "Target"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
              <p
                className="px-1 text-xs text-hud-muted"
                data-ocid="hud.diplomacy_vision_notice"
              >
                {visionResearched
                  ? "Economic Partners is signed — you share line of sight with every ally."
                  : "Shared vision requires the 'Economic Partners' research at the Market (Age II)."}
              </p>
              <p className="px-1 text-xs text-hud-muted">
                {allied
                  ? `You and ${rivalAlly ? "ally" : "rival"} ${targetPlayerId} are on the same team: aid and investment flow freely.`
                  : `You and ${rivalAlly ? "ally" : "rival"} ${targetPlayerId} are on opposing teams. Aid and investment proposals may still be offered.`}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
