import { Faction } from "@/backend";
import type { UnitKind } from "@/types/game";

export interface FactionDefinition {
  id: Faction;
  name: string;
  shortName: string;
  bannerColor: string;
  /** Tailwind class for the banner swatch. */
  bannerClass: string;
  blurb: string;
  /** Human-readable description of the passive bonus. */
  bonusLabel: string;
  bonusDescription: string;
  /** Multiplier applied to villager gather rates. */
  gatherMultiplier: number;
  /** Multiplier applied to unit and building costs. */
  costMultiplier: number;
  /** Multiplier applied to building max health. */
  buildingHealthMultiplier: number;
  /** Multiplier applied to unit max health. */
  unitHealthMultiplier: number;
  /** Multiplier applied to unit attack. */
  attackMultiplier: number;
  /** The faction's unique elite unit. */
  eliteUnit: UnitKind;
  eliteName: string;
  eliteDescription: string;
}

export const FACTIONS: Record<Faction, FactionDefinition> = {
  [Faction.romans]: {
    id: Faction.romans,
    name: "Ember Legion",
    shortName: "Legion",
    bannerColor: "oklch(0.575 0.19 28)",
    bannerClass: "bg-faction-1",
    blurb:
      "Disciplined heavy infantry drilled in the old imperial manner, marching behind shield walls and siege trains.",
    bonusLabel: "Legion Discipline",
    bonusDescription:
      "Buildings are 20% tougher and unit attack is 10% higher — fortifications hold longer and blades bite deeper.",
    gatherMultiplier: 1,
    costMultiplier: 1,
    buildingHealthMultiplier: 1.2,
    unitHealthMultiplier: 1,
    attackMultiplier: 1.1,
    eliteUnit: "praetorian",
    eliteName: "Praetorian Guard",
    eliteDescription:
      "Armoured heavy infantry with unmatched staying power, trained only at the Fortress in the Age of Empire.",
  },
  [Faction.mongols]: {
    id: Faction.mongols,
    name: "Steppe Horde",
    shortName: "Horde",
    bannerColor: "oklch(0.585 0.13 232)",
    bannerClass: "bg-faction-2",
    blurb:
      "Horse-borne raiders who live off the land, striking fast and vanishing before the enemy can mass a defence.",
    bonusLabel: "Steppe Logistics",
    bonusDescription:
      "Villagers gather 20% faster and units cost 10% less — a leaner economy that fields armies sooner.",
    gatherMultiplier: 1.2,
    costMultiplier: 0.9,
    buildingHealthMultiplier: 1,
    unitHealthMultiplier: 1,
    attackMultiplier: 1,
    eliteUnit: "keshig",
    eliteName: "Keshig Rider",
    eliteDescription:
      "Elite horse archers who harry the enemy line, trained only at the Fortress in the Age of Empire.",
  },
  [Faction.vikings]: {
    id: Faction.vikings,
    name: "Verdant Pact",
    shortName: "Pact",
    bannerColor: "oklch(0.625 0.14 142)",
    bannerClass: "bg-faction-3",
    blurb:
      "Clan warriors bound by oath, hardy and self-reliant, drawing strength from the deep forests they call home.",
    bonusLabel: "Clan Endurance",
    bonusDescription:
      "Units have 15% more health and villagers gather 10% faster — a resilient host that outlasts its rivals.",
    gatherMultiplier: 1.1,
    costMultiplier: 1,
    buildingHealthMultiplier: 1,
    unitHealthMultiplier: 1.15,
    attackMultiplier: 1,
    eliteUnit: "huscarl",
    eliteName: "Huscarl",
    eliteDescription:
      "Oath-sworn champions in mail and axe, trained only at the Fortress in the Age of Empire.",
  },
};

export const FACTION_LIST: readonly FactionDefinition[] = [
  FACTIONS[Faction.romans],
  FACTIONS[Faction.mongols],
  FACTIONS[Faction.vikings],
];

export function getFaction(id: Faction): FactionDefinition {
  return FACTIONS[id];
}
