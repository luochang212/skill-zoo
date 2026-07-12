import { describe, expect, it } from "vitest";

describe("index.css", () => {
  it("keeps the static dnd feedback fallback for packaged WebViews", async () => {
    // @ts-expect-error Vitest runs this in Node, but the app tsconfig omits Node types.
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/index.css", "utf8") as string;

    expect(css).toContain("[data-dnd-dragging]");
    expect(css).toContain("position: fixed !important");
    expect(css).toContain("pointer-events: none !important");
    expect(css).toContain("translate: var(--dnd-translate");
    expect(css).toContain("[data-dnd-overlay]:not([data-dnd-dragging])");
  });
});
