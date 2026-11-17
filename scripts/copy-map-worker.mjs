// MapLibre 6 runs its tile work in a separate worker file that it looks for next to its own code,
// which bundlers don't copy. We serve the package's worker from /vendor and point MapLibre at it
// (src/lib/map-loader.ts). Runs after every `npm install`, so the copy always matches the package.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkg = require("maplibre-gl/package.json");
const src = join(dirname(require.resolve("maplibre-gl/package.json")), "dist", "maplibre-gl-worker.mjs");
mkdirSync("public/vendor", { recursive: true });
copyFileSync(src, "public/vendor/maplibre-gl-worker.mjs");
console.log(`map worker ${pkg.version} → public/vendor/maplibre-gl-worker.mjs`);
