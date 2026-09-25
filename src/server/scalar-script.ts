/**
 * Where Scalar's browser bundle is served from: our own build (the Vite
 * plugin `scalarBundle` in `vite.config.ts`), never a CDN. Its own module,
 * with no imports, so `vite.config.ts` can read it.
 */
export const SCALAR_SCRIPT_PATH = "/embed/scalar-api-reference.js";
