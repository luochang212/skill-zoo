import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["**/*.{test,spec}.{ts,tsx}"],
    globals: true,
    // Full-suite runs saturate the machine (54 jsdom environments in parallel),
    // which pushes interaction-heavy tests past the 5s default: the same test
    // that passes alone in ~1s can need 6-11s mid-suite. 15s keeps headroom
    // under load while still failing real hangs at a useful time.
    testTimeout: 15000,
  },
});
