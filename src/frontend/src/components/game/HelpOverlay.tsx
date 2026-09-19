import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AGE_COSTS,
  AGE_TIMES,
  CARRY_CAPACITY,
  ENERGY_DEFICIT_PRODUCTION_MULTIPLIER,
  ENERGY_GENERATION_RATE,
  FARM_PRODUCTION_FOOD,
  FARM_PRODUCTION_SECONDS,
  FORTRESS_ENERGY_RATE,
  GATHER_RATES,
  HOSPITAL_ENERGY_DRAW,
  HOSPITAL_HEAL_RADIUS,
  HOSPITAL_HEAL_RATE,
  INVESTMENT_DEFAULT_INTERVAL_SECONDS,
  INVESTMENT_DEFAULT_PAYMENTS,
  INVESTMENT_DEFAULT_PRINCIPAL,
  INVESTMENT_DEFAULT_RATE,
  INVESTMENT_MAX_PAYMENTS,
  INVESTMENT_MAX_PRINCIPAL,
  INVESTMENT_MAX_RATE,
  INVESTMENT_MIN_PRINCIPAL,
  INVESTMENT_MIN_RATE,
  LOW_POWER_DAMAGE,
  LOW_POWER_RECHARGE,
  LOW_POWER_THRESHOLD,
  MARKET_BUY_RATE,
  MARKET_MONEY_RATE,
  MARKET_SELL_RATE,
  THERMAL_FUEL_SECONDS,
  THERMAL_FUEL_WOOD,
  UPGRADES,
} from "@/game/constants";
import { AGE_NAMES, POWER_STATE_LABELS } from "@/types/game";
import type { Age, ResourceKind } from "@/types/game";

interface HelpOverlayProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: ReadonlyArray<{ keys: string; action: string }> = [
  { keys: "Left-click", action: "Select a unit or building" },
  { keys: "Drag", action: "Box-select multiple units" },
  { keys: "Right-click", action: "Move, gather, attack, or repair" },
  {
    keys: "Shift + Right-click",
    action: "Queue an order behind the current one",
  },
  {
    keys: "Ctrl + 1–9",
    action: "Assign the current selection to a control group",
  },
  { keys: "1–9", action: "Recall a control group" },
  { keys: "Double-tap 1–9", action: "Centre the camera on a control group" },
  {
    keys: "A / D / S / N",
    action: "Aggressive / Defensive / Stand Ground / No Attack",
  },
  { keys: "H", action: "Hold position (stop)" },
  { keys: "Delete", action: "Cancel a pending construction" },
  { keys: "Arrow keys", action: "Pan the camera" },
  { keys: "Mouse wheel", action: "Zoom in and out" },
  { keys: "Escape", action: "Clear the selection" },
];

const RESOURCE_NAMES: Record<ResourceKind, string> = {
  food: "Food",
  wood: "Wood",
  gold: "Gold",
  stone: "Stone",
  money: "Money",
  energy: "Energy",
};

/** One resource node and the resource it yields, with its gather rate. */
const GATHER_SOURCES: ReadonlyArray<{
  source: string;
  resource: ResourceKind;
  rate: number;
}> = [
  { source: "Trees", resource: "wood", rate: GATHER_RATES.tree },
  { source: "Gold veins", resource: "gold", rate: GATHER_RATES.gold },
  { source: "Stone outcrops", resource: "stone", rate: GATHER_RATES.stone },
  { source: "Forage bushes", resource: "food", rate: GATHER_RATES.forage },
  { source: "Wild animals", resource: "food", rate: GATHER_RATES.animal },
  { source: "Farm plots", resource: "food", rate: GATHER_RATES.farm },
];

