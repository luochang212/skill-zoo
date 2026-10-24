import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getPaths } from "../src/protocol/paths.js";
import { readLock, readMetadata, readExternalImports } from "../src/protocol/store.js";
import { scanInstalledSkills } from "../src/protocol/scan.js";
import { CliError } from "../src/lib/errors.js";
import { makeTempHome, writeSkill } from "./helpers.js";

describe("desktop-owned state file tolerance", () => {
  it("treats empty and whitespace state files as absent like the desktop", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"), "name: Demo");
    await fs.mkdir(path.dirname(paths.metadataFile), { recursive: true });
    await fs.writeFile(paths.metadataFile, "   \n");
    await fs.writeFile(paths.externalImportsFile, "");

    await expect(readMetadata(home)).resolves.toMatchObject({ entries: {} });
    await expect(readExternalImports(home)).resolves.toMatchObject({ imports: {} });
    // A full scan must work over the tolerated-empty state files.
    await expect(scanInstalledSkills(home)).resolves.toHaveLength(1);
  });

  it("reports a non-object lock document as a clean error instead of crashing", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await fs.mkdir(path.dirname(paths.agentLockFile), { recursive: true });
    await fs.writeFile(paths.agentLockFile, "null");

    await expect(readLock(home)).rejects.toThrow(CliError);
    await expect(readLock(home)).rejects.toThrow(/not a valid document/);
  });
});
