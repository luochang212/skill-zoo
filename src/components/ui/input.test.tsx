import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "./input";

/**
 * The shared Input used to suppress the UA outline and replace it with only a
 * 1px border tint at 50% alpha — measured at 2.67:1 against the resting border in
 * light mode and 1.69:1 in dark, below the 3:1 floor. The fix keeps the existing
 * visual language (the border changes colour, no ring is drawn) and strengthens it
 * to the full --ring token: 13.18:1 in light, 5.09:1 in dark.
 */
describe("Input focus indicator", () => {
  it("keeps a border-colour focus indicator instead of removing it", () => {
    render(<Input aria-label="demo" />);

    const input = screen.getByRole("textbox", { name: "demo" });
    expect(input.className).toContain("focus-visible:border-ring");
    // Not the sub-threshold half-alpha tint.
    expect(input.className).not.toContain("focus-visible:border-ring/50");
    // And no box-shadow ring: the product chose the lighter border treatment.
    expect(input.className).not.toContain("focus-visible:ring-2");
  });
});
