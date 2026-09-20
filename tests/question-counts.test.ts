import { expect, it } from "vitest";
import {
  applyCommand,
  initialState,
  syncLegacyRoundBank,
} from "../server/game.js";
import { demoQuestions, validateBank } from "../server/content.js";
import { packageIssues, packageSchema } from "../shared/packages.js";
import { project } from "../server/projection.js";
import type { Store } from "../server/store.js";
import { hostV2, v2Fixture } from "./v2-fixture.js";

it("пакет допускает больше 51 задания, одинаковые категории и пустые раунды", () => {
  const { state } = v2Fixture();
  const original = state.packageSnapshot!;
  const questions = Array.from({ length: 70 }, (_, i) => ({
    ...original.questions[10],
    id: `unlimited-${i}`,
    category: "История",
  }));
  const pack = packageSchema.parse({ ...original, questions });
  expect(packageIssues(pack)).toEqual([]);
  expect(validateBank(questions)).toEqual([]);
  expect(packageIssues({ questions: [...questions, questions[0]] })).toContain(
    "В пакете повторяются задания",
  );
});

it("новая партия проходит 0/2/11/1/0 вопросов до ручного финала, не обрезая одиннадцатый", () => {
  const { state: s, send } = v2Fixture();
  const source = s.packageSnapshot!.questions;
  const sizes = [0, 2, 11, 1, 0];
  s.packageSnapshot!.questions = sizes.flatMap((size, index) =>
    Array.from({ length: size }, (_, n) => ({
      ...source.find((q) => q.round === index + 1)!,
      id: `flex-${index}-${n}`,
      category: "Общая категория",
    })),
  );
  s.finalSelection = null;
  send("start");
  for (const [index, size] of sizes.entries()) {
    expect(s.round).toBe(index + 1);
    expect(s.phase).toBe("intro");
    expect(s.total).toBe(size);
    send("begin");
    for (let n = 0; n < size; n++) {
      expect(s.phase).toBe("choosing");
      const q = s.packageSnapshot!.questions.find(
        (q) => q.round === s.round && !s.used.includes(q.id),
      )!;
      send("choose", q.id);
      send("skip");
      expect(s.phase).toBe("reveal");
      send("next");
    }
  }
  expect(s.round).toBe(6);
  expect(s.total).toBe(1);
  expect(s.used).toHaveLength(14);
  expect(() => send("begin")).toThrow("выберите панораму вручную");
  expect(s.question).toBeNull();
});

it("сохранённая старая партия видит импортированные вопросы и не требует полных категорий", () => {
  const s = initialState();
  const bank = demoQuestions()
    .filter((q) => [2, 4, 5].includes(q.round))
    .slice(0, 3)
    .map((q) => ({ ...q, formatVersion: 2 as const }));
  const send = (type: string, value?: unknown) =>
    applyCommand(s, hostV2, { type, value }, bank);
  send("start");
  expect(s.total).toBe(0);
  send("begin");
  expect(s.round).toBe(2);
  expect(s.total).toBe(3);
  send("begin");
  const store = {
    state: s,
    bank,
    packages: [],
    events: [],
  } as unknown as Store;
  expect(project(store, hostV2, new Set()).warnings).toEqual([]);
  expect(project(store, hostV2, new Set()).board).toHaveLength(3);
  for (const q of [...bank]) {
    send("choose", q.category);
    expect(s.question?.id).toBe(q.id);
    send("reveal");
    send("next");
  }
  expect(s.round).toBe(3);
  send("begin");
  expect(s.round).toBe(4);
  const fragment = demoQuestions().find((q) => q.round === 4)!;
  bank.push({ ...fragment, formatVersion: 2 });
  syncLegacyRoundBank(s, bank);
  expect(s.total).toBe(1);
  send("begin");
  send("choose", fragment.id);
  send("reveal");
  send("next");
  expect(s.round).toBe(5);
  send("begin");
  expect(s.round).toBe(6);
});

it("изменение живого банка пересчитывает остаток, сохраняя очки и текущий вопрос", () => {
  const s = initialState();
  const bank = demoQuestions();
  applyCommand(s, hostV2, { type: "start" }, bank);
  applyCommand(s, hostV2, { type: "begin" }, bank);
  applyCommand(s, hostV2, { type: "choose", value: bank[0].id }, bank);
  const question = structuredClone(s.question);
  const remaining = bank.filter((q) => q.id === question!.id);
  syncLegacyRoundBank(s, remaining);
  expect(s.total).toBe(1);
  expect(s.question).toEqual(question);
  applyCommand(s, hostV2, { type: "reveal" }, remaining);
  applyCommand(s, hostV2, { type: "next" }, remaining);
  expect(s.round).toBe(2);
  expect(s.total).toBe(0);
});
