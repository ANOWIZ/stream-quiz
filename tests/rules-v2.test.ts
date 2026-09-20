import { expect, it } from "vitest";
import { comparisonResult } from "../shared/comparison.js";
import { questionSchema } from "../shared/content.js";
import { upgradeConfig } from "../shared/config.js";
import { activeId, expire } from "../server/game.js";
import { project } from "../server/projection.js";
import type { Store } from "../server/store.js";
import { v2Fixture, hostV2 } from "./v2-fixture.js";

it.each([
  [40, 35, "percent", "equal", true],
  [40, 34, "percent", "higher", false],
  [194, 185, "number", "equal", true],
  [194, 203, "number", "equal", true],
  [194, 184, "number", "higher", false],
  [194, 204, "number", "lower", false],
  [-194, -203.7, "number", "equal", true],
  [0, 0, "number", "equal", true],
  [0, 1, "number", "lower", false],
])("допуск A=%s, G=%s, шкала=%s", (answer, guess, kind, choice, correct) => {
  const q = questionSchema.parse({
    id: "number",
    round: 1,
    category: "Числа",
    text: "Вопрос",
    explanation: "Пояснение",
    source: "Автор",
    answer,
    min: -300,
    max: 300,
    unit: "",
    numericKind: kind,
  });
  if (q.round !== 1) throw Error("fixture");
  expect(comparisonResult(q, Number(guess), upgradeConfig())).toMatchObject({
    choice,
    correct,
  });
});

it.each([2, 6])(
  "полная новая партия с %s игроками: 51 задание и непрерывная очередь",
  (count) => {
    const { state: s, questions, send, time } = v2Fixture(count);
    send("start");
    let completed = 0;
    while (s.phase !== "finished" && completed < 52) {
      if (s.phase === "intro") send("begin");
      if (s.phase === "choosing") {
        expect(activeId(s)).toBe(s.order[completed % count]);
        const q = questions.find(
          (q) => q.round === s.round && !s.used.includes(q.id),
        )!;
        send("choose", s.publicIds[q.id], activeId(s)!);
        expect(s.timer.deadline === null).toBe(s.round !== 5);
        if (q.round === 1) {
          send("pointPreview", q.answer, activeId(s)!);
          send("point", q.answer, activeId(s)!);
          for (const id of s.roster.filter((id) => id !== activeId(s))) {
            send("comparePreview", "higher", id);
            send("compare", "equal", id);
          }
        } else if (q.round === 2 || q.round === 3) {
          for (const id of s.roster) {
            send("answerPreview", q.round === 2 ? "before" : "a", id);
            send("answer", q.answer, id);
          }
        } else {
          if (q.round === 5) {
            expect(expire(s, s.timer.deadline! - 1)).toBe(false);
            const deadline = s.timer.deadline!;
            expect(expire(s, deadline)).toBe(true);
            time(deadline + 1);
          }
          send("buzz", undefined, s.roster[0]);
          send("judge", true);
        }
        expect(s.phase).toBe("reveal");
        completed++;
        send("next");
      }
      if (s.phase === "betting") {
        expect(s.timer.deadline).toBeNull();
        for (const id of s.roster) send("bet", 1000, id);
        expect(s.phase).toBe("loadingPanorama");
        expect(s.timer.deadline).toBeNull();
        send("panoramaReady");
        for (const id of s.roster) send("panoramaReady", undefined, id);
        expect(s.phase).toBe("locating");
        for (const id of s.roster) {
          send(
            "country",
            { code: "ZA", point: { latitude: -30, longitude: 25 } },
            id,
          );
          send("confirmCountry", undefined, id);
        }
        expect(s.phase).toBe("awaitingReveal");
        send("reveal");
      }
    }
    expect(s.phase).toBe("finished");
    expect(s.used).toHaveLength(51);
    expect(s.players[0].score).toBe(66000);
    expect(s.players.slice(1).every((p) => p.score === 46000)).toBe(true);
  },
);

it("без скрытых таймеров, публичное предварительное число и секретные кнопки", () => {
  const { state: s, questions, send } = v2Fixture();
  send("start");
  send("begin");
  send("choose", questions[0].id);
  const [a, b] = s.roster;
  expect(expire(s, 9999999999)).toBe(false);
  send("pointPreview", 15, a);
  const store = {
    state: s,
    bank: questions,
    events: [],
    packages: [],
  } as unknown as Store;
  expect(project(store, hostV2, new Set()).answers[a].value).toBe(15);
  send("point", 15, a);
  send("comparePreview", "higher", b);
  expect(project(store, hostV2, new Set()).answers[b]).toBeUndefined();
  expect(
    project(store, { ...hostV2, role: "player", playerId: a }, new Set())
      .answers[b],
  ).toBeUndefined();
  expect(project(store, hostV2, new Set()).question?.answer).toBeUndefined();
  expect(() => send("compare", "higher", a)).toThrow();
  expect(() => send("point", 20, a)).toThrow();
});

