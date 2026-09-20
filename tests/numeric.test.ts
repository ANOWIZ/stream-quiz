import { expect, it } from "vitest";
import {
  initialState,
  joinPlayer,
  beginQuestion,
  applyCommand,
} from "../server/game.js";
import { demoQuestions } from "../server/content.js";
import { scoreNumeric } from "../server/round1.js";
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
