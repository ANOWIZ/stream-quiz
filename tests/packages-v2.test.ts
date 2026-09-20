import { questionSchema } from "../shared/content.js";
import { expect, it } from "vitest";
import { demoQuestions } from "../server/content.js";
import {
  draftSchema,
  packageIssues,
  questionIssues,
} from "../shared/packages.js";
import { validCountryPoint, validPanoramaPoint } from "../server/geography.js";
import { upgradeConfig } from "../shared/config.js";
it("незавершённая карточка является черновиком; размер пакета свободный", () => {
  expect(
    draftSchema.parse({
      id: "draft-no-image",
      round: 4,
      text: "Ещё без изображения",
    }).text,
  ).toBe("Ещё без изображения");
  expect(packageIssues({ questions: [] })).toEqual([]);
  const q = demoQuestions().find((q) => q.round === 4)!;
  expect(questionIssues(q)).toContain(
    "нужны исходное изображение и отдельный подготовленный фрагмент",
  );
});
it("готовая пара из документа сохраняет отдельный фрагмент и полный ответ без повторной обрезки", () => {
  const q = questionSchema.parse({
    ...demoQuestions().find((q) => q.round === 4),
    suppliedFragment: true,
    fullImageFileId: "original-file",
    media: { kind: "image", fileId: "fragment-file" },
  });
  expect(questionIssues(q)).toEqual([]);
  expect(
    questionIssues({ ...q, media: { ...q.media!, fileId: "original-file" } }),
  ).not.toEqual([]);
  if (q.round !== 4) throw Error("fixture");
  expect(questionIssues({ ...q, fullImageFileId: undefined })).not.toEqual([]);
  expect(questionIssues({ ...q, suppliedFragment: false })).not.toEqual([]);
});
it("координаты финального пина проверяются по локальным границам", () => {
  expect(
    validCountryPoint("ZA", { latitude: -28.508926, longitude: 28.5664 }),
  ).toBe(true);
  expect(
    validCountryPoint("DE", { latitude: -28.508926, longitude: 28.5664 }),
  ).toBe(false);
  expect(validCountryPoint("FR", { latitude: 0, longitude: 0 })).toBe(false);
});
it("новые правила задают актуальные названия, очки и финал", () => {
  const config = upgradeConfig();
  expect(config.rulesVersion).toBe(2);
  expect(config.roundNames[1]).toBe("Больше-меньше");
  expect(config.choicePoints).toEqual({ beforeAfter: 1500, twoWorlds: 2000 });
  expect(config.final).toEqual({ betLimit: 1, seconds: 60 });
});

it("координаты венецианского острова допускают упрощённую береговую линию, ответы игроков остаются строгими", () => {
  const venice = { latitude: 45.4305, longitude: 12.357 };
  expect(validPanoramaPoint("IT", venice)).toBe(true);
  expect(validCountryPoint("IT", venice)).toBe(false);
  expect(validPanoramaPoint("BR", venice)).toBe(false);
  expect(
    validPanoramaPoint("IT", { latitude: 48.8566, longitude: 2.3522 }),
  ).toBe(false);
  expect(validPanoramaPoint("IT", { latitude: 0, longitude: 0 })).toBe(false);
});

it("целая отметка требует доступного целого числа; проценты всегда 0–100", () => {
  const q = demoQuestions().find((q) => q.round === 1)!;
  expect(
    questionSchema.safeParse({ ...q, min: 0.1, max: 0.9, answer: 0.5 }).success,
  ).toBe(false);
  expect(
    questionIssues({
      ...q,
      round: 1,
      min: 0,
      max: 200,
      answer: 100,
      unit: "%",
    }),
  ).toContain("процентная шкала должна быть 0–100 %");
});
