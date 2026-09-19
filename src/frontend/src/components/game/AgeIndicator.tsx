import { AGE_NAMES, type Age } from "@/types/game";

interface AgeIndicatorProps {
  age: Age;
  /** 0-1 progress toward the next age. */
  progress: number;
  advancing: boolean;
}

const AGE_ROMAN: Record<Age, string> = { 1: "I", 2: "II", 3: "III", 4: "IV" };

/** Shows the current age, its name, and advancement progress. */
export function AgeIndicator({ age, progress, advancing }: AgeIndicatorProps) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5"
      data-ocid="hud.age_indicator"
      title={AGE_NAMES[age]}
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-[2px] border border-hud-accent/60 bg-black/40 font-display text-xs font-semibold text-hud-accent">
        {AGE_ROMAN[age]}
      </span>
      <span className="flex min-w-0 flex-col leading-none">
        <span className="label-stencil text-[10px] text-hud-muted">Age</span>
        <span className="truncate font-display text-xs font-semibold text-hud-foreground">
          {AGE_NAMES[age].replace("Age of ", "")}
        </span>
      </span>
      {advancing && (
        <span className="ml-1 h-1.5 w-12 overflow-hidden rounded-[1px] bg-black/50">
          <span
            className="block h-full bg-hud-accent transition-[width] duration-200"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </span>
      )}
    </div>
  );
}