/** Passive Energy generators, in ascending age order. */
const ENERGY_GENERATORS: ReadonlyArray<{ name: string; rate: number }> = [
  { name: "Windmill", rate: ENERGY_GENERATION_RATE.windmill },
  { name: "Watermill", rate: ENERGY_GENERATION_RATE.watermill },
  { name: "Thermal Power Station", rate: ENERGY_GENERATION_RATE.thermalPlant },
  { name: "Solar Array", rate: ENERGY_GENERATION_RATE.solarArray },
  { name: "Nuclear Reactor", rate: ENERGY_GENERATION_RATE.nuclearReactor },
];

const AGE_ORDER: ReadonlyArray<Exclude<Age, 1>> = [2, 3, 4];

/** Formats a partial resource cost as "500 Food, 200 Gold". */
function formatCost(cost: Partial<Record<ResourceKind, number>>): string {
  return (Object.keys(cost) as ResourceKind[])
    .filter((kind) => (cost[kind] ?? 0) > 0)
    .map((kind) => `${cost[kind]} ${RESOURCE_NAMES[kind]}`)
    .join(", ");
}

/** A titled block of instructional prose inside a guide tab. */
function GuideSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5 border-t border-border pt-4 first:mt-0 first:border-t-0 first:pt-0">
      <h3 className="label-stencil text-[11px] text-primary">{title}</h3>
      <div className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

/** A label/value row used for rates, costs, and thresholds. */
function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-baseline justify-between gap-4">
      <span className="text-foreground">{label}</span>
      <span className="text-right font-mono text-[11px]">{value}</span>
    </li>
  );
}

const TAB_TRIGGER_CLASS =
  "label-stencil rounded-sm px-2 py-1 text-[10px] tracking-[0.12em] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground";

