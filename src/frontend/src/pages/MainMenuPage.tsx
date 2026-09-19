import { AiDifficulty, Faction, MapSize } from "@/backend";
import { HelpOverlay } from "@/components/game/HelpOverlay";
import { formatClock } from "@/components/game/hudTokens";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MAP_DIMENSIONS } from "@/game/constants";
import { FACTION_LIST, getFaction } from "@/game/factions";
import {
  useMatchStats,
  usePlayerSettings,
  useRecentMatches,
  useSaveSettings,
} from "@/hooks/useQueries";
import { useMatchSetupStore } from "@/store/matchSetupStore";
import {
  PLAYER_COLORS,
  POPULATION_LIMITS,
  TEAM_IDS,
  type TeamId,
} from "@/types/game";
import { useEffect, useMemo, useRef, useState } from "react";

interface MainMenuPageProps {
  onStartMatch: () => void;
}

/** The ten lobby slots, in fixed order. Player 1 is always the human. */
const SLOT_COUNT = 10;

/** Ten distinct saturated commander colors, assigned to slots in order. */
const SLOT_COLORS = PLAYER_COLORS;

type SlotKind = "open" | "ai" | "closed";

interface LobbySlot {
  kind: SlotKind;
  difficulty: AiDifficulty;
  team: TeamId;
}

const MAP_SIZES: ReadonlyArray<{ id: MapSize; label: string; detail: string }> =
  [
    {
      id: MapSize.small,
      label: "Small",
      detail: `${MAP_DIMENSIONS.small.width} × ${MAP_DIMENSIONS.small.height} · quick skirmish`,
    },
    {
      id: MapSize.medium,
      label: "Medium",
      detail: `${MAP_DIMENSIONS.medium.width} × ${MAP_DIMENSIONS.medium.height} · room to expand`,
    },
    {
      id: MapSize.large,
      label: "Large",
      detail: `${MAP_DIMENSIONS.large.width} × ${MAP_DIMENSIONS.large.height} · full campaign`,
    },
  ];

const DIFFICULTIES: ReadonlyArray<{
  id: AiDifficulty;
  label: string;
  detail: string;
}> = [
  {
    id: AiDifficulty.easy,
    label: "Easy",
    detail: "Slow gathers, small armies",
  },
  { id: AiDifficulty.normal, label: "Normal", detail: "Balanced pressure" },
  { id: AiDifficulty.hard, label: "Hard", detail: "Fast economy, heavy waves" },
];

const SLOT_KIND_LABELS: Record<SlotKind, string> = {
  open: "Open",
  ai: "AI",
  closed: "Closed",
};

const RESOURCE_NAMES = [
  "Food",
  "Wood",
  "Gold",
  "Stone",
  "Money",
  "Energy",
] as const;

/** Builds the default lobby: human at slot 1, one AI opponent, rest open. */
function createDefaultSlots(): LobbySlot[] {
  return Array.from({ length: SLOT_COUNT }, (_, index) => ({
    kind: index === 0 ? "open" : index === 1 ? "ai" : "open",
    difficulty: AiDifficulty.normal,
    team: (index === 0 ? 1 : 2) as TeamId,
  }));
}

