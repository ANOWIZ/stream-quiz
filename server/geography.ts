import { readFileSync, existsSync } from "node:fs";
import { containsPoint, type CountryFeature } from "../shared/geography.js";
import type { GeoPoint } from "../shared/content.js";
import { geoDistance } from "d3-geo";
export const countries = (
  JSON.parse(
    readFileSync(
      existsSync("public/world.json")
        ? "public/world.json"
        : "dist/client/world.json",
      "utf8",
    ),
  ) as { features: CountryFeature[] }
).features;
export function validCountryPoint(code: string, point: GeoPoint): boolean {
  const country = countries.find((f) => f.properties.code === code);
  return !!country && containsPoint(country, point);
}

// The simplified coastline omits small islands (including this Venice bridge).
// This tolerance is only for the host's source coordinates, never player answers.
export function validPanoramaPoint(code: string, point: GeoPoint): boolean {
  if (validCountryPoint(code, point)) return true;
  if (countries.some((country) => containsPoint(country, point))) return false;
  const country = countries.find((f) => f.properties.code === code);
  if (!country) return false;
  if (
    country.geometry.type !== "Polygon" &&
    country.geometry.type !== "MultiPolygon"
  )
    return false;
  const rings =
    country.geometry.type === "Polygon"
      ? country.geometry.coordinates
      : country.geometry.coordinates.flat();
  return rings.some((ring) =>
    ring.some(
      (vertex) =>
        geoDistance([point.longitude, point.latitude], [vertex[0], vertex[1]]) *
          6371 <=
        10,
    ),
  );
}
