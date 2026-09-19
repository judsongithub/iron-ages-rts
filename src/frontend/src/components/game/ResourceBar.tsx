import {
  RESOURCE_GLYPH,
  RESOURCE_ORDER,
  RESOURCE_TEXT_CLASS,
  formatAmount,
  formatRate,
} from "@/components/game/hudTokens";
import {
  POWER_STATE_LABELS,
  type PowerState,
  RESOURCE_LABELS,
  type ResourcePool,
} from "@/types/game";

interface ResourceBarProps {
  resources: ResourcePool;
  gatherRates: ResourcePool;
  /** Resources the player cannot currently afford are dimmed. */
  energyDeficit?: boolean;
  /** Global grid state, shown on the energy readout. */
  powerState?: Exclude<PowerState, "unpowered">;
  /** Signed energy balance per second (production minus upkeep). */
  energyBalance?: number;
  /** Food per second added by the player's automated farms. */
  farmFoodRate?: number;
}

/**
 * Persistent top-bar readout of the six tracked resources with live
 * per-minute gather rates.
 *
 * Food additionally shows the automated farm yield, which accrues while a
 * completed Farm stands even with no Villager assigned to it.
 */
export function ResourceBar({
  resources,
  gatherRates,
  energyDeficit,
  powerState,
  energyBalance,
  farmFoodRate = 0,
}: ResourceBarProps) {
  return (
    <div
      className="flex items-stretch divide-x divide-hud-border"
      data-ocid="hud.resource_bar"
    >
      {RESOURCE_ORDER.map((kind) => {
        const rate = gatherRates[kind];
        const isEnergy = kind === "energy";
        const isFood = kind === "food";
        const balance = energyBalance ?? 0;
        const balanceLabel = `${balance >= 0 ? "+" : ""}${balance.toFixed(1)} E/sec`;
        const energyAlarm =
          powerState === "blackout" || powerState === "lowPower";
        const farmPerMinute = farmFoodRate * 60;
        return (
          <div
            key={kind}
            className="flex min-w-[74px] items-center gap-2 px-3 py-1.5"
            data-ocid={`hud.resource.${kind}`}
            title={
              isEnergy
                ? `${RESOURCE_LABELS[kind]} — ${formatAmount(resources[kind])} (${balanceLabel})`
                : isFood
                  ? `${RESOURCE_LABELS[kind]} — ${formatAmount(resources[kind])} (${formatRate(rate)}/min gathered, ${formatRate(farmPerMinute)}/min from farms)`
                  : `${RESOURCE_LABELS[kind]} — ${formatAmount(resources[kind])} (${formatRate(rate)}/min)`
            }
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[2px] border border-hud-border bg-black/40 font-mono text-[10px] font-bold ${RESOURCE_TEXT_CLASS[kind]}`}
              aria-hidden="true"
            >
              {RESOURCE_GLYPH[kind]}
            </span>
            <span className="flex min-w-0 flex-col leading-none">
              <span
                className={`font-mono text-sm font-semibold tabular-nums ${RESOURCE_TEXT_CLASS[kind]}`}
              >
                {formatAmount(resources[kind])}
              </span>
              {isEnergy ? (
                <span
                  className={`font-mono text-[10px] tabular-nums ${
                    energyAlarm ? "text-destructive" : "text-hud-muted"
                  }`}
                  data-ocid="hud.energy_power_state"
                >
                  {powerState ? POWER_STATE_LABELS[powerState] : "Standard"} ·{" "}
                  {balanceLabel}
                </span>
              ) : isFood ? (
                <span
                  className={`font-mono text-[10px] tabular-nums ${
                    energyDeficit ? "text-destructive" : "text-hud-muted"
                  }`}
                  data-ocid="hud.farm_food_rate"
                  title="Automated farm yield per minute"
                >
                  {formatRate(rate)}/m ·{" "}
                  <span className="text-valid">
                    +{farmPerMinute.toFixed(1)} farm
                  </span>
                </span>
              ) : (
                <span
                  className={`font-mono text-[10px] tabular-nums ${
                    energyDeficit ? "text-destructive" : "text-hud-muted"
                  }`}
                >
                  {formatRate(rate)}/m
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
