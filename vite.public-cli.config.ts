import { defineConfig } from "vite";

// Bundles the public CLI (src/cli/, Slice 8) into cli/dist/swaggerbot.mjs,
// the one file `npm install -g swaggerbot` runs: everything bundled, nothing
// external but Node's own modules, for Node 20 and later (cli/package.json).
export default defineConfig({
  build: {
    ssr: "src/cli/bin.ts",
    outDir: "cli/dist",
    emptyOutDir: true,
    target: "node20",
    minify: false,
    rollupOptions: {
      external: [],
      output: {
        format: "esm",
        entryFileNames: "swaggerbot.mjs",
        banner: "#!/usr/bin/env node",
      },
    },
  },
  // No public/ copy: the bundle is the whole package.
  publicDir: false,
  ssr: { noExternal: true, target: "node" },
});
