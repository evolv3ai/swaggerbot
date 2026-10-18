import { defineConfig } from "vite";

// Bundles the operator scripts into .output/cli so they run in the production
// image, which has no src/, scripts/ or tsx: scripts/keys.ts into keys.mjs
// (`node .output/cli/keys.mjs`) and scripts/chatstats.ts into chatstats.mjs.
// Everything is bundled except better-sqlite3, a native module, which resolves
// from the copy Nitro traces into .output/server/node_modules; code both share
// goes into a chunk beside them, so that path holds for it too.
export default defineConfig({
  publicDir: false,
  build: {
    ssr: true,
    outDir: ".output/cli",
    emptyOutDir: true,
    target: "node24",
    rollupOptions: {
      input: { keys: "scripts/keys.ts", chatstats: "scripts/chatstats.ts" },
      external: ["better-sqlite3"],
      output: {
        format: "esm",
        entryFileNames: "[name].mjs",
        chunkFileNames: "[name]-[hash].mjs",
        paths: {
          "better-sqlite3":
            "../server/node_modules/better-sqlite3/lib/index.js",
        },
      },
    },
  },
  ssr: { noExternal: true },
});
