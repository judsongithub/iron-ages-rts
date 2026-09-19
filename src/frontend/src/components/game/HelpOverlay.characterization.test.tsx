import { HelpOverlay } from "@/components/game/HelpOverlay";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

/**
 * Characterization baseline for the Manual modal.
 *
 * The request intentionally expands the Manual with new sections, so this file
 * does NOT assert the exact shortcut list or a fixed row count. It protects the
 * modal's open/close contract and the presence of the core command reference
 * that must remain after the expansion.
 */
describe("HelpOverlay characterization", () => {
  it("renders nothing while closed", () => {
    render(<HelpOverlay open={false} onClose={vi.fn()} />);
    expect(
      document.querySelector('[data-ocid="help.modal"]'),
    ).not.toBeInTheDocument();
  });

  it("shows the Field Manual with the core command reference when open", async () => {
    const user = userEvent.setup();
    render(<HelpOverlay open onClose={vi.fn()} />);

    expect(
      document.querySelector('[data-ocid="help.modal"]'),
    ).toBeInTheDocument();
    expect(screen.getByText("Field Manual")).toBeInTheDocument();

    // The command reference now lives on its own tab; the expansion must not
    // have dropped any of the core commands.
    await user.click(screen.getByRole("tab", { name: "Controls" }));
    for (const action of [
      /Select a unit or building/i,
      /Box-select multiple units/i,
      /Move, gather, attack, or repair/i,
      /Queue an order behind the current one/i,
      /Assign the current selection to a control group/i,
      /Recall a control group/i,
      /Pan the camera/i,
      /Zoom in and out/i,
    ]) {
      expect(screen.getByText(action)).toBeInTheDocument();
    }
  });

  it("closes via the Close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HelpOverlay open onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: /^Close$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the backdrop is clicked but not when the panel is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HelpOverlay open onClose={onClose} />);

    await user.click(screen.getByText("Field Manual"));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(
      document.querySelector('[data-ocid="help.modal"]') as HTMLElement,
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
