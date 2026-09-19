import type { Stance } from "@/types/game";
import { create } from "zustand";

/** An entity selected for inspection only (enemy units/buildings, nodes). */
export interface InspectTarget {
  kind: "unit" | "building" | "node";
  id: number;
}

interface SelectionState {
  /** Currently selected unit ids. */
  unitIds: number[];
  /** Currently selected building id, if a single building is selected. */
  buildingId: number | null;
  /** Enemy entity selected for inspection, if any. */
  inspectTarget: InspectTarget | null;
  /** Active stance applied to the selection. */
  stance: Stance;
  /** Control groups 1-9. */
  controlGroups: Record<number, number[]>;
  /** Last control group recalled, for double-tap centering. */
  lastGroupTap: { group: number; at: number } | null;
  setSelection: (unitIds: number[], buildingId?: number | null) => void;
  setInspectTarget: (target: InspectTarget | null) => void;
  clearSelection: () => void;
  setStance: (stance: Stance) => void;
  assignGroup: (group: number, unitIds: number[]) => void;
  recallGroup: (group: number) => number[];
  noteGroupTap: (group: number) => boolean;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  unitIds: [],
  buildingId: null,
  inspectTarget: null,
  stance: "aggressive",
  controlGroups: {},
  lastGroupTap: null,
  setSelection: (unitIds, buildingId = null) =>
    set({ unitIds, buildingId: buildingId ?? null, inspectTarget: null }),
  setInspectTarget: (inspectTarget) => set({ inspectTarget }),
  clearSelection: () =>
    set({ unitIds: [], buildingId: null, inspectTarget: null }),
  setStance: (stance) => set({ stance }),
  assignGroup: (group, unitIds) =>
    set((state) => ({
      controlGroups: { ...state.controlGroups, [group]: unitIds },
    })),
  recallGroup: (group) => get().controlGroups[group] ?? [],
  noteGroupTap: (group) => {
    const now = Date.now();
    const last = get().lastGroupTap;
    const isDouble =
      last !== null && last.group === group && now - last.at < 350;
    set({ lastGroupTap: { group, at: now } });
    return isDouble;
  },
}));
