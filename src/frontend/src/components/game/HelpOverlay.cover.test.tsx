import { HelpOverlay } from "@/components/game/HelpOverlay";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

/**
 * Cover for the expanded Field Manual.
 *
 * The accepted behavior: the Manual gains five guide tabs — Resource
 * Acquisition, Age Advancement, Market & Diplomacy, Energy Grid Management,
 * and Win Conditions — alongside the existing Controls reference, and each tab
 * renders its own content.
 */
describe("HelpOverlay cover: expanded manual", () => {
  it("offers the five guide tabs plus the controls reference", () => {
    render(<HelpOverlay open onClose={vi.fn()} />);

    for (const name of [
      "Resources",
      "Ages",
      "Market & Diplomacy",
      "Energy Grid",
      "Victory",
      "Controls",
    ]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
  });

  it("renders the resource-acquisition guide by default", () => {
    render(<HelpOverlay open onClose={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: "Villager Gathering" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Automated Farms" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Money from the Market" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Energy from Power Plants" }),
    ).toBeInTheDocument();
  });

  it("renders each guide tab's content when selected", async () => {
    const user = userEvent.setup();
    render(<HelpOverlay open onClose={vi.fn()} />);

    await user.click(screen.getByRole("tab", { name: "Ages" }));
    expect(
      screen.getByRole("heading", { name: "Advancing an Age" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Market & Diplomacy" }));
    expect(
      screen.getByRole("heading", { name: "Investment Contracts" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Energy Grid" }));
    expect(
      screen.getByRole("heading", { name: "Distribution Coverage" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Victory" }));
    expect(
      screen.getByRole("heading", { name: "Victory" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Defeat" })).toBeInTheDocument();
  });

  it("keeps the controls reference on its own tab", async () => {
    const user = userEvent.setup();
    render(<HelpOverlay open onClose={vi.fn()} />);

    await user.click(screen.getByRole("tab", { name: "Controls" }));

    expect(
      screen.getByRole("heading", { name: "Controls" }),
    ).toBeInTheDocument();
    for (const action of [
      /Select a unit or building/i,
      /Box-select multiple units/i,
      /Move, gather, attack, or repair/i,
      /Pan the camera/i,
      /Zoom in and out/i,
    ]) {
      expect(screen.getByText(action)).toBeInTheDocument();
    }
  });

  it("describes gathering, ages, and victory in the guide tabs", async () => {
    const user = userEvent.setup();
    render(<HelpOverlay open onClose={vi.fn()} />);

    // Gathering section names the gatherer and the drop-off.
    expect(
      screen.getByText(/Villagers are your only gatherers/i),
    ).toBeInTheDocument();

    // Age section names the Town Center as the advancing structure.
    await user.click(screen.getByRole("tab", { name: "Ages" }));
    expect(
      screen.getByText(/it is the only structure that can advance/i),
    ).toBeInTheDocument();

    // Win section states the production-building victory rule.
    await user.click(screen.getByRole("tab", { name: "Victory" }));
    expect(
      screen.getByText(/Destroy every enemy production/i),
    ).toBeInTheDocument();
  });
});
