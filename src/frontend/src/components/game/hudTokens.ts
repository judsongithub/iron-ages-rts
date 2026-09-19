import type { ResourceKind } from "@/types/game";

export const RESOURCE_ORDER: readonly ResourceKind[] = [
  "food",
  "wood",
  "gold",
  "stone",
  "money",
  "energy",
];

export const RESOURCE_TEXT_CLASS: Record<ResourceKind, string> = {
  food: "text-resource-food",
  wood: "text-resource-wood",
  gold: "text-resource-gold",
  stone: "text-resource-stone",
  money: "text-resource-money",
  energy: "text-resource-energy",
};

export const RESOURCE_BG_CLASS: Record<ResourceKind, string> = {
  food: "bg-resource-food",
  wood: "bg-resource-wood",
  gold: "bg-resource-gold",
  stone: "bg-resource-stone",
  money: "bg-resource-money",
  energy: "bg-resource-energy",
};

export const RESOURCE_GLYPH: Record<ResourceKind, string> = {
  food: "F",
  wood: "W",
  gold: "G",
  stone: "S",
  money: "M",
  energy: "E",
};

/** Formats a resource amount compactly for the HUD. */
export function formatAmount(value: number): string {
  const rounded = Math.floor(value);
  if (rounded >= 10000) return `${(rounded / 1000).toFixed(1)}k`;
  return rounded.toString();
}

/** Formats a per-minute rate with a sign. */
export function formatRate(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(1)}`;
}

/** Formats seconds as mm:ss. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
