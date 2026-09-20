import { expect, it } from "vitest";
import {
  initialState,
  joinPlayer,
  beginQuestion,
  applyCommand,
  expire,
} from "../server/game.js";
import { demoQuestions } from "../server/content.js";
it("Два мира: все ответили — автоматическое раскрытие и 200 очков", () => {
  const s = initialState();
  s.round = 3;
  const a = joinPlayer(s, "А");
  const b = joinPlayer(s, "Б");
  s.roster = [a.id, b.id];
  s.order = [a.id, b.id];
  const q = demoQuestions().find((q) => q.round === 3)!;
  beginQuestion(s, q, 0);
  for (const p of [a, b])
    applyCommand(
      s,
      { role: "player", id: p.id, playerId: p.id, name: p.name },
      { type: "answer", value: q.answer },
      [],
      1,
    );
  expect(s.phase).toBe("reveal");
  expect(a.score).toBe(200);
  expect(b.score).toBe(200);
});
it("Два мира: таймер раскрывает результат без ответа отключившегося", () => {
  const s = initialState();
  s.round = 3;
  const q = demoQuestions().find((q) => q.round === 3)!;
  beginQuestion(s, q, 0);
  expect(expire(s, 35000)).toBe(true);
  expect(s.phase).toBe("reveal");
});