/** Start screen: faction, map size, and the ten-slot commander lobby. */
export function MainMenuPage({ onStartMatch }: MainMenuPageProps) {
  const setup = useMatchSetupStore();
  const { data: settings } = usePlayerSettings();
  const { data: recent } = useRecentMatches(5);
  const { data: stats } = useMatchStats();
  const saveSettings = useSaveSettings();
  const [hydrated, setHydrated] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [slots, setSlots] = useState<LobbySlot[]>(createDefaultSlots);

  // Apply saved preferences once, without clobbering later user choices.
  useEffect(() => {
    if (hydrated || !settings) return;
    setup.setFaction(settings.preferredFaction);
    setup.setMapSize(settings.lastMapSize);
    setup.setDifficulty(settings.preferredDifficulty);
    // Mirror the hydrated difficulty onto the primary AI slot so its local
    // toggle agrees with the effective difficulty the engine will use.
    setSlots((current) => {
      const primaryIndex = current.findIndex((slot) => slot.kind === "ai");
      if (primaryIndex === -1) return current;
      if (current[primaryIndex].difficulty === settings.preferredDifficulty) {
        return current;
      }
      return current.map((slot, index) =>
        index === primaryIndex
          ? { ...slot, difficulty: settings.preferredDifficulty }
          : slot,
      );
    });
    setHydrated(true);
  }, [hydrated, settings, setup]);

  const updateSlot = (index: number, patch: Partial<LobbySlot>): void => {
    setSlots((current) =>
      current.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)),
    );
  };

  // Every AI slot drives the match config, so multiple AI opponents actually
  // spawn. The first AI slot also feeds the legacy single-opponent fields.
  const aiSlotIndices = useMemo(
    () =>
      slots
        .map((slot, index) => (slot.kind === "ai" ? index : -1))
        .filter((index) => index !== -1),
    [slots],
  );
  const primaryAiIndex = aiSlotIndices[0] ?? -1;
  const hasOpponent = primaryAiIndex !== -1;

  // Stable identity for the derived AI slot list so the sync effect below does
  // not re-run on every render.
  const aiSlotConfigs = useMemo(
    () =>
      aiSlotIndices.map((index) => ({
        team: slots[index].team,
        populationLimit: setup.aiPopulationLimit,
        color: SLOT_COLORS[index].value,
        difficulty: slots[index].difficulty,
      })),
    [aiSlotIndices, slots, setup.aiPopulationLimit],
  );

  const primaryAiSlot = primaryAiIndex === -1 ? null : slots[primaryAiIndex];

  // Remembers the primary AI slot values the sync last pushed, so saved
  // settings hydration is not clobbered and the effect stays idempotent.
  const lastSyncedPrimary = useRef<string | null>(null);

  // Sync the lobby into the match setup store. Each setter is guarded by a
  // value comparison so the effect is idempotent: it only writes when the
  // derived value actually differs from what the store already holds.
  useEffect(() => {
    const playerColor = SLOT_COLORS[0].value;
    if (setup.playerColor !== playerColor) {
      setup.setPlayerColor(playerColor);
    }

    const currentSlots = setup.aiSlots;
    const slotsChanged =
      currentSlots.length !== aiSlotConfigs.length ||
      aiSlotConfigs.some((slot, index) => {
        const current = currentSlots[index];
        return (
          !current ||
          current.team !== slot.team ||
          current.populationLimit !== slot.populationLimit ||
          current.color !== slot.color ||
          current.difficulty !== slot.difficulty
        );
      });
    if (slotsChanged) {
      setup.setAiSlots(aiSlotConfigs);
    }

    if (!primaryAiSlot) {
      lastSyncedPrimary.current = null;
      return;
    }
    // Only push the legacy single-opponent fields when the primary AI slot's
    // own configuration changes, so hydrating saved settings is preserved.
    const primarySignature = `${primaryAiSlot.team}:${primaryAiSlot.difficulty}`;
    if (lastSyncedPrimary.current === primarySignature) return;
    lastSyncedPrimary.current = primarySignature;
    if (setup.difficulty !== primaryAiSlot.difficulty) {
      setup.setDifficulty(primaryAiSlot.difficulty);
    }
    if (setup.aiTeam !== primaryAiSlot.team) {
      setup.setAiTeam(primaryAiSlot.team);
    }
  }, [
    aiSlotConfigs,
    primaryAiSlot,
    setup.playerColor,
    setup.aiSlots,
    setup.difficulty,
    setup.aiTeam,
    setup.setPlayerColor,
    setup.setAiSlots,
    setup.setDifficulty,
    setup.setAiTeam,
  ]);

  const handleStart = (): void => {
    saveSettings.mutate({
      preferredFaction: setup.faction,
      preferredDifficulty: setup.difficulty,
      lastMapSize: setup.mapSize,
    });
    onStartMatch();
  };

  const selectedFaction = getFaction(setup.faction);
  const totalMatches = stats ? Number(stats.totalMatches) : 0;
  const wins = stats ? Number(stats.wins) : 0;
  const losses = stats ? Number(stats.losses) : 0;
  const winRate =
    totalMatches > 0 ? Math.round((wins / totalMatches) * 100) : 0;
  const activeCount = slots.filter((slot) => slot.kind !== "closed").length;

  return (
    <div
      className="min-h-screen bg-background texture-grain"
      data-ocid="menu.page"
    >
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-8 sm:px-6 sm:py-10">
        <header className="border-b border-border pb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="label-stencil text-[11px] text-muted-foreground">
                Field Ledger · Campaign Command
              </p>
              <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
                Grand-Scale Historical RTS
              </h1>
              <p className="mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">
                Raise a settlement from the Age of Settlement to the Age of
                Empire. Six resources, four ages, and three factions — command a
                host across a procedurally generated frontier.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="rounded-sm"
              data-ocid="menu.help_button"
              onClick={() => setHelpOpen(true)}
            >
              Help &amp; Controls
            </Button>
          </div>
        </header>

        <main className="mt-8 grid flex-1 gap-8 lg:grid-cols-[1.6fr_1fr]">
          <section data-ocid="menu.section.factions">
            <h2 className="font-display text-2xl font-semibold text-foreground">
              Choose your faction
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {FACTION_LIST.map((faction) => {
                const selected = setup.faction === faction.id;
                return (
                  <button
                    key={faction.id}
                    type="button"
                    data-ocid={`menu.faction.${faction.id}`}
                    aria-pressed={selected}
                    onClick={() => setup.setFaction(faction.id)}
                    className={`panel-parchment texture-grain rounded-sm p-4 text-left transition-smooth ${
                      selected
                        ? "ring-2 ring-primary"
                        : "hover:border-primary/60"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`h-4 w-4 rounded-[2px] border border-black/40 ${faction.bannerClass}`}
                        aria-hidden="true"
                      />
                      <span className="font-display text-base font-semibold text-foreground">
                        {faction.name}
                      </span>
                    </span>
                    <span className="mt-2 block text-xs text-muted-foreground">
                      {faction.blurb}
                    </span>
                    <span className="mt-3 block border-t border-border pt-2">
                      <span className="label-stencil text-[10px] text-primary">
                        {faction.bonusLabel}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {faction.bonusDescription}
                      </span>
                    </span>
                    <span className="mt-2 block text-[11px] text-muted-foreground">
                      Elite:{" "}
                      <span className="text-foreground">
                        {faction.eliteName}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              <div data-ocid="menu.section.map_size">
                <h3 className="label-stencil text-[11px] text-muted-foreground">
                  Map size
                </h3>
                <div className="mt-2 flex flex-col gap-2">
                  {MAP_SIZES.map((size) => (
                    <button
                      key={size.id}
                      type="button"
                      data-ocid={`menu.map_size.${size.id}`}
                      aria-pressed={setup.mapSize === size.id}
                      onClick={() => setup.setMapSize(size.id)}
                      className={`rounded-sm border px-3 py-2 text-left transition-smooth ${
                        setup.mapSize === size.id
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card hover:border-primary/50"
                      }`}
                    >
                      <span className="block text-sm font-semibold text-foreground">
                        {size.label}
                      </span>
                      <span className="block font-mono text-[10px] text-muted-foreground">
                        {size.detail}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div data-ocid="menu.section.difficulty">
                <h3 className="label-stencil text-[11px] text-muted-foreground">
                  AI difficulty
                </h3>
                <div className="mt-2 flex flex-col gap-2">
                  {DIFFICULTIES.map((difficulty) => (
                    <button
                      key={difficulty.id}
                      type="button"
                      data-ocid={`menu.difficulty.${difficulty.id}`}
                      aria-pressed={setup.difficulty === difficulty.id}
                      onClick={() => setup.setDifficulty(difficulty.id)}
                      className={`rounded-sm border px-3 py-2 text-left transition-smooth ${
                        setup.difficulty === difficulty.id
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card hover:border-primary/50"
                      }`}
                    >
                      <span className="block text-sm font-semibold text-foreground">
                        {difficulty.label}
                      </span>
                      <span className="block font-mono text-[10px] text-muted-foreground">
                        {difficulty.detail}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-8" data-ocid="menu.section.lobby">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="label-stencil text-[11px] text-muted-foreground">
                  Commander lobby
                </h3>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {activeCount} of {SLOT_COUNT} slots active
                </span>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {slots.map((slot, index) => {
                  const color = SLOT_COLORS[index];
                  const isHuman = index === 0;
                  const isClosed = slot.kind === "closed";
                  const slotNumber = index + 1;
                  return (
                    <div
                      key={`slot-${slotNumber}`}
                      data-ocid={`menu.slot.${slotNumber}`}
                      className={`rounded-sm border p-3 transition-smooth ${
                        isClosed
                          ? "border-border/60 bg-muted/40 opacity-60"
                          : "border-border bg-card"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-4 w-4 shrink-0 rounded-[2px] border border-black/50"
                          style={{ backgroundColor: color.value }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                          Player {slotNumber}
                        </span>
                        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                          {color.name}
                        </span>
                      </div>

                      {isHuman ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span
                            className="inline-flex h-8 w-[104px] items-center justify-center rounded-sm border border-border bg-muted/50 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                            data-ocid={`menu.slot.${slotNumber}.kind`}
                            aria-label={`Player ${slotNumber} slot type`}
                          >
                            Human
                          </span>
                        </div>
                      ) : (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Select
                            value={slot.kind}
                            onValueChange={(value) =>
                              updateSlot(index, { kind: value as SlotKind })
                            }
                          >
                            <SelectTrigger
                              size="sm"
                              className="w-[104px] rounded-sm"
                              data-ocid={`menu.slot.${slotNumber}.kind`}
                              aria-label={`Player ${slotNumber} slot type`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(["open", "ai", "closed"] as const).map(
                                (kind) => (
                                  <SelectItem key={kind} value={kind}>
                                    {SLOT_KIND_LABELS[kind]}
                                  </SelectItem>
                                ),
                              )}
                            </SelectContent>
                          </Select>

                          {slot.kind === "ai" ? (
                            <div
                              className="flex overflow-hidden rounded-sm border border-border"
                              data-ocid={`menu.slot.${slotNumber}.difficulty`}
                            >
                              {DIFFICULTIES.map((difficulty) => (
                                <button
                                  key={difficulty.id}
                                  type="button"
                                  aria-pressed={
                                    slot.difficulty === difficulty.id
                                  }
                                  onClick={() =>
                                    updateSlot(index, {
                                      difficulty: difficulty.id,
                                    })
                                  }
                                  className={`px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-smooth ${
                                    slot.difficulty === difficulty.id
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-card text-muted-foreground hover:text-foreground"
                                  }`}
                                >
                                  {difficulty.label}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      )}

                      {!isClosed ? (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="label-stencil text-[9px] text-muted-foreground">
                            Team
                          </span>
                          <Select
                            value={String(slot.team)}
                            onValueChange={(value) =>
                              updateSlot(index, {
                                team: Number(value) as TeamId,
                              })
                            }
                          >
                            <SelectTrigger
                              size="sm"
                              className="w-[88px] rounded-sm"
                              data-ocid={`menu.slot.${slotNumber}.team`}
                              aria-label={`Player ${slotNumber} team`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TEAM_IDS.map((team) => (
                                <SelectItem key={team} value={String(team)}>
                                  Team {team}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div data-ocid="menu.section.population">
                  <h3 className="label-stencil text-[11px] text-muted-foreground">
                    Population limit
                  </h3>
                  <div className="mt-2 flex flex-col gap-2">
                    <label
                      className="flex items-center justify-between gap-3 rounded-sm border border-border bg-card px-3 py-2"
                      htmlFor="menu.population.player"
                    >
                      <span className="text-xs text-foreground">Your host</span>
                      <Select
                        value={String(setup.populationLimit)}
                        onValueChange={(value) =>
                          setup.setPopulationLimit(Number(value))
                        }
                      >
                        <SelectTrigger
                          id="menu.population.player"
                          size="sm"
                          className="w-[92px] rounded-sm"
                          data-ocid="menu.population.player"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {POPULATION_LIMITS.map((limit) => (
                            <SelectItem key={limit} value={String(limit)}>
                              {limit}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                    <label
                      className="flex items-center justify-between gap-3 rounded-sm border border-border bg-card px-3 py-2"
                      htmlFor="menu.population.ai"
                    >
                      <span className="text-xs text-foreground">
                        AI commanders
                      </span>
                      <Select
                        value={String(setup.aiPopulationLimit)}
                        onValueChange={(value) =>
                          setup.setAiPopulationLimit(Number(value))
                        }
                      >
                        <SelectTrigger
                          id="menu.population.ai"
                          size="sm"
                          className="w-[92px] rounded-sm"
                          data-ocid="menu.population.ai"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {POPULATION_LIMITS.map((limit) => (
                            <SelectItem key={limit} value={String(limit)}>
                              {limit}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  </div>
                </div>

                <div data-ocid="menu.section.teams">
                  <h3 className="label-stencil text-[11px] text-muted-foreground">
                    Diplomacy
                  </h3>
                  <div className="mt-2 flex flex-col gap-2">
                    <label
                      className="flex items-center justify-between gap-3 rounded-sm border border-border bg-card px-3 py-2"
                      htmlFor="menu.team.player"
                    >
                      <span className="text-xs text-foreground">Your team</span>
                      <Select
                        value={String(setup.playerTeam)}
                        onValueChange={(value) =>
                          setup.setPlayerTeam(Number(value) as TeamId)
                        }
                      >
                        <SelectTrigger
                          id="menu.team.player"
                          size="sm"
                          className="w-[92px] rounded-sm"
                          data-ocid="menu.team.player"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TEAM_IDS.map((team) => (
                            <SelectItem key={team} value={String(team)}>
                              Team {team}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                    <p className="text-[11px] text-muted-foreground">
                      Same-team commanders are allies and share base access;
                      different teams are enemies.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                type="button"
                size="lg"
                disabled={!hasOpponent}
                className="w-full rounded-sm font-display text-base tracking-wide sm:w-auto sm:px-10"
                data-ocid="menu.start_button"
                onClick={handleStart}
              >
                Begin New Skirmish
              </Button>
              <p
                className="text-xs text-muted-foreground"
                data-ocid="menu.start_hint"
              >
                {hasOpponent ? (
                  <>
                    Marching as{" "}
                    <span className="font-semibold text-foreground">
                      {selectedFaction.name}
                    </span>{" "}
                    on a {setup.mapSize} map against a {setup.difficulty} host.
                  </>
                ) : (
                  <>
                    Set at least one slot to{" "}
                    <span className="font-semibold text-foreground">AI</span> to
                    field an opponent before the match can begin.
                  </>
                )}
              </p>
            </div>
          </section>

          <aside
            className="flex flex-col gap-4"
            data-ocid="menu.section.records"
          >
            <div className="panel-parchment texture-grain rounded-sm p-4">
              <h2 className="label-stencil text-[11px] text-muted-foreground">
                Campaign record
              </h2>
              {totalMatches > 0 ? (
                <div className="mt-3" data-ocid="menu.stats.panel">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-sm border border-border bg-card px-2 py-2">
                      <span className="block font-mono text-lg font-semibold text-foreground">
                        {wins}
                      </span>
                      <span className="label-stencil text-[9px] text-muted-foreground">
                        Wins
                      </span>
                    </div>
                    <div className="rounded-sm border border-border bg-card px-2 py-2">
                      <span className="block font-mono text-lg font-semibold text-foreground">
                        {losses}
                      </span>
                      <span className="label-stencil text-[9px] text-muted-foreground">
                        Losses
                      </span>
                    </div>
                    <div className="rounded-sm border border-border bg-card px-2 py-2">
                      <span className="block font-mono text-lg font-semibold text-foreground">
                        {winRate}%
                      </span>
                      <span className="label-stencil text-[9px] text-muted-foreground">
                        Win rate
                      </span>
                    </div>
                  </div>
                  {stats && stats.byFaction.length > 0 ? (
                    <ul className="mt-3 space-y-1.5">
                      {stats.byFaction.map((row) => {
                        const faction = getFaction(row.faction);
                        const played = Number(row.totalMatches);
                        return (
                          <li
                            key={row.faction}
                            className="flex items-center justify-between gap-3"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span
                                className={`h-3 w-3 shrink-0 rounded-[2px] border border-black/40 ${faction.bannerClass}`}
                                aria-hidden="true"
                              />
                              <span className="truncate text-xs text-foreground">
                                {faction.name}
                              </span>
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {Number(row.wins)}W · {Number(row.losses)}L ·{" "}
                              {played} played
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <p
                  className="mt-3 text-xs text-muted-foreground"
                  data-ocid="menu.stats.empty_state"
                >
                  No campaigns recorded yet. Your first skirmish will appear
                  here.
                </p>
              )}
            </div>

            <div className="panel-parchment texture-grain rounded-sm p-4">
              <h2 className="label-stencil text-[11px] text-muted-foreground">
                Recent campaigns
              </h2>
              {recent && recent.length > 0 ? (
                <ul className="mt-3 divide-y divide-border">
                  {recent.map((match) => (
                    <li
                      key={match.id.toString()}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold capitalize text-foreground">
                          {match.faction} · {match.mapSize}
                        </span>
                        <span className="block font-mono text-[10px] text-muted-foreground">
                          {match.difficulty} ·{" "}
                          {formatClock(Number(match.durationSeconds))}
                        </span>
                      </span>
                      <span
                        className={`font-mono text-[10px] font-semibold uppercase ${
                          match.result === "victory"
                            ? "text-success"
                            : "text-destructive"
                        }`}
                      >
                        {match.result}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p
                  className="mt-3 text-xs text-muted-foreground"
                  data-ocid="menu.records.empty_state"
                >
                  No campaigns recorded yet. Your first skirmish will appear
                  here.
                </p>
              )}
            </div>

            <div className="panel-parchment texture-grain rounded-sm p-4">
              <h2 className="label-stencil text-[11px] text-muted-foreground">
                Command scheme
              </h2>
              <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                <li>Left-click and drag to select; right-click to order.</li>
                <li>Shift queues orders; Ctrl+1–9 sets control groups.</li>
                <li>
                  Four stances: Aggressive, Defensive, Stand Ground, No Attack.
                </li>
                <li>Advance through four ages at the Town Center.</li>
              </ul>
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
                {RESOURCE_NAMES.map((name) => (
                  <span
                    key={name}
                    className="rounded-[2px] border border-border bg-card px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
          </aside>
        </main>

        <footer className="mt-10 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()}. Built with love using{" "}
            <a
              className="underline underline-offset-2 hover:text-foreground"
              href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
              target="_blank"
              rel="noreferrer"
            >
              caffeine.ai
            </a>
          </p>
        </footer>
      </div>

      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
