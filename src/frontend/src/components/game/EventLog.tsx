import type { GameEvent } from "@/types/game";
import { useEffect, useRef } from "react";

interface EventLogProps {
  events: readonly GameEvent[];
  className?: string;
}

const EVENT_ACCENT: Record<GameEvent["kind"], string> = {
  attack: "border-l-destructive text-destructive",
  construction: "border-l-valid text-valid",
  age: "border-l-hud-accent text-hud-accent",
  train: "border-l-hud-border text-hud-foreground",
  destroy: "border-l-destructive text-destructive",
  info: "border-l-hud-accent text-hud-foreground",
};

/** Scrolling log of match notifications, newest first. */
export function EventLog({ events, className }: EventLogProps) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const previousCount = useRef(0);

  useEffect(() => {
    if (events.length !== previousCount.current) {
      previousCount.current = events.length;
      if (listRef.current) listRef.current.scrollTop = 0;
    }
  }, [events.length]);

  const recent = [...events].reverse().slice(0, 12);

  return (
    <div className={className} data-ocid="hud.event_log">
      <div className="flex items-center justify-between border-b border-hud-border px-2 py-1">
        <span className="label-stencil text-[10px] text-hud-muted">
          Dispatches
        </span>
        <span className="font-mono text-[10px] text-hud-muted">
          {events.length}
        </span>
      </div>
      {recent.length === 0 ? (
        <p
          className="px-2 py-3 text-xs text-hud-muted"
          data-ocid="hud.event_log.empty_state"
        >
          No dispatches yet. The field is quiet.
        </p>
      ) : (
        <ul ref={listRef} className="max-h-40 overflow-y-auto">
          {recent.map((event) => (
            <li
              key={event.id}
              className={`border-l-2 bg-black/20 px-2 py-1 text-xs ${EVENT_ACCENT[event.kind]}`}
            >
              {event.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