it("ожидание числа приостанавливается и передаётся следующему участнику", () => {
  const { state: s, questions, send } = v2Fixture();
  send("start");
  send("begin");
  send("choose", questions[0].id);
  const old = activeId(s);
  send("endWaiting");
  expect(s.paused).toBe(true);
  send("passPoint");
  expect(s.paused).toBe(false);
  expect(activeId(s)).not.toBe(old);
  expect(s.phase).toBe("point");
  expect(s.players.every((p) => p.score === 0)).toBe(true);
});

it("фрагмент: штраф 500, блокировка, один победитель нажатия и точная отмена решения", () => {
  const { state: s, questions, send } = v2Fixture();
  send("start");
  s.round = 4;
  s.boardIds = questions.filter((q) => q.round === 4).map((q) => q.id);
  s.phase = "choosing";
  send("choose", s.boardIds[0]);
  const [a, b] = s.roster;
  send("buzz", undefined, a);
  send("buzz", undefined, b);
  expect(s.buzzWinner).toBe(a);
  send("judge", false);
  expect(s.players[0].score).toBe(-500);
  expect(() => send("buzz", undefined, a)).toThrow();
  send("buzz", undefined, b);
  expect(s.buzzWinner).toBe(b);
  send("score", { playerId: a, amount: 100, reason: "Ручная поправка" });
  send("undoDecision");
  expect(s.players[0].score).toBe(100);
  expect(s.phase).toBe("judging");
  send("judge", true);
  expect(s.players[0].score).toBe(1100);
  expect(s.phase).toBe("reveal");
  expect(() => send("judge", true)).toThrow();
});

it("финал: тайные ставки, барьер загрузки и 60 секунд; оценка только страны", () => {
  const { state: s, send, time, questions } = v2Fixture(6);
  send("start");
  for (let r = 1; r < 6; r++) send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
  send("begin");
  s.players.forEach((p, i) => {
    p.score = i === 1 ? 0 : i === 2 ? -500 : 10000;
  });
  expect(() => send("bet", 1, s.roster[1])).toThrow();
  expect(() => send("bet", -1, s.roster[0])).toThrow();
  expect(() => send("bet", 1.5, s.roster[0])).toThrow();
  expect(() => send("bet", 10001, s.roster[0])).toThrow();
  send("bet", 10000, s.roster[0]);
  expect(() => send("bet", 1, s.roster[0])).toThrow();
  const store = {
    state: s,
    bank: questions,
    packages: [],
    events: [],
  } as unknown as Store;
  const before = project(store, hostV2, new Set());
  expect(before.bets).toEqual({});
  expect(before.question?.panorama).toBeUndefined();
  expect(before.question?.location).toBeUndefined();
  for (const id of s.roster.slice(1)) send("bet", 0, id);
  expect(s.phase).toBe("loadingPanorama");
  expect(expire(s, 999999)).toBe(false);
  send("panoramaReady");
  for (const id of s.roster.slice(0, -1)) send("panoramaReady", undefined, id);
  expect(s.timer.deadline).toBeNull();
  time(10000);
  send("panoramaReady", undefined, s.roster.at(-1)!);
  expect(s.timer.deadline).toBe(70000);
  send(
    "country",
    { code: "ZA", point: { latitude: -33.92, longitude: 18.42 } },
    s.roster[0],
  );
  send(
    "country",
    { code: "LS", point: { latitude: -29.5, longitude: 28 } },
    s.roster[3],
  );
  expect(() =>
    send(
      "country",
      { code: "ZA", point: { latitude: 0, longitude: 0 } },
      s.roster[4],
    ),
  ).toThrow();
  expect(project(store, hostV2, new Set()).countries).toEqual({});
  expect(expire(s, 69999)).toBe(false);
  expect(expire(s, 70000)).toBe(true);
  expect(s.phase).toBe("awaitingReveal");
  expect(project(store, hostV2, new Set()).countries).toEqual({});
  send("reveal");
  expect(s.phase).toBe("finished");
  expect(s.players[0].score).toBe(20000);
  expect(s.players[1].score).toBe(0);
  expect(s.players[2].score).toBe(-500);
  expect(s.countries[s.roster[0]].locked).toBe(true);
  expect(s.countries[s.roster[4]].code).toBeNull();
  expect(project(store, hostV2, new Set()).question?.location).toEqual({
    latitude: -28.508926,
    longitude: 28.5664,
  });
});
it("ошибка загрузки и пауза не расходуют и не продлевают остаток финального таймера", () => {
  const { state: s, send, time } = v2Fixture();
  send("start");
  for (let r = 1; r < 6; r++) send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
  send("begin");
  expect(() => send("beginLocation")).toThrow();
  send("beginLocation", "ЗАВЕРШИТЬ СТАВКИ");
  expect(Object.values(s.bets)).toEqual([0, 0]);
  send("panoramaReady");
  for (const id of s.roster) send("panoramaReady", undefined, id);
  const deadline = s.timer.deadline!;
  time(deadline - 20000);
  send("pause");
  expect(s.timer.remaining).toBe(20000);
  send("panoramaError", "Не загружено", s.roster[0]);
  expect(s.timer.remaining).toBe(20000);
  expect(s.phase).toBe("loadingPanorama");
  send("resume");
  expect(s.timer.deadline).toBeNull();
  expect(s.timer.remaining).toBe(20000);
  send("pause");
  send("resume");
  expect(s.timer.remaining).toBe(20000);
  time(90000);
  send("panoramaReady", undefined, s.roster[0]);
  expect(s.timer.deadline).toBe(110000);
});
it("второй раунд скрывает обе даты; память открывает вопрос ровно после 30 секунд", () => {
  const { state: s, send, questions } = v2Fixture();
  send("start");
  send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
  send("begin");
  send("choose", questions.find((q) => q.round === 2)!.id);
  const store = {
    state: s,
    bank: questions,
    events: [],
    packages: [],
  } as unknown as Store;
  expect(project(store, hostV2, new Set()).question).not.toHaveProperty(
    "anchorDate",
  );
  expect(project(store, hostV2, new Set()).question).not.toHaveProperty(
    "targetDate",
  );
  for (let r = 2; r < 5; r++) send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
  send("begin");
  send("choose", questions.find((q) => q.round === 5)!.id);
  const deadline = s.timer.deadline!;
  const study = project(store, hostV2, new Set());
  expect(study.question?.text).toBeUndefined();
  expect(study.question?.media).toBeTruthy();
  expect(study.board.map((q) => q.category)).toEqual([
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
  ]);
  expect(expire(s, deadline - 1)).toBe(false);
  expect(expire(s, deadline)).toBe(true);
  expect(project(store, hostV2, new Set()).question?.media).toBeUndefined();
  send("buzz", undefined, s.roster[0]);
  send("judge", false);
  expect(s.players[0].score).toBe(-1000);
  expect(project(store, hostV2, new Set()).question?.media).toBeUndefined();
  send("endWaiting", "ЗАВЕРШИТЬ ОЖИДАНИЕ");
  expect(project(store, hostV2, new Set()).question?.media).toBeTruthy();
});

