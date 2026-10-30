import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src",
  plugins: [react()],
  base: "./",
  build: {
    // The app's browser floor: the oldest shipped engine is WKWebView on
    // macOS 13.3 (see AGENTS.md, "Browser Support Floor"). Keep in sync with
    // bundle.macOS.minimumSystemVersion in src-tauri/tauri.conf.json.
    target: "safari16.4",
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    strictPort: true,
    // Pin IPv4: bun's dev server binds IPv6-only by default, while the Tauri
    // webview loads "localhost", which macOS resolves to 127.0.0.1 first.
    host: "127.0.0.1",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
});
