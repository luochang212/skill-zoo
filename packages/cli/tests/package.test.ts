import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("npm package manifest", () => {
  it("ships WUI static assets", async () => {
    const packageJson = JSON.parse(
      await fs.readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { files?: string[] };

    expect(packageJson.files).toContain("dist");
    expect(packageJson.files).toContain("wui");
    expect(packageJson.files).toContain("README.md");
  });
});
