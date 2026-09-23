import { defineConfig } from "vite";

// Bundles scripts/keys.ts into .output/cli/keys.mjs so the keys CLI runs in the
// production image, which has no src/, scripts/ or tsx: `node .output/cli/keys.mjs`.
// Everything is bundled except better-sqlite3, a native module, which resolves
// from the copy Nitro traces into .output/server/node_modules.
export default defineConfig({
  build: {
    ssr: "scripts/keys.ts",
    outDir: ".output/cli",
    emptyOutDir: true,
    target: "node24",
    rollupOptions: {
      external: ["better-sqlite3"],
      output: {
        format: "esm",
        entryFileNames: "keys.mjs",
        paths: {
          "better-sqlite3":
            "../server/node_modules/better-sqlite3/lib/index.js",
        },
      },
    },
  },
  ssr: { noExternal: true },
});
