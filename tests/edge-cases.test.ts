import { expect, it } from "vitest";
import {
  initialState,
  joinPlayer,
  beginQuestion,
  applyCommand,
  expire,
} from "../server/game.js";
import { demoQuestions, validateBank } from "../server/content.js";
import { questionSchema, importSchema } from "../shared/content.js";
import { youtubeId } from "../shared/media.js";
const host = { id: "h", role: "host" as const, name: "Ведущий" };
it("все неверные голосовые ответы закрывают вопрос; следующий выбор идёт по очереди", () => {
  const s = initialState();
  const a = joinPlayer(s, "А");
  const b = joinPlayer(s, "Б");
  s.round = 4;
  s.roster = [a.id, b.id];
  s.order = [a.id, b.id];
  s.total = 15;
  beginQuestion(
    s,
    demoQuestions().find((q) => q.round === 4)!,
    0,
  );
  for (const p of [a, b]) {
    applyCommand(
      s,
      { id: p.id, playerId: p.id, role: "player", name: p.name },
      { type: "buzz" },
      [],
      10,
    );
    applyCommand(s, host, { type: "judge", value: false }, [], 11);
  }
  expect(s.phase).toBe("reveal");
  expect(a.score).toBe(-100);
  expect(b.score).toBe(-100);
  applyCommand(s, host, { type: "next" }, demoQuestions(), 12);
  expect(s.order[s.turn]).toBe(b.id);
});
it("пропуск отменяет штрафы, а пропуск финала завершает партию", () => {
  const s = initialState();
  const p = joinPlayer(s, "А");
  s.roster = [p.id];
  s.order = [p.id];
  s.round = 4;
  beginQuestion(
    s,
    demoQuestions().find((q) => q.round === 4)!,
    0,
  );
  applyCommand(
    s,
    { id: p.id, playerId: p.id, role: "player", name: p.name },
    { type: "buzz" },
    [],
    1,
  );
  s.roster.push("offline");
  applyCommand(s, host, { type: "judge", value: false }, [], 2);
  expect(p.score).toBe(-100);
  applyCommand(s, host, { type: "skip" }, [], 3);
  expect(p.score).toBe(0);
  s.round = 6;
  beginQuestion(
    s,
    demoQuestions().find((q) => q.round === 6)!,
    4,
  );
  applyCommand(s, host, { type: "beginLocation" }, [], 5);
  applyCommand(s, host, { type: "skip" }, [], 6);
  expect(s.phase).toBe("finished");
  expect(p.score).toBe(0);
});
it("ставка при отрицательном счёте только нулевая; отсутствие страны теряет ставку", () => {
  const s = initialState();
  const a = joinPlayer(s, "А");
  const b = joinPlayer(s, "Б");
  s.round = 6;
  a.score = -50;
  b.score = 100;
  s.roster = [a.id, b.id];
  s.order = [a.id, b.id];
  beginQuestion(
    s,
    demoQuestions().find((q) => q.round === 6)!,
    0,
  );
  const who = (id: string) => ({
    id,
    playerId: id,
    role: "player" as const,
    name: id,
  });
  expect(() =>
    applyCommand(s, who(a.id), { type: "bet", value: 1 }, [], 1),
  ).toThrow();
  applyCommand(s, who(a.id), { type: "bet", value: 0 }, [], 1);
  applyCommand(s, who(b.id), { type: "bet", value: 50 }, [], 2);
  expect(() =>
    applyCommand(s, host, { type: "timer", value: 120 }, [], 10000),
  ).toThrow("сократить");
  expire(s, 120003);
  applyCommand(s, host, { type: "reveal" }, [], 120004);
  expect(a.score).toBe(-50);
  expect(b.score).toBe(50);
  expect(s.countries[b.id].code).toBeNull();
});
it("пауза/продолжение видео сохраняют позицию; конец фрагмента вычисляется сервером", () => {
  const s = initialState();
  const q = demoQuestions().find((q) => q.round === 4)!;
  q.media = {
    kind: "video",
    url: "https://example.com/movie.mp4",
    start: 1,
    end: 4,
    muted: true,
    autoplay: true,
    alt: "Видео",
  };
  s.round = 4;
  beginQuestion(s, q, 0);
  applyCommand(s, host, { type: "pause" }, [], 1000);
  expect(s.video.offset).toBe(2);
  expect(s.video.status).toBe("paused");
  applyCommand(s, host, { type: "resume" }, [], 5000);
  expect(s.video.status).toBe("playing");
  expire(s, 7000);
  expect(s.video.status).toBe("paused");
  expect(s.video.offset).toBe(4);
});
it("валидатор проверяет файлы, ID, ответы и шкалы без требований к количеству", () => {
  const bank = demoQuestions();
  expect(
    validateBank(bank, undefined, 6, new Set()).some((e) =>
      e.includes("отсутствует медиафайл"),
    ),
  ).toBe(true);
  expect(
    importSchema.safeParse({ version: 1, questions: [bank[0], bank[0]] })
      .success,
  ).toBe(false);
  expect(
    questionSchema.safeParse({ ...bank[0], answer: undefined }).success,
  ).toBe(false);
  expect(
    questionSchema.safeParse({ ...bank[0], min: 500, max: 0 }).success,
  ).toBe(false);
  expect(validateBank([])).toEqual([]);
});
it("YouTube принимает только действительные ID с разрешённых доменов", () => {
  expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
    "dQw4w9WgXcQ",
  );
  expect(youtubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  expect(youtubeId("https://youtube.com/")).toBeNull();
  expect(youtubeId("https://attacker.example/watch?v=dQw4w9WgXcQ")).toBeNull();
});
