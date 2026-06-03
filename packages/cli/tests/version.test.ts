import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { CLI_VERSION } from "../src/version.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

describe("CLI_VERSION", () => {
  it("uses package.json as the single version source", () => {
    expect(CLI_VERSION).toBe(packageJson.version);
  });
});
