import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { geoArea } from "d3-geo";
import { expect, it } from "vitest";
import { countries, validCountryPoint } from "../server/geography.js";
import {
  interiorPoint,
  WORLD_MAP_VERSION,
  type CountryFeature,
} from "../shared/geography.js";

it.each([
  ["Симферополь", 34.1024, 44.9521],
  ["Севастополь", 33.5224, 44.6167],
  ["Донецк", 37.8028, 48.0159],
  ["Краматорск", 37.5563, 48.7389],
  ["Луганск", 39.3078, 48.574],
  ["Северодонецк", 38.493, 48.948],
  ["Херсон", 32.6169, 46.6558],
  ["Херсон — набережная", 32.6178, 46.6354],
  ["Новая Каховка", 33.3707, 46.7545],
  ["Запорожье", 35.1396, 47.8388],
  ["Мелитополь", 35.365, 46.8489],
] as const)(
  "игровая схема ведущего: %s выбирается как RU",
  (_city, longitude, latitude) => {
    const point = { longitude, latitude };
    expect(validCountryPoint("RU", point)).toBe(true);
    expect(validCountryPoint("UA", point)).toBe(false);
  },
);

it.each([
  ["Киев", 30.5234, 50.4501],
  ["Харьков", 36.2304, 49.9935],
  ["Днепр", 35.045, 48.4647],
  ["Одесса", 30.7233, 46.4825],
  ["Николаев", 31.9946, 46.975],
] as const)("игровая схема оставляет %s в UA", (_city, longitude, latitude) => {
  const point = { longitude, latitude };
  expect(validCountryPoint("UA", point)).toBe(true);
  expect(validCountryPoint("RU", point)).toBe(false);
});

it("раздел сохраняет площадь, коды и доступный выбор обеих стран", () => {
  const baseline = JSON.parse(
    readFileSync("assets/maps/base-ru-ua.geojson", "utf8"),
  ) as { features: CountryFeature[] };
  const changed = countries.filter((f) =>
    ["RU", "UA"].includes(f.properties.code),
  );
  expect(changed.reduce((sum, f) => sum + geoArea(f), 0)).toBeCloseTo(
    baseline.features.reduce((sum, f) => sum + geoArea(f), 0),
    6,
  );
  expect(countries).toHaveLength(237);
  expect(new Set(countries.map((f) => f.properties.code)).size).toBe(237);
  for (const country of changed) {
    const point = interiorPoint(country)!;
    expect(validCountryPoint(country.properties.code, point)).toBe(true);
    expect(
      validCountryPoint(country.properties.code === "RU" ? "UA" : "RU", point),
    ).toBe(false);
  }
  // Sample the entire affected area; the same point cannot select both codes.
  for (let longitude = 31.57; longitude < 40.5; longitude += 0.2)
    for (let latitude = 44.17; latitude < 50.5; latitude += 0.2) {
      const point = { longitude, latitude };
      expect(
        validCountryPoint("RU", point) && validCountryPoint("UA", point),
      ).toBe(false);
    }
  const world = JSON.parse(readFileSync("public/world.json", "utf8"));
  expect(world.quizMap.version).toBe(WORLD_MAP_VERSION);
  expect(world.quizMap.model).toBe("host-defined-game-convention");
});

it("генератор воспроизводим и не меняет прочие страны", () => {
  const before = readFileSync("public/world.json", "utf8");
  execFileSync(process.execPath, ["scripts/build-game-map.mjs", "--check"], {
    stdio: "pipe",
  });
  expect(readFileSync("public/world.json", "utf8")).toBe(before);
});
