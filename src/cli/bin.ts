// The bundle's entry (`cli/dist/swaggerbot.mjs`): runs the CLI over the
// process. Everything testable is in `main.ts`, which this only calls.
import { main } from "./main";

await main();
