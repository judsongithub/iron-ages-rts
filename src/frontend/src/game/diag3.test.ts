import {
  RESOURCE_GLYPH,
  RESOURCE_ORDER,
  formatAmount,
  formatClock,
  formatRate,
} from "@/components/game/hudTokens";
import { describe, expect, it } from "vitest";

describe("hudTokens", () => {
  it("orders the six tracked resources", () => {
    expect(RESOURCE_ORDER).toEqual([
      "food",
      "wood",
      "gold",
      "stone",
      "money",
      "energy",
    ]);
  });

  it("provides a glyph for every resource", () => {
    for (const kind of RESOURCE_ORDER) {
      expect(RESOURCE_GLYPH[kind]).toMatch(/^[A-Z]$/);
    }
  });

  it("formats amounts compactly", () => {
    expect(formatAmount(0)).toBe("0");
    expect(formatAmount(999)).toBe("999");
    expect(formatAmount(12345)).toBe("12.3k");
  });

  it("formats per-minute rates with a sign", () => {
    expect(formatRate(0)).toBe("+0.0");
    expect(formatRate(12.34)).toBe("+12.3");
    expect(formatRate(-4.2)).toBe("-4.2");
  });

  it("formats a match clock as mm:ss", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65)).toBe("01:05");
    expect(formatClock(3599)).toBe("59:59");
    expect(formatClock(-5)).toBe("00:00");
  });
});
