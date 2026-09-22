import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import polygonClipping from "polygon-clipping";

const root = new URL("../", import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, root), "utf8"));
const world = read("public/world.json");
const baseline = read("assets/maps/base-ru-ua.geojson");
const regions = read("assets/maps/game-regions.geojson");
const ru = baseline.features.find((f) => f.properties.code === "RU");
const ua = baseline.features.find((f) => f.properties.code === "UA");
if (!ru || !ua || regions.features.length !== 4)
  throw Error("Expected baseline RU/UA and four administrative regions");

// This is the host's game convention, not a claim about international borders
// or territorial control. Crimea is already included in baseline RU.
// Intersect with the original UA polygon so all other countries and the outer
// coastline stay unchanged despite the different source resolutions.
const intersection = polygonClipping.intersection(
  ua.geometry.coordinates,
  polygonClipping.union(...regions.features.map((f) => f.geometry.coordinates)),
);
// Return intersection vertices to the source's 6-decimal grid. This avoids
// near-coincident floating-point edges in subsequent boolean operations.
const snap = (coordinates) =>
  coordinates.map((polygon) =>
    polygon.map((ring) =>
      ring.map((point) =>
        point.map((coordinate) => Math.round(coordinate * 1e6) / 1e6),
      ),
    ),
  );
const transferred = snap(intersection);
const remainder = polygonClipping.difference(
  ua.geometry.coordinates,
  transferred,
);
// Different source resolutions leave detached coastal strips and estuary
// pieces. Assign small pieces in the affected area to the surrounding regions.
const area = (ring) =>
  Math.abs(
    ring.reduce((sum, [x, y], i) => {
      const next = ring[(i + 1) % ring.length];
      return sum + x * next[1] - next[0] * y;
    }, 0) / 2,
  );
const retained = snap(
  remainder.filter(
    (polygon) =>
      !(
        area(polygon[0]) < 0.08 &&
        polygon
          .flat()
          .every(([x, y]) => x >= 31.4 && x <= 40.3 && y >= 45.6 && y <= 50.2)
      ),
  ),
);
const completeTransfer = snap(
  polygonClipping.difference(ua.geometry.coordinates, retained),
);
const replacements = {
  RU: polygonClipping.union(ru.geometry.coordinates, completeTransfer),
  UA: retained,
};
for (const feature of world.features) {
  const coordinates = replacements[feature.properties.code];
  if (!coordinates) continue;
  // d3-geo uses the opposite ring winding to polygon-clipping's GeoJSON output.
  feature.geometry = {
    type: "MultiPolygon",
    coordinates: coordinates.map((polygon) =>
      polygon.map((ring) => [...ring].reverse()),
    ),
  };
}
world.quizMap = {
  version: "host-regions-2026-09-21-r2",
  model: "host-defined-game-convention",
  note: "User-selected grouping of Crimea, Donetsk, Luhansk, Kherson and Zaporizhzhia into RU. Not a territorial-control snapshot or statement of internationally recognized borders.",
  source: "Natural Earth; see ASSETS.md and assets/maps/README.md",
};
const output = JSON.stringify(world) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(new URL("public/world.json", root), "utf8") !== output)
    throw Error("Generated game map differs from public/world.json");
} else writeFileSync(new URL("public/world.json", root), output);
console.log(
  `Updated ${fileURLToPath(new URL("public/world.json", root))}; ${world.features.length} country codes retained.`,
);
