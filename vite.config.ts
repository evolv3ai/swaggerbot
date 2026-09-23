import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    tanstackStart({ router: { routeFileIgnorePattern: "\\.test\\.ts$" } }),
    // Opens the Index and starts the workers at start-up; see src/server/open-index.ts.
    nitro({ plugins: ["./src/server/open-index.ts"] }),
    viteReact(),
  ],
});
