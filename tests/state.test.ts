import { expect, it } from "vitest";
import {
  initialState,
  joinPlayer,
  applyCommand,
  expire,
} from "../server/game.js";
import { demoQuestions } from "../server/content.js";
export const host = { role: "host" as const, id: "host", name: "Ведущий" };
export function setup() {
  const s = initialState();
  for (const name of ["Аня", "Борис"]) {
    const p = joinPlayer(s, name);
    p.ready = true;
  }
  const bank = demoQuestions();
  applyCommand(s, host, { type: "start" }, bank, 0);
  return { s, bank };
}
it("запускает раунд и восстанавливает таймер после паузы", () => {
  const { s, bank } = setup();
  expect(s.phase).toBe("intro");
  applyCommand(s, host, { type: "begin" }, bank, 0);
  applyCommand(
    s,
    host,
    { type: "choose", value: bank[0].category },
    bank,
    1000,
  );
  expect(s.phase).toBe("point");
  applyCommand(s, host, { type: "pause" }, bank, 11000);
  expect(s.timer.remaining).toBe(35000);
  expect(expire(s, 999999)).toBe(false);
  applyCommand(s, host, { type: "resume" }, bank, 20000);
  expect(s.timer.deadline).toBe(55000);
});
it("запрещает переход через нераскрытый вопрос и двойной старт", () => {
  const { s, bank } = setup();
  expect(() => applyCommand(s, host, { type: "start" }, bank)).toThrow();
  expect(() => applyCommand(s, host, { type: "next" }, bank)).toThrow();
});
it("Коридор открывает конкретную плитку и сохраняет проверки доступа и очередь", () => {
  const { s, bank } = setup();
  applyCommand(s, host, { type: "begin" }, bank, 0);
  const chosen = bank.find((q) => q.round === 1 && q.id !== bank[0].id)!;
  const active = s.players.find((p) => p.id === s.order[0])!;
  const other = s.players.find((p) => p.id !== active.id)!;
  const who = (p: typeof active) => ({
    id: p.id,
    playerId: p.id,
    name: p.name,
    role: "player" as const,
  });
  expect(() =>
    applyCommand(s, who(other), { type: "choose", value: chosen.id }, bank, 1),
  ).toThrow();
  const unavailable = { ...chosen, id: "disabled-tile", active: false };
  expect(() =>
    applyCommand(
      s,
      host,
      { type: "choose", value: unavailable.id },
      [...bank, unavailable],
      1,
    ),
  ).toThrow();
  expect(() =>
    applyCommand(
      s,
      host,
      { type: "choose", value: bank.find((q) => q.round === 2)!.id },
      bank,
      1,
    ),
  ).toThrow();
  applyCommand(s, who(active), { type: "choose", value: chosen.id }, bank, 1);
  expect(s.question?.id).toBe(chosen.id);
  expect(s.phase).toBe("point");
  applyCommand(s, host, { type: "reveal" }, bank, 2);
  applyCommand(s, host, { type: "next" }, bank, 3);
  expect(s.order[s.turn % s.order.length]).toBe(other.id);
  expect(s.total).toBe(bank.filter((q) => q.active && q.round === 1).length);
  expect(() =>
    applyCommand(s, host, { type: "choose", value: chosen.id }, bank, 4),
  ).toThrow();
});
it("ручная корректировка требует причину", () => {
  const { s, bank } = setup();
  expect(() =>
    applyCommand(
      s,
      host,
      {
        type: "score",
        value: { playerId: s.players[0].id, amount: 5, reason: "" },
      },
      bank,
    ),
  ).toThrow();
  applyCommand(
    s,
    host,
    {
      type: "score",
      value: {
        playerId: s.players[0].id,
        amount: 100,
        reason: "Решение ведущего",
      },
    },
    bank,
  );
  expect(s.players[0].score).toBe(100);
});
