import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config.ts?raw";
import tauriConfig from "../src-tauri/tauri.conf.json?raw";

describe("browser support floor", () => {
  it("pins the same floor in vite.config.ts and src-tauri/tauri.conf.json", () => {
    expect(viteConfig).toMatch(/target:\s*"safari16\.4"/);

    const tauri = JSON.parse(tauriConfig) as {
      bundle: { macOS: { minimumSystemVersion: string } };
    };
    expect(tauri.bundle.macOS.minimumSystemVersion).toBe("13.3");
  });
});
