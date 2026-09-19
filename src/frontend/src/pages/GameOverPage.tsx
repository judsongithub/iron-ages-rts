import { MatchResult } from "@/backend";
import type { FactionStats, MatchRecord } from "@/backend";
import { formatClock } from "@/components/game/hudTokens";
import { Button } from "@/components/ui/button";
import { getFaction } from "@/game/factions";
import {
  useMatchStats,
  useRecentMatches,
  useRecordMatch,
} from "@/hooks/useQueries";
import { useMatchSetupStore } from "@/store/matchSetupStore";
import type { MatchOutcome } from "@/types/game";
import { useEffect, useRef } from "react";

interface GameOverPageProps {
  outcome: MatchOutcome;
  onPlayAgain: () => void;
  onReturnToMenu: () => void;
}

/** Converts a backend nanosecond timestamp into a short local date label. */
function formatRecordedAt(timestamp: bigint): string {
  const date = new Date(Number(timestamp / 1_000_000n));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Formats a win ratio as a whole percentage, guarding against zero matches. */
function winRate(wins: bigint, total: bigint): string {
  if (total <= 0n) return "—";
  return `${Math.round((Number(wins) / Number(total)) * 100)}%`;
}

/** A single labelled statistic in the match summary ledger. */
function SummaryStat({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="label-stencil text-[10px] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`mt-1 truncate text-sm font-semibold capitalize text-foreground ${
          mono ? "font-mono tabular-nums" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/** Compact per-faction record row. */
function FactionRow({ stat }: { stat: FactionStats }) {
  const faction = getFaction(stat.faction);
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-[2px] border border-black/40 ${faction.bannerClass}`}
          aria-hidden="true"
        />
        <span className="truncate text-xs font-semibold text-foreground">
          {faction.name}
        </span>
      </span>
      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
        <span className="text-success">{stat.wins.toString()}W</span>
        <span className="mx-1 text-border">/</span>
        <span className="text-destructive">{stat.losses.toString()}L</span>
      </span>
    </li>
  );
}

/** Compact recent-match row. */
function RecentRow({ match }: { match: MatchRecord }) {
  const victory = match.result === MatchResult.victory;
  const faction = getFaction(match.faction);
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-[2px] border border-black/40 ${faction.bannerClass}`}
          aria-hidden="true"
        />
        <span className="truncate text-xs text-muted-foreground">
          {faction.shortName} · {match.mapSize} · {match.difficulty}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span
          className={`label-stencil text-[10px] ${
            victory ? "text-success" : "text-destructive"
          }`}
        >
          {victory ? "Win" : "Loss"}
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {formatClock(Number(match.durationSeconds))}
        </span>
        <span className="hidden font-mono text-[10px] tabular-nums text-muted-foreground sm:inline">
          {formatRecordedAt(match.recordedAt)}
        </span>
      </span>
    </li>
  );
}

/** Post-match summary with the result, record, and next actions. */
export function GameOverPage({
  outcome,
  onPlayAgain,
  onReturnToMenu,
}: GameOverPageProps) {
  const setup = useMatchSetupStore();
  const recordMatch = useRecordMatch();
  const stats = useMatchStats();
  const recent = useRecentMatches(5);
  const recorded = useRef(false);
  const faction = getFaction(setup.faction);
  const victory = outcome.result === MatchResult.victory;

  // Record the completed match once; offline failures are non-fatal.
  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    recordMatch.mutate({
      faction: setup.faction,
      mapSize: setup.mapSize,
      difficulty: setup.difficulty,
      result: outcome.result,
      durationSeconds: outcome.durationSeconds,
    });
  }, [outcome, recordMatch, setup.difficulty, setup.faction, setup.mapSize]);

  const stat = stats.data ?? null;
  const history = recent.data ?? [];
  const hasHistory = history.length > 0;
  const factionStats = (stat?.byFaction ?? []).filter(
    (entry) => entry.totalMatches > 0n,
  );

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background texture-grain p-4 sm:p-6"
      data-ocid="gameover.page"
    >
      <div
        className={`panel-parchment texture-grain w-full max-w-2xl rounded-sm border-t-4 p-6 sm:p-8 ${
          victory ? "border-t-success" : "border-t-destructive"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="label-stencil text-[11px] text-muted-foreground">
              Campaign concluded
            </p>
            <h1
              className={`mt-2 font-display text-4xl font-semibold tracking-tight sm:text-5xl ${
                victory ? "text-success" : "text-destructive"
              }`}
              data-ocid="gameover.result"
            >
              {victory ? "Victory" : "Defeat"}
            </h1>
            <p className="mt-3 max-w-md text-sm text-muted-foreground">
              {victory
                ? "The enemy host is broken and their banners are down. The frontier is yours."
                : "Your base has fallen. The survivors scatter into the hills."}
            </p>
          </div>
          <div
            className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-sm border text-2xl font-semibold ${
              victory
                ? "border-success/50 bg-success/10 text-success"
                : "border-destructive/50 bg-destructive/10 text-destructive"
            }`}
            aria-hidden="true"
          >
            {victory ? "✦" : "✕"}
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-4 border-y border-border py-4 sm:grid-cols-4">
          <div className="min-w-0">
            <dt className="label-stencil text-[10px] text-muted-foreground">
              Faction
            </dt>
            <dd className="mt-1 flex items-center gap-2 text-sm font-semibold text-foreground">
              <span
                className={`h-3 w-3 shrink-0 rounded-[2px] border border-black/40 ${faction.bannerClass}`}
                aria-hidden="true"
              />
              <span className="truncate">{faction.name}</span>
            </dd>
          </div>
          <SummaryStat
            label="Duration"
            value={formatClock(outcome.durationSeconds)}
            mono
          />
          <SummaryStat label="Map" value={setup.mapSize} />
          <SummaryStat label="Difficulty" value={setup.difficulty} />
        </dl>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <section aria-labelledby="gameover-record-heading">
            <h2
              id="gameover-record-heading"
              className="label-stencil text-[11px] text-muted-foreground"
            >
              Your Record
            </h2>
            {stats.isLoading ? (
              <div
                className="mt-3 space-y-2"
                data-ocid="gameover.stats.loading_state"
              >
                <div className="h-4 w-3/4 animate-pulse rounded-sm bg-muted" />
                <div className="h-4 w-1/2 animate-pulse rounded-sm bg-muted" />
              </div>
            ) : stat ? (
              <div className="mt-3" data-ocid="gameover.stats.panel">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-sm border border-border bg-secondary/40 px-2 py-2 text-center">
                    <p className="font-mono text-lg font-semibold tabular-nums text-success">
                      {stat.wins.toString()}
                    </p>
                    <p className="label-stencil text-[9px] text-muted-foreground">
                      Wins
                    </p>
                  </div>
                  <div className="rounded-sm border border-border bg-secondary/40 px-2 py-2 text-center">
                    <p className="font-mono text-lg font-semibold tabular-nums text-destructive">
                      {stat.losses.toString()}
                    </p>
                    <p className="label-stencil text-[9px] text-muted-foreground">
                      Losses
                    </p>
                  </div>
                  <div className="rounded-sm border border-border bg-secondary/40 px-2 py-2 text-center">
                    <p className="font-mono text-lg font-semibold tabular-nums text-foreground">
                      {winRate(stat.wins, stat.totalMatches)}
                    </p>
                    <p className="label-stencil text-[9px] text-muted-foreground">
                      Win Rate
                    </p>
                  </div>
                </div>
                {factionStats.length > 0 ? (
                  <ul className="mt-3 divide-y divide-border border-t border-border">
                    {factionStats.map((entry) => (
                      <FactionRow key={entry.faction} stat={entry} />
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <p
                className="mt-3 text-xs text-muted-foreground"
                data-ocid="gameover.stats.empty_state"
              >
                No record available yet. Sign in and finish a skirmish to start
                tracking your campaigns.
              </p>
            )}
          </section>

          <section aria-labelledby="gameover-recent-heading">
            <h2
              id="gameover-recent-heading"
              className="label-stencil text-[11px] text-muted-foreground"
            >
              Recent Engagements
            </h2>
            {recent.isLoading ? (
              <div
                className="mt-3 space-y-2"
                data-ocid="gameover.recent.loading_state"
              >
                <div className="h-4 w-full animate-pulse rounded-sm bg-muted" />
                <div className="h-4 w-5/6 animate-pulse rounded-sm bg-muted" />
                <div className="h-4 w-2/3 animate-pulse rounded-sm bg-muted" />
              </div>
            ) : hasHistory ? (
              <ul
                className="mt-3 divide-y divide-border border-t border-border"
                data-ocid="gameover.recent.list"
              >
                {history.map((match) => (
                  <RecentRow key={match.id.toString()} match={match} />
                ))}
              </ul>
            ) : (
              <p
                className="mt-3 text-xs text-muted-foreground"
                data-ocid="gameover.recent.empty_state"
              >
                No engagements on record. This skirmish will be the first entry
                in your ledger.
              </p>
            )}
          </section>
        </div>

        <div className="mt-8 flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            className="flex-1 rounded-sm"
            data-ocid="gameover.play_again_button"
            onClick={onPlayAgain}
          >
            Play Again
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="flex-1 rounded-sm"
            data-ocid="gameover.menu_button"
            onClick={onReturnToMenu}
          >
            Return to Main Menu
          </Button>
        </div>
      </div>
    </div>
  );
}
