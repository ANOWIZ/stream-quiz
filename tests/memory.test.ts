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
it("Запомни кадр: до таймера текст отсутствует в DTO, после — отсутствует медиа", () => {
  const s = initialState();
  s.round = 5;
  const a = joinPlayer(s, "А");
  const b = joinPlayer(s, "Б");
  s.roster = [a.id, b.id];
  s.order = [a.id, b.id];
  const q = demoQuestions().find((q) => q.round === 5 && q.value === 300)!;
  beginQuestion(s, q, 1000);
  const who = {
    id: a.id,
    playerId: a.id,
    role: "player" as const,
    name: a.name,
  };
  const store = { state: s, bank: [], events: [] } as unknown as Store;
  const before = project(store, who, new Set(), 2000);
  expect(before.question).not.toHaveProperty("text");
  expect(before.question).not.toHaveProperty("answer");
  expect(before.question).toHaveProperty("media");
  expect(s.timer.deadline).toBe(16000);
  expect(() => applyCommand(s, who, { type: "buzz" }, [], 2000)).toThrow();
  expire(s, 16000);
  const after = project(store, who, new Set(), 16000);
  expect(after.question?.text).toBe(q.text);
  expect(after.question).not.toHaveProperty("media");
  applyCommand(s, who, { type: "buzz" }, [], 16001);
  applyCommand(
    s,
    { role: "host", id: "h", name: "h" },
    { type: "judge", value: true },
    [],
    16002,
  );
  expect(a.score).toBe(300);
  expect(project(store, who, new Set()).question).toHaveProperty("media");
});
