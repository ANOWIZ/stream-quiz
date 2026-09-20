import { geoBounds, geoCentroid, geoContains, geoArea } from "d3-geo";
import type { Feature, Geometry } from "geojson";
import type { GeoPoint } from "./content.js";
export type CountryFeature = Feature<Geometry, { code: string; name: string }>;
export function containsPoint(
  country: CountryFeature,
  point: GeoPoint,
): boolean {
  return geoContains(country, [point.longitude, point.latitude]);
}
export function interiorPoint(country: CountryFeature): GeoPoint | null {
  const [longitude, latitude] = geoCentroid(country);
  if (
    Number.isFinite(longitude) &&
    containsPoint(country, { longitude, latitude })
  )
    return { longitude, latitude };
  const pieces =
    country.geometry.type === "MultiPolygon"
      ? country.geometry.coordinates
          .map((coordinates) => ({ type: "Polygon" as const, coordinates }))
          .sort((a, b) => geoArea(b) - geoArea(a))
      : [country.geometry];
  for (const piece of pieces) {
    const [[west, south], [east, north]] = geoBounds(piece);
    const span = east < west ? east + 360 - west : east - west;
    for (let y = 1; y < 40; y++)
      for (let x = 1; x < 40; x++) {
        const lng = west + (span * x) / 40;
        const candidate = {
          longitude: lng > 180 ? lng - 360 : lng,
          latitude: south + ((north - south) * y) / 40,
        };
        if (containsPoint(country, candidate)) return candidate;
      }
  }
  return null;
}
