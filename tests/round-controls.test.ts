import { expect, it } from "vitest";
import {
  initialState,
  joinPlayer,
  applyCommand,
  activeId,
} from "../server/game.js";
import { demoQuestions } from "../server/content.js";
import { v2Fixture } from "./v2-fixture.js";
const host = { id: "host", role: "host" as const, name: "Ведущий" };
it.each([1, 2])(
  "перезапуск раунда v%s отменяет только его игровые очки и сохраняет очередь",
  (version) => {
    const fixture = v2Fixture();
    const s = version === 2 ? fixture.state : initialState();
    const bank = version === 2 ? fixture.questions : demoQuestions();
    if (version === 1) {
      joinPlayer(s, "А");
      joinPlayer(s, "Б");
    }
    const send = (type: string, value?: unknown, playerId?: string) =>
      applyCommand(
        s,
        playerId ? { ...host, role: "player", playerId, id: playerId } : host,
        { type, value },
        bank,
        1000,
      );
    send("start");
    const order = [...s.order];
    send("begin");
    const q = bank.find((q) => q.round === 1)!;
    send("choose", version === 2 ? q.id : q.category);
    const a = activeId(s)!;
    const b = s.roster.find((id) => id !== a)!;
    send("pointPreview", 176, a);
    expect(s.answers[a]).toMatchObject({ value: 176, locked: false });
    expect(() => send("point", 176.8, a)).toThrow();
    send("point", Number(q.answer), a);
    if (version === 2) send("compare", "equal", b);
    else send("reveal");
    const firstScore = s.players.find((p) => p.id === a)!.score;
    expect(firstScore).toBeGreaterThan(0);
    send("score", { playerId: a, amount: 77, reason: "Ручная поправка" });
    expect(() => send("restartRound", "НАЧАТЬ РАУНД ЗАНОВО", a)).toThrow();
    expect(() => send("restartRound")).toThrow();
    send("restartRound", "НАЧАТЬ РАУНД ЗАНОВО");
    expect(s.phase).toBe("intro");
    expect(s.completed).toBe(0);
    expect(s.used).toEqual([]);
    expect(s.order).toEqual(order);
    expect(s.players.find((p) => p.id === a)!.score).toBe(77);
    expect(s.answers).toEqual({});
    expect(s.timer.deadline).toBeNull();
    expect(s.roundEpoch).toBeTruthy();
    send("begin");
    send("choose", version === 2 ? q.id : q.category);
    send("point", Number(q.answer), a);
    if (version === 2) send("compare", "equal", b);
    else send("reveal");
    send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
    expect(s.round).toBe(2);
    expect(s.phase).toBe("intro");
    const before = s.players.find((p) => p.id === a)!.score;
    send("begin");
    const q2 = bank.find((q) => q.round === 2)!;
    send("choose", version === 2 ? q2.id : q2.category);
    send("answer", q2.answer, a);
    send("answer", q2.answer, b);
    if (s.phase !== "reveal") send("reveal");
    send("restartRound", "НАЧАТЬ РАУНД ЗАНОВО");
    expect(s.players.find((p) => p.id === a)!.score).toBe(before);
    expect(s.used).toContain(q.id);
  },
);
it("новая очередь продолжается при ручном переходе, финал нельзя перескочить", () => {
  const { state: s, send, questions } = v2Fixture();
  send("start");
  send("begin");
  const a = activeId(s);
  send("choose", questions[0].id);
  send("pause");
  send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
  expect(s.paused).toBe(false);
  expect(activeId(s)).not.toBe(a);
  for (let r = 2; r < 6; r++) send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
  expect(s.round).toBe(6);
  expect(() => send("nextRound", "СЛЕДУЮЩИЙ РАУНД")).toThrow();
});
