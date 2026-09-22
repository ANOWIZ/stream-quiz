import { expect, it } from "vitest";
import { beginQuestion, expire } from "../server/game.js";
import { v2Fixture } from "./v2-fixture.js";

function finalFixture(version: 1 | 2, openPanorama = true) {
  const fixture = v2Fixture();
  const { state: s, send, questions } = fixture;
  if (version === 1) {
    s.config.rulesVersion = 1;
    s.round = 6;
    s.roster = s.players.map((p) => p.id);
    beginQuestion(
      s,
      questions.find((q) => q.round === 6)!,
      1000,
    );
    if (openPanorama) send("beginLocation");
  } else {
    send("start");
    for (let round = 1; round < 6; round++)
      send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
    send("begin");
    if (openPanorama) {
      send("beginLocation", "ЗАВЕРШИТЬ СТАВКИ");
      send("panoramaReady");
      for (const id of s.roster) send("panoramaReady", undefined, id);
    }
  }
  return fixture;
}

it.each([1, 2] as const)(
  "правила %s: ставки и загрузка на паузе открывают панораму с остановленной минутой",
  (version) => {
    const { state: s, send } = finalFixture(version, false);
    send("pause");
    for (const id of s.roster) send("bet", 0, id);
    if (version === 2) {
      expect(s.phase).toBe("loadingPanorama");
      send("panoramaReady");
      for (const id of s.roster) send("panoramaReady", undefined, id);
    }
    expect(s.phase).toBe("locating");
    expect(s.paused).toBe(true);
    expect(s.timer).toEqual({ deadline: null, remaining: 60000 });
    expect(expire(s, 999999)).toBe(false);
  },
);

it.each([1, 2] as const)(
  "правила %s: нулевой таймер завершает приём после продолжения",
  (version) => {
    const { state: s, send } = finalFixture(version);
    send("pause");
    send("timer", 0);
    expect(s.timer).toEqual({ deadline: null, remaining: 0 });
    expect(expire(s, 999999)).toBe(false);
    send("resume");
    expect(expire(s, s.timer.deadline!)).toBe(true);
    expect(s.phase).toBe("awaitingReveal");
  },
);

it.each([1, 2] as const)(
  "правила %s: 20 → 40 секунд заменяет остаток; пауза сохраняется до продолжения",
  (version) => {
    const { state: s, send, time } = finalFixture(version);
    const oldDeadline = s.timer.deadline!;
    time(oldDeadline - 20000);
    send("timer", 40);
    expect(s.timer).toEqual({ deadline: oldDeadline + 20000, remaining: null });
    expect(expire(s, oldDeadline)).toBe(false);
    time(oldDeadline);
    send("pause");
    expect(s.timer.remaining).toBe(20000);
    send("timer", 40);
    expect(s.paused).toBe(true);
    expect(s.timer).toEqual({ deadline: null, remaining: 40000 });
    expect(expire(s, 999999)).toBe(false);
    time(1000000);
    send("resume");
    expect(s.timer).toEqual({ deadline: 1040000, remaining: null });
    expect(expire(s, 1039999)).toBe(false);
    expect(expire(s, 1040000)).toBe(true);
    expect(s.phase).toBe("awaitingReveal");
    expect(() => send("timer", 40)).toThrow("нет активного таймера");
    expect(s.players.map((p) => p.score)).toEqual([0, 0]);
  },
);

it.each([1, 2] as const)(
  "правила %s: на паузе можно выбрать и подтвердить страну без запуска таймера и раскрытия",
  (version) => {
    const { state: s, send, time } = finalFixture(version);
    const id = s.roster[0];
    const choice = (code: string) =>
      version === 1
        ? code
        : {
            code,
            point:
              code === "ZA"
                ? { latitude: -28.508926, longitude: 28.5664 }
                : { latitude: 55.75, longitude: 37.62 },
          };
    send("country", choice("ZA"), id);
    send("pause");
    const frozen = structuredClone(s.timer);
    send("country", choice("RU"), id);
    send("confirmCountry", undefined, id);
    expect(s.countries[id]).toMatchObject({ code: "RU", locked: true });
    expect(() => send("country", choice("ZA"), id)).toThrow();
    expect(s.timer).toEqual(frozen);
    expect(expire(s, 999999)).toBe(false);
    send("country", choice("ZA"), s.roster[1]);
    send("confirmCountry", undefined, s.roster[1]);
    expect(s.phase).toBe("awaitingReveal");
    expect(s.paused).toBe(true);
    expect(s.players.map((p) => p.score)).toEqual([0, 0]);
    time(100000);
    send("resume");
    expect(s.phase).toBe("awaitingReveal");
    expect(s.timer).toEqual({ deadline: null, remaining: null });
  },
);

it.each([1, 2] as const)(
  "правила %s: изменение таймера проверяет роль, число и фазу",
  (version) => {
    const { state: s, send } = finalFixture(version);
    const before = structuredClone(s);
    expect(() => send("timer", 40, s.roster[0])).toThrow("Только ведущий");
    for (const value of [
      -1,
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER,
      "40",
      null,
    ])
      expect(() => send("timer", value)).toThrow(
        "целое неотрицательное число секунд",
      );
    expect(s).toEqual(before);
    send("timer", 120);
    expect(s.timer.deadline! - 1000).toBeGreaterThanOrEqual(120000);
    send("timer", 90000);
    expect(s.timer.deadline! - 1000).toBeGreaterThanOrEqual(90000000);
    send("timer", 1);
    expect(s.timer.deadline! - 1000).toBeLessThan(2000);
    s.phase = "reveal";
    expect(() => send("timer", 40)).toThrow("нет активного таймера");
  },
);

it("изменённый таймер ждёт загрузки панорамы и продолжения эфира", () => {
  const { state: s, send, time } = finalFixture(2);
  send("panoramaError", "Проверка загрузки", s.roster[0]);
  expect(s.phase).toBe("loadingPanorama");
  send("timer", 40);
  expect(s.timer).toEqual({ deadline: null, remaining: 40000 });
  send("pause");
  send("panoramaReady", undefined, s.roster[0]);
  expect(s.phase).toBe("locating");
  expect(s.timer).toEqual({ deadline: null, remaining: 40000 });
  time(100000);
  send("resume");
  expect(s.phase).toBe("locating");
  expect(s.timer).toEqual({ deadline: 140000, remaining: null });
});

it.each([1, 2] as const)(
  "правила %s: ведущий меняет время изучения кадра",
  (version) => {
    const { state: s, send, questions, time } = v2Fixture();
    if (version === 1) {
      s.config.rulesVersion = 1;
      s.round = 5;
      beginQuestion(
        s,
        questions.find((q) => q.round === 5)!,
        1000,
      );
    } else {
      send("start");
      for (let round = 1; round < 5; round++)
        send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
      send("begin");
      send("choose", questions.find((q) => q.round === 5)!.id);
    }
    expect(s.phase).toBe("studying");
    time(2000);
    send("timer", 40);
    expect(expire(s, 41999)).toBe(false);
    expect(expire(s, 42000)).toBe(true);
    expect(s.phase).toBe("buzzing");
  },
);
