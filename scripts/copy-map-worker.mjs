// MapLibre 6 ships its web worker as a separate file that the bundler cannot resolve, so it is served from public/.
import { copyFileSync } from "node:fs";

for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(`node_modules/maplibre-gl/dist/${file}`, `public/${file}`);
}
