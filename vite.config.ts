import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src",
  plugins: [react()],
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react-vendor",
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 30,
            },
            {
              name: "markdown-vendor",
              test: /node_modules[\\/](react-markdown|remark-|rehype-|unified|micromark|mdast-|hast-|property-information|html-|space-separated-tokens|comma-separated-tokens|trim-lines|vfile|bail|devlop|trough|zwitch|entities|decode-named-character-reference|highlight\.js)[\\/]/,
              priority: 25,
            },
            {
              name: "codemirror-vendor",
              test: /node_modules[\\/](@codemirror|codemirror|@lezer|crelt|style-mod|w3c-keyname)[\\/]/,
              priority: 25,
            },
            {
              name: "motion-vendor",
              test: /node_modules[\\/](framer-motion|motion-dom|motion-utils|tslib)[\\/]/,
              priority: 20,
            },
            {
              name: "icons-vendor",
              test: /node_modules[\\/]lucide-react[\\/]/,
              priority: 20,
            },
            {
              name: "tauri-vendor",
              test: /node_modules[\\/]@tauri-apps[\\/]/,
              priority: 20,
            },
            {
              name: "vendor",
              test: /node_modules[\\/]/,
              priority: 1,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 3000,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
});
