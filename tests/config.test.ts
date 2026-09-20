import { expect, it } from "vitest";
import { defaultConfig, configSchema } from "../shared/config.js";
it("читает старую конфигурацию для совместимости сохранений", () => {
  expect(configSchema.parse(defaultConfig)).toEqual(defaultConfig);
});
it("сохранённое ограничение ставки заменяется всем положительным счётом", () => {
  expect(
    configSchema.parse({
      ...defaultConfig,
      final: { ...defaultConfig.final, betLimit: 0.5 },
    }).final.betLimit,
  ).toBe(1);
});
it("не требует делимости числа вопросов на количество игроков", () => {
  expect(
    configSchema.safeParse({ ...defaultConfig, questionCounts: { 2: 9 } })
      .success,
  ).toBe(true);
});

it("старая конфигурация получает названия; пустые и неполные названия запрещены", () => {
  const legacy = { ...defaultConfig, roundNames: undefined, minPlayers: 2 };
  expect(configSchema.parse(legacy).roundNames).toEqual(
    defaultConfig.roundNames,
  );
  expect(
    configSchema.safeParse({ ...defaultConfig, roundNames: { 1: "Тест" } })
      .success,
  ).toBe(false);
  expect(
    configSchema.safeParse({
      ...defaultConfig,
      roundNames: { ...defaultConfig.roundNames, 1: "  " },
    }).success,
  ).toBe(false);
});

it("стоимости ячеек должны быть целыми, как очки вопросов", () => {
  expect(
    configSchema.safeParse({
      ...defaultConfig,
      boardValues: [100.5, 200.5, 300.5],
    }).success,
  ).toBe(false);
});
