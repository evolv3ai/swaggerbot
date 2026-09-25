import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin } from "vite";
import { SCALAR_SCRIPT_PATH } from "./src/server/scalar-script";

/**
 * Serves Scalar's standalone browser bundle at `SCALAR_SCRIPT_PATH`, from
 * our own build (Slice 6 backlog, D6): emitted into the client output by
 * `vite build`, served from node_modules by `vite dev`. Its source map
 * comment is dropped, as the map isn't served.
 */
function scalarBundle(): Plugin {
  const entry = createRequire(import.meta.url).resolve("@scalar/api-reference");
  const file = join(dirname(entry), "browser", "standalone.js");
  const source = () =>
    readFileSync(file, "utf8").replace(
      /\n\/\/# sourceMappingURL=\S+\s*$/,
      "\n",
    );
  return {
    name: "swaggerbot:scalar-bundle",
    configureServer(server) {
      server.middlewares.use(SCALAR_SCRIPT_PATH, (_req, res) => {
        res.setHeader("content-type", "text/javascript; charset=utf-8");
        res.end(source());
      });
    },
    applyToEnvironment: (environment) => environment.name === "client",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: SCALAR_SCRIPT_PATH.slice(1),
        source: source(),
      });
    },
  };
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    tanstackStart({ router: { routeFileIgnorePattern: "\\.test\\.ts$" } }),
    // Opens the Index and starts the workers at start-up; see src/server/open-index.ts.
    nitro({ plugins: ["./src/server/open-index.ts"] }),
    viteReact(),
    tailwindcss(),
    scalarBundle(),
  ],
});
