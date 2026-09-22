import { expect, it } from "vitest";
import {
  initialState,
  joinPlayer,
  applyCommand,
  activeId,
  addPoints,
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

it.each([1, 2])(
  "возврат v%s отменяет оба раунда, сохраняет ранние очки и ручные поправки",
  (version) => {
    const f = v2Fixture();
    const s = version === 2 ? f.state : initialState();
    const bank = version === 2 ? f.questions : demoQuestions();
    if (version === 1) joinPlayer(s, "А");
    const send = (type: string, value?: unknown) =>
      applyCommand(s, host, { type, value }, bank, 1000);
    const id = s.players[0].id;
    expect(() => send("previousRound", "ПРЕДЫДУЩИЙ РАУНД")).toThrow();
    send("start");
    expect(() => send("previousRound", "ПРЕДЫДУЩИЙ РАУНД")).toThrow();
    addPoints(s, id, 100);
    send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
    const checkpoint = structuredClone(s.roundCheckpoint);
    const snapshot = structuredClone(s.packageSnapshot);
    addPoints(s, id, 200);
    send("score", { playerId: id, amount: 77, reason: "Ручная поправка" });
    send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
    addPoints(s, id, -50);
    const epoch = s.roundEpoch;
    expect(() => send("previousRound")).toThrow();
    expect(() =>
      applyCommand(
        s,
        { ...host, role: "player", playerId: id },
        { type: "previousRound", value: "ПРЕДЫДУЩИЙ РАУНД" },
        bank,
        1000,
      ),
    ).toThrow();
    send("previousRound", "ПРЕДЫДУЩИЙ РАУНД");
    expect(s).toMatchObject({
      round: 2,
      roundIndex: 1,
      phase: "intro",
      completed: 0,
      roundCheckpoint: checkpoint,
      used: checkpoint!.used,
      boardIds: checkpoint!.boardIds,
    });
    expect(s.players[0].score).toBe(177);
    expect(s.packageSnapshot).toEqual(snapshot);
    expect(s.roundEpoch).not.toBe(epoch);
    expect(Object.keys(s.roundCheckpoints)).toEqual(["1"]);
    addPoints(s, id, 200);
    send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
    addPoints(s, id, -50);
    send("previousRound", "ПРЕДЫДУЩИЙ РАУНД");
    expect(s.players[0].score).toBe(177);
    send("previousRound", "ПРЕДЫДУЩИЙ РАУНД");
    expect(s.players[0].score).toBe(77);
    expect(s.round).toBe(1);
    expect(s.used).toEqual([]);
    expect(s.roundCheckpoints).toEqual({});
  },
);

it("возврат учитывает отмену начислений незавершённого вопроса при переходе вперёд", () => {
  const { state: s, send, questions } = v2Fixture();
  send("start");
  for (let i = 1; i < 4; i++) send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
  send("begin");
  const q = questions.find((q) => q.round === 4)!;
  send("choose", q.id);
  const id = activeId(s)!;
  send("buzz", undefined, id);
  send("judge", false);
  expect(s.players.find((p) => p.id === id)!.score).toBeLessThan(0);
  send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
  expect(s.roundCheckpoints[4].awards[id]).toBe(0);
  send("previousRound", "ПРЕДЫДУЩИЙ РАУНД");
  expect(s.players.every((p) => p.score === 0)).toBe(true);
});

it("возврат из завершённого финала очищает попытку и сохраняет выбранную панораму", () => {
  const { state: s, send } = v2Fixture();
  send("start");
  for (let i = 1; i < 5; i++) send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
  const id = s.players[0].id;
  addPoints(s, id, 1000);
  send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
  const final = structuredClone(s.finalSelection);
  send("begin");
  addPoints(s, id, -1000);
  s.phase = "finished";
  s.bets[id] = 1000;
  s.countries[id] = { code: "RU", locked: true };
  s.panoramaReady[id] = true;
  send("previousRound", "ПРЕДЫДУЩИЙ РАУНД");
  expect(s).toMatchObject({
    round: 5,
    phase: "intro",
    question: null,
    questionPublicId: null,
    scoreBefore: {},
    answers: {},
    bets: {},
    countries: {},
    panoramaReady: {},
    finalAttemptId: null,
    timer: { deadline: null, remaining: null },
  });
  expect(s.players[0].score).toBe(0);
  expect(s.finalSelection).toEqual(final);
});

it("предыдущий раунд следует настроенному порядку старых правил", () => {
  const s = initialState();
  s.config.roundOrder = [3, 1, 2, 4, 5, 6];
  const bank = demoQuestions();
  const send = (type: string, value?: unknown) =>
    applyCommand(s, host, { type, value }, bank, 1000);
  send("start");
  send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
  expect(s.round).toBe(1);
  send("previousRound", "ПРЕДЫДУЩИЙ РАУНД");
  expect(s.round).toBe(3);
  expect(s.roundIndex).toBe(0);
});
