import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("npm package manifest", () => {
  it("ships WUI static assets", async () => {
    const dir = typeof import.meta.dirname === "string"
      ? import.meta.dirname
      : path.dirname(fileURLToPath(import.meta.url));
    const cliRoot = path.resolve(dir, "..");
    const packageJson = JSON.parse(
      await fs.readFile(path.join(cliRoot, "package.json"), "utf8"),
    ) as { files?: string[] };

    expect(packageJson.files).toContain("dist");
    expect(packageJson.files).toContain("wui");
    expect(packageJson.files).toContain("README.md");
  });
});
