import { expect, it } from "vitest";
import {
  initialState,
  joinPlayer,
  beginQuestion,
  applyCommand,
} from "../server/game.js";
import { demoQuestions } from "../server/content.js";
import { scoreNumeric } from "../server/round1.js";
import { comparisonResult } from "../shared/comparison.js";
import { questionSchema } from "../shared/content.js";
import { defaultConfig } from "../shared/config.js";
import { project } from "../server/projection.js";
import type { Store } from "../server/store.js";

it.each([189, 190, 194, 198, 199])(
  "собственный диапазон 190–198: число %s",
  (value) => {
    const s = initialState();
    const p = joinPlayer(s, "Игрок");
    s.roster = s.order = [p.id];
    const q = questionSchema.parse({
      ...demoQuestions()[0],
      min: 0,
      max: 300,
      answer: 194,
      acceptedMin: 190,
      acceptedMax: 198,
    });
    if (q.round !== 1) throw Error();
    beginQuestion(s, q, 0);
    s.answers[p.id] = { value, locked: true };
    scoreNumeric(s);
    const correct = value >= 190 && value <= 198;
    expect(p.score).toBe(correct ? 300 : 0);
    expect(comparisonResult(q, value, s.config).correct).toBe(correct);
    expect(comparisonResult(q, value, s.config).choice).toBe(
      correct ? "equal" : value < 190 ? "higher" : "lower",
    );
    const store = { state: s, bank: [], events: [] } as unknown as Store;
    const who = {
      role: "player" as const,
      id: p.id,
      playerId: p.id,
      name: p.name,
    };
    const secret = project(store, who, new Set());
    expect(secret.question?.acceptedMin).toBeUndefined();
    expect(secret.question?.acceptedMax).toBeUndefined();
    expect(secret.answerResults).toBeUndefined();
    s.phase = "reveal";
    const shown = project(store, who, new Set());
    expect(shown.question?.acceptedMin).toBe(190);
    expect(shown.answerResults?.[p.id]).toBe(correct ? "correct" : "wrong");
  },
);
it("7 вместо 108 не получает очков и явно отмечен неверным", () => {
  const s = initialState();
  const p = joinPlayer(s, "Игрок");
  s.roster = s.order = [p.id];
  const q = questionSchema.parse({
    ...demoQuestions()[0],
    min: 0,
    max: 500,
    answer: 108,
  });
  if (q.round !== 1) throw Error();
  beginQuestion(s, q, 0);
  applyCommand(
    s,
    { role: "player", id: p.id, playerId: p.id, name: p.name },
    { type: "point", value: 7 },
    [],
    1,
  );
  expect(p.score).toBe(0);
  expect(
    project(
      { state: s, bank: [], events: [] } as unknown as Store,
      { role: "host", id: "h", name: "Ведущий" },
      new Set(),
    ).answerResults?.[p.id],
  ).toBe("wrong");
  expect(comparisonResult(q, 7, s.config).correct).toBe(false);
});
it("проверяет неполные и неверные диапазоны; допускает точный ноль и асимметрию", () => {
  const q = { ...demoQuestions()[0], min: -100, max: 300, answer: 194 };
  for (const range of [
    { acceptedMin: 190 },
    { acceptedMax: 198 },
    { acceptedMin: 195, acceptedMax: 198 },
    { acceptedMin: 190, acceptedMax: 301 },
    { acceptedMin: -101, acceptedMax: 198 },
    { acceptedMin: NaN, acceptedMax: 198 },
  ])
    expect(questionSchema.safeParse({ ...q, ...range }).success).toBe(false);
  const zero = questionSchema.parse({
    ...q,
    answer: 0,
    acceptedMin: 0,
    acceptedMax: 0,
  });
  if (zero.round !== 1) throw Error();
  expect(comparisonResult(zero, 0, defaultConfig).correct).toBe(true);
  expect(comparisonResult(zero, -1, defaultConfig).correct).toBe(false);
  const asymmetric = { ...zero, answer: -5, acceptedMin: -10, acceptedMax: -4 };
  expect(comparisonResult(asymmetric, -10, defaultConfig).correct).toBe(true);
  expect(comparisonResult(asymmetric, -3, defaultConfig).correct).toBe(false);
});
it.each([
  [5, 300],
  [10, 200],
  [20, 100],
  [21, 0],
])("отклонение %s%% даёт %s", (diff, points) => {
  const s = initialState();
  const p = joinPlayer(s, "Игрок");
  s.roster = [p.id];
  s.order = [p.id];
  const q = demoQuestions()[0];
  if (q.round !== 1) throw Error();
  q.min = 0;
  q.max = 100;
  q.answer = 50;
  beginQuestion(s, q, 0);
  s.answers[p.id] = { value: 50 + diff, locked: true };
  scoreNumeric(s);
  expect(p.score).toBe(points);
});
it("диапазон включает границу; повторные ответы запрещены", () => {
  const s = initialState();
  const a = joinPlayer(s, "А");
  const b = joinPlayer(s, "Б");
  s.roster = [a.id, b.id];
  s.order = [a.id, b.id];
  const q = demoQuestions()[0];
  if (q.round !== 1) throw Error();
  q.min = 0;
  q.max = 100;
  q.answer = 50;
  beginQuestion(s, q, 0);
  applyCommand(
    s,
    { role: "player", name: a.name, id: a.id, playerId: a.id },
    { type: "point", value: 50 },
    [],
    1,
  );
  expect(() =>
    applyCommand(
      s,
      { role: "player", name: a.name, id: a.id, playerId: a.id },
      { type: "point", value: 40 },
      [],
      2,
    ),
  ).toThrow();
  applyCommand(
    s,
    { role: "player", name: b.name, id: b.id, playerId: b.id },
    { type: "range", value: { start: 40, width: "narrow", locked: true } },
    [],
    3,
  );
  expect(s.phase).toBe("reveal");
  expect(b.score).toBe(200);
  expect(a.score).toBe(300);
});
