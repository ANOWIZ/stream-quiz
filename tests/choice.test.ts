import { expect, it } from "vitest";
import {
  initialState,
  joinPlayer,
  beginQuestion,
  applyCommand,
  expire,
} from "../server/game.js";
import { demoQuestions } from "../server/content.js";
import { project } from "../server/projection.js";
import type { Store } from "../server/store.js";
it("раунд 2: скрывает чужой ответ до раскрытия, начисляет 200 и не начисляет дважды", () => {
  const s = initialState();
  s.round = 2;
  const a = joinPlayer(s, "А");
  const b = joinPlayer(s, "Б");
  s.roster = [a.id, b.id];
  s.order = [a.id, b.id];
  const q = demoQuestions().find((q) => q.round === 2)!;
  beginQuestion(s, q, 0);
  applyCommand(
    s,
    { role: "player", id: a.id, playerId: a.id, name: a.name },
    { type: "answer", value: q.answer },
    [],
    1,
  );
  const host = { role: "host" as const, id: "h", name: "h" };
  const v = project(
    { state: s, bank: [], events: [] } as unknown as Store,
    host,
    new Set(),
    2,
  );
  expect(v.answers).toEqual({});
  expect(v.players[0].answered).toBe(true);
  expect(v.question).not.toHaveProperty("answer");
  expect(v.question).not.toHaveProperty("targetDate");
  expire(s, 40000);
  expect(s.phase).toBe("awaitingReveal");
  applyCommand(s, host, { type: "reveal" }, [], 40001);
  expect(a.score).toBe(200);
  expect(b.score).toBe(0);
  expect(() => applyCommand(s, host, { type: "reveal" }, [], 40002)).toThrow();
  expect(a.score).toBe(200);
});
