import { expect, it } from "vitest";
import {
  initialState,
  joinPlayer,
  beginQuestion,
  applyCommand,
} from "../server/game.js";
import { demoQuestions } from "../server/content.js";
it("первый серверный buzzer выигрывает, второй фиксируется с миллисекундами", () => {
  const s = initialState();
  s.round = 4;
  const a = joinPlayer(s, "А");
  const b = joinPlayer(s, "Б");
  s.roster = [a.id, b.id];
  s.order = [a.id, b.id];
  const q = demoQuestions().find((q) => q.round === 4)!;
  beginQuestion(s, q, 0);
  for (const [i, p] of [a, b].entries())
    applyCommand(
      s,
      { id: p.id, playerId: p.id, role: "player", name: p.name },
      { type: "buzz" },
      [],
      1000 + i,
    );
  expect(s.buzzWinner).toBe(a.id);
  expect(s.buzzes.map((b) => [b.at, b.accepted])).toEqual([
    [1000, true],
    [1001, false],
  ]);
  applyCommand(
    s,
    { id: "h", role: "host", name: "h" },
    { type: "judge", value: false },
    [],
    2000,
  );
  expect(a.score).toBe(-q.value);
  expect(s.phase).toBe("buzzing");
  expect(() =>
    applyCommand(
      s,
      { id: a.id, playerId: a.id, role: "player", name: a.name },
      { type: "buzz" },
      [],
      2100,
    ),
  ).toThrow();
  applyCommand(
    s,
    { id: b.id, playerId: b.id, role: "player", name: b.name },
    { type: "buzz" },
    [],
    2200,
  );
  applyCommand(
    s,
    { id: "h", role: "host", name: "h" },
    { type: "judge", value: true },
    [],
    2300,
  );
  expect(b.score).toBe(q.value);
  expect(s.phase).toBe("reveal");
});