/** Keyboard and mouse reference plus the gameplay guide, toggled from the HUD. */
export function HelpOverlay({ open, onClose }: HelpOverlayProps) {
  if (!open) return null;
  return (
    <dialog
      open
      className="absolute inset-0 z-40 m-0 flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-black/70 p-4 text-foreground"
      data-ocid="help.modal"
      aria-modal="true"
      aria-label="Field manual"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div
        className="panel-parchment texture-grain flex max-h-[85vh] w-full max-w-2xl flex-col rounded-sm p-5"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">
              Field Manual
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Everything a commander needs — from the first harvest to the last
              siege.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="rounded-sm"
            data-ocid="help.close_button"
            onClick={onClose}
          >
            Close
          </Button>
        </div>

        <Tabs defaultValue="resources" className="mt-4 min-h-0 flex-1 gap-3">
          <TabsList
            className="h-auto w-full flex-wrap justify-start gap-1 rounded-sm bg-muted/60 p-1"
            data-ocid="help.tabs"
          >
            <TabsTrigger
              value="resources"
              className={TAB_TRIGGER_CLASS}
              data-ocid="help.tab.resources"
            >
              Resources
            </TabsTrigger>
            <TabsTrigger
              value="ages"
              className={TAB_TRIGGER_CLASS}
              data-ocid="help.tab.ages"
            >
              Ages
            </TabsTrigger>
            <TabsTrigger
              value="market"
              className={TAB_TRIGGER_CLASS}
              data-ocid="help.tab.market"
            >
              Market &amp; Diplomacy
            </TabsTrigger>
            <TabsTrigger
              value="energy"
              className={TAB_TRIGGER_CLASS}
              data-ocid="help.tab.energy"
            >
              Energy Grid
            </TabsTrigger>
            <TabsTrigger
              value="victory"
              className={TAB_TRIGGER_CLASS}
              data-ocid="help.tab.victory"
            >
              Victory
            </TabsTrigger>
            <TabsTrigger
              value="controls"
              className={TAB_TRIGGER_CLASS}
              data-ocid="help.tab.controls"
            >
              Controls
            </TabsTrigger>
          </TabsList>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <TabsContent value="resources" data-ocid="help.panel.resources">
              <GuideSection title="Villager Gathering">
                <p>
                  Villagers are your only gatherers. Select one, right-click a
                  resource node, and it will harvest until it carries{" "}
                  {CARRY_CAPACITY} units, then haul the load to the nearest
                  drop-off — a Town Center or a Mill — and return for more.
                </p>
                <ul className="space-y-1">
                  {GATHER_SOURCES.map((entry) => (
                    <StatRow
                      key={entry.source}
                      label={entry.source}
                      value={`${RESOURCE_NAMES[entry.resource]} · ${entry.rate}/s`}
                    />
                  ))}
                </ul>
                <p>
                  Depleted farm plots resow themselves after 30 seconds, so food
                  never runs out permanently.
                </p>
              </GuideSection>

              <GuideSection title="Automated Farms">
                <p>
                  A completed Farm feeds your stockpile on its own — no Villager
                  needs to be assigned. Every {FARM_PRODUCTION_SECONDS} seconds
                  it delivers {FARM_PRODUCTION_FOOD} Food directly to your
                  stores, a steady{" "}
                  {FARM_PRODUCTION_FOOD / FARM_PRODUCTION_SECONDS}
                  /s per Farm. Build several to bankroll a growing army while
                  your Villagers work wood, gold, and stone.
                </p>
              </GuideSection>

              <GuideSection title="Money from the Market">
                <p>
                  Money is not gathered from nodes. A completed Market mints{" "}
                  {MARKET_MONEY_RATE} Money/s on its own, and it is the only
                  building that can trade resources. Selling pays{" "}
                  {MARKET_SELL_RATE.food} Money per Food,{" "}
                  {MARKET_SELL_RATE.wood} per Wood, {MARKET_SELL_RATE.gold} per
                  Gold, and {MARKET_SELL_RATE.stone} per Stone. Buying costs
                  more — {MARKET_BUY_RATE.food} per Food, {MARKET_BUY_RATE.wood}{" "}
                  per Wood, {MARKET_BUY_RATE.gold} per Gold, and{" "}
                  {MARKET_BUY_RATE.stone} per Stone — so the spread keeps the
                  exchange honest.
                </p>
              </GuideSection>

              <GuideSection title="Energy from Power Plants">
                <p>
                  Energy is generated passively by completed power buildings.
                  Each kind yields a fixed rate per second:
                </p>
                <ul className="space-y-1">
                  {ENERGY_GENERATORS.map((entry) => (
                    <StatRow
                      key={entry.name}
                      label={entry.name}
                      value={`${entry.rate}/s`}
                    />
                  ))}
                </ul>
                <p>
                  A completed Fortress also contributes {FORTRESS_ENERGY_RATE}
                  /s. The Thermal Power Station burns {THERMAL_FUEL_WOOD} Wood
                  every {THERMAL_FUEL_SECONDS} seconds to keep running, so keep
                  a woodcutting crew busy. Energy is upkeep: heavy units and
                  siege engines draw from the grid, and a negative balance
                  throttles your economy.
                </p>
              </GuideSection>
            </TabsContent>

            <TabsContent value="ages" data-ocid="help.panel.ages">
              <GuideSection title="Advancing an Age">
                <p>
                  You begin in the {AGE_NAMES[1]}. To advance, you must have a
                  completed Town Center — it is the only structure that can
                  advance the age — and enough resources banked. Select the Town
                  Center and press the Age Advancement button to begin.
                </p>
                <p>
                  Advancing is a one-time payment; the cost is spent when you
                  begin and the new age arrives after the build time below.
                </p>
              </GuideSection>

              <GuideSection title="Prerequisites and Costs">
                <ul className="space-y-1">
                  {AGE_ORDER.map((age) => (
                    <StatRow
                      key={age}
                      label={AGE_NAMES[age]}
                      value={`${formatCost(AGE_COSTS[age])} · ${AGE_TIMES[age]}s`}
                    />
                  ))}
                </ul>
                <p>
                  Every advance requires a standing Town Center. The cost is
                  paid in full when the advance begins, and the timer runs
                  regardless of what else you build.
                </p>
              </GuideSection>

              <GuideSection title="What Each Age Unlocks">
                <p>
                  The {AGE_NAMES[2]} opens Barracks, Archery Ranges, Markets,
                  Blacksmiths, Towers, Walls, and the Energy Distribution
                  Center. The {AGE_NAMES[3]} adds Stables, Fortresses, Thermal
                  Power Stations, and Hospitals. The {AGE_NAMES[4]} brings Solar
                  Arrays, Nuclear Reactors, and your faction's elite unit.
                </p>
              </GuideSection>
            </TabsContent>

            <TabsContent value="market" data-ocid="help.panel.market">
              <GuideSection title="Teams, Allies, and Enemies">
                <p>
                  Every player is assigned a team from 1 to 6 in the lobby.
                  Players on your team are Allies — you share base access and
                  never trade blows. Players on any other team are Enemies, and
                  only one side can hold the field.
                </p>
              </GuideSection>

              <GuideSection title="Investment Contracts">
                <p>
                  At the Market you can offer an investment contract to another
                  player. You commit a principal up front; the recipient repays
                  it in instalments at a fixed rate over a set interval. A
                  default proposal is {INVESTMENT_DEFAULT_PRINCIPAL} Money at{" "}
                  {Math.round(INVESTMENT_DEFAULT_RATE * 100)}% per payment,
                  every {INVESTMENT_DEFAULT_INTERVAL_SECONDS} seconds, for{" "}
                  {INVESTMENT_DEFAULT_PAYMENTS} payments.
                </p>
                <ul className="space-y-1">
                  <StatRow
                    label="Principal"
                    value={`${INVESTMENT_MIN_PRINCIPAL}–${INVESTMENT_MAX_PRINCIPAL} Money`}
                  />
                  <StatRow
                    label="Return rate"
                    value={`${Math.round(INVESTMENT_MIN_RATE * 100)}–${Math.round(
                      INVESTMENT_MAX_RATE * 100,
                    )}% per payment`}
                  />
                  <StatRow label="Payout interval" value="30–600 seconds" />
                  <StatRow
                    label="Payments"
                    value={`up to ${INVESTMENT_MAX_PAYMENTS}`}
                  />
                </ul>
                <p>
                  The recipient must accept before the contract starts. Once
                  signed, payouts arrive automatically on each interval until
                  the agreed number of payments is met.
                </p>
              </GuideSection>

              <GuideSection title="Financial Aid">
                <p>
                  You can also send a one-off gift of resources to another
                  player as financial aid. Aid is immediate and unconditional —
                  use it to prop up an ally's war effort or to honour a
                  diplomatic bargain.
                </p>
              </GuideSection>

              <GuideSection title="Shared Team Vision">
                <p>
                  Allies do not share line of sight by default. Research{" "}
                  <span className="text-foreground">
                    {UPGRADES.economicPartners.name}
                  </span>{" "}
                  at the Market ({formatCost(UPGRADES.economicPartners.cost)},
                  available from the{" "}
                  {AGE_NAMES[UPGRADES.economicPartners.minAge]}) to sign a trade
                  charter: both sides then share vision for the rest of the
                  match.
                </p>
              </GuideSection>
            </TabsContent>

            <TabsContent value="energy" data-ocid="help.panel.energy">
              <GuideSection title="Distribution Coverage">
                <p>
                  Energy-consuming structures must sit inside the coverage
                  radius of an Energy Distribution Center to draw power. The
                  Center projects a radius of 14 world units; anything outside
                  every owned radius is{" "}
                  <span className="text-foreground">
                    {POWER_STATE_LABELS.unpowered}
                  </span>{" "}
                  and cannot fire or function. Place generators and consumers
                  within the ring, and build additional Centers to extend your
                  grid.
                </p>
              </GuideSection>

              <GuideSection title="Weapon Power Throttling">
                <p>
                  Energy weapons throttle with the grid. Physical weapons —
                  melee, ranged, cavalry, siege, and faction elites — are
                  unaffected by power state even when they draw upkeep.
                </p>
                <ul className="space-y-1">
                  <StatRow
                    label={POWER_STATE_LABELS.standard}
                    value="Full damage and rate of fire"
                  />
                  <StatRow
                    label={POWER_STATE_LABELS.lowPower}
                    value={`${Math.round(LOW_POWER_DAMAGE * 100)}% damage · ${Math.round(
                      LOW_POWER_RECHARGE * 100,
                    )}% recharge time`}
                  />
                  <StatRow
                    label={POWER_STATE_LABELS.blackout}
                    value="Weapons offline"
                  />
                </ul>
                <p>
                  The grid drops to {POWER_STATE_LABELS.lowPower} when your
                  stockpile falls below {LOW_POWER_THRESHOLD} Energy, or when
                  upkeep outpaces production. At zero the grid hits{" "}
                  {POWER_STATE_LABELS.blackout} and energy weapons fall silent
                  until the stockpile recovers.
                </p>
              </GuideSection>

              <GuideSection title="Hospital Draw">
                <p>
                  A Hospital heals friendly units within {HOSPITAL_HEAL_RADIUS}{" "}
                  world units at {HOSPITAL_HEAL_RATE} health per second, but it
                  draws {HOSPITAL_ENERGY_DRAW} Energy/s while doing so. Keep it
                  inside a distribution radius, or it will sit dark and your
                  wounded will not recover.
                </p>
              </GuideSection>

              <GuideSection title="Negative-Energy Penalty">
                <p>
                  When your Energy balance runs negative, production buildings —
                  Barracks, Archery Ranges, Stables, Markets, and Fortresses —
                  run at{" "}
                  {Math.round(ENERGY_DEFICIT_PRODUCTION_MULTIPLIER * 100)}%
                  speed. Fielding a large army on a thin grid starves your own
                  reinforcements, so build generation ahead of demand.
                </p>
              </GuideSection>
            </TabsContent>

            <TabsContent value="victory" data-ocid="help.panel.victory">
              <GuideSection title="Victory">
                <p>
                  Victory is decided by production. Destroy every enemy
                  production building — Town Centers, Barracks, Archery Ranges,
                  Stables, and Fortresses — and the enemy host is broken. You do
                  not need to hunt down every last soldier; cut off their
                  ability to field an army and the match is yours.
                </p>
                <p className="text-foreground">
                  Production structures: Town Center, Barracks, Archery Range,
                  Stable, and Fortress.
                </p>
              </GuideSection>

              <GuideSection title="Defeat">
                <p>
                  Defeat works the same way in reverse: if you lose all of your
                  own production buildings, your base has fallen and the match
                  ends. Defend your Town Center above all else — it is both your
                  villager production and your only path to a new age.
                </p>
              </GuideSection>

              <GuideSection title="Military Assets">
                <p>
                  Military assets — Barracks, Archery Ranges, Stables, and
                  Fortresses — are what let an opponent rebuild an army. Raze
                  them alongside the Town Centers and no amount of banked
                  resources will save the enemy.
                </p>
              </GuideSection>
            </TabsContent>

            <TabsContent value="controls" data-ocid="help.panel.controls">
              <h3 className="label-stencil text-[11px] text-primary">
                Controls
              </h3>
              <dl className="mt-2 divide-y divide-border">
                {SHORTCUTS.map((shortcut) => (
                  <div
                    key={shortcut.keys}
                    className="flex items-center justify-between gap-4 py-1.5"
                  >
                    <dt className="font-mono text-xs font-semibold text-foreground">
                      {shortcut.keys}
                    </dt>
                    <dd className="text-right text-xs text-muted-foreground">
                      {shortcut.action}
                    </dd>
                  </div>
                ))}
              </dl>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </dialog>
  );
}