it("финальная категория не передаётся игроку и экрану трансляции до ставок", () => {
  const { state: s, send, questions } = v2Fixture();
  const final = s.finalSelection!;
  final.category = "СЕКРЕТНАЯ СТРАНА И МЕСТО";
  send("start");
  for (let i = 1; i < 6; i++) send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
  const store = {
    state: s,
    bank: questions,
    events: [],
    packages: [],
  } as unknown as Store;
  for (const phase of ["intro", "betting"] as const) {
    s.phase = phase;
    const view = project(
      store,
      { id: "test", name: "Игрок", role: "player", playerId: s.roster[0] },
      new Set(),
    );
    expect(view.board).toEqual([]);
    expect(JSON.stringify(view)).not.toContain("СЕКРЕТНАЯ СТРАНА");
  }
});

it("панорама выбирается независимо от пакета до финала, включая паузу", () => {
  const { state: s, questions, send } = v2Fixture();
  const initialFinal = s.finalSelection!;
  s.finalSelection = null;
  const italy = {
    ...initialFinal,
    id: "venice",
    answer: "IT",
    place: "Венеция",
    location: { latitude: 45.4305, longitude: 12.357 },
  };
  const brazil = {
    ...initialFinal,
    id: "rio",
    answer: "BR",
    place: "Рио",
    location: { latitude: -22.9519, longitude: -43.2105 },
  };
  questions.push(italy, brazil);
  send("start");
  expect(s.finalSelection).toBeNull();
  send("begin");
  send("choose", s.publicIds[questions[0].id]);
  send("pause");
  const before = structuredClone(s);
  expect(() => send("selectFinal", italy.id, s.players[0].id)).toThrow();
  send("selectFinal", italy.id);
  send("selectFinal", brazil.id);
  expect(s.finalSelection).toEqual(brazil);
  expect(s.packageSnapshot).toEqual(before.packageSnapshot);
  expect(s.boardIds).toEqual(before.boardIds);
  expect(s.question).toEqual(before.question);
  expect(s.players).toEqual(before.players);
  expect(s.timer).toEqual(before.timer);
  expect(s.paused).toBe(true);
  for (let round = 1; round < 6; round++) send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
  s.finalSelection = null;
  expect(() => send("begin")).toThrow("выберите панораму вручную");
  send("selectFinal", italy.id);
  send("begin");
  expect(s.question?.id).toBe(italy.id);
  expect(s.packageSnapshot!.questions.filter((q) => q.round !== 6)).toEqual(
    before.packageSnapshot!.questions.filter((q) => q.round !== 6),
  );
  expect(
    s.packageSnapshot!.questions.filter((q) => q.round === 6).map((q) => q.id),
  ).toEqual([italy.id]);
  expect(s.roundCheckpoint?.boardIds).toEqual([italy.id]);
  expect(() => send("selectFinal", brazil.id)).toThrow("Финал уже начался");
  send("cancelFinal", "ОТМЕНИТЬ ФИНАЛ");
  send("selectFinal", brazil.id);
  send("begin");
  expect(s.question?.id).toBe(brazil.id);
  expect(questions).toContainEqual(italy);
  expect(questions).toContainEqual(brazil);
});
